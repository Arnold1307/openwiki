import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * `wiki.updated` envelope (sdlc-event/v1) for pages the hub writes.
 *
 * Delivery: POST to company-mcp `/api/v1/events`. When no receiver is
 * configured, or delivery fails, the envelope is written to a file instead.
 * Nothing in this module throws into the caller: a page write must succeed
 * even when the event cannot be sent or stored.
 */

export const WIKI_UPDATED = "wiki.updated";
const SOURCE = { system: "openwiki", instance: "hub" } as const;
const DEFAULT_OUT_DIR = "./out/events";
const SEND_TIMEOUT_MS = 5_000;

/* Rules copied from sdlc-contracts/schemas/sdlc-event-v1.schema.json. */
const TRACE_ID_RE = /^[0-9a-f]{32}$/;
const CHECKSUM_RE = /^sha256:[0-9a-f]{64}$/;
const VERSION_RE = /^[1-9][0-9]*$/;

export interface EventsConfig {
  /** Full URL of the receiver, normally company-mcp `POST /api/v1/events`. */
  url?: string;
  /** Sent as `X-Company-Mcp-Token`. Never written to a file or log. */
  token?: string;
  /** Sent as `X-SDLC-Tenant-Id`. */
  tenantId?: string;
  /** Directory for envelopes that were not delivered. */
  outDir: string;
}

/** Spec reference as stored in page front matter (strings only). */
export interface PageSpecRef {
  ref: string;
  version: string;
  checksum: string;
}

/** Spec reference in the form the envelope schema requires. */
export interface ContractSpecRef {
  ref: string;
  version: number;
  checksum: string;
}

export interface WikiUpdatedInput {
  /** Page path inside openwiki/, e.g. `passwd-reset.md`. */
  page: string;
  /** Commit the page was written for. */
  revision: string;
  specRef?: PageSpecRef;
}

export interface SdlcEvent {
  event_id: string;
  event_type: string;
  occurred_at: string;
  trace_id: string;
  source: { system: string; instance: string };
  spec_ref?: ContractSpecRef;
  payload: Record<string, unknown>;
}

export type DeliveryOutcome =
  | { status: "sent"; httpStatus: number }
  | { status: "file"; path: string; reason: string }
  | { status: "failed"; reason: string };

export interface EmitOptions {
  /** Trace id of the incoming request, if any. A fresh id is used otherwise. */
  traceId?: string;
  /** Replaces the global fetch, for tests. */
  fetchImpl?: typeof fetch;
  now?: Date;
}

/**
 * Read the event settings from environment variables.
 *
 * @param env - Environment to read, normally `process.env`.
 * @returns Receiver settings (all optional) and the fallback directory.
 */
export function loadEventsConfig(env: NodeJS.ProcessEnv): EventsConfig {
  const value = (name: string): string | undefined =>
    env[name]?.trim() || undefined;
  return {
    url: value("OPENWIKI_EVENTS_URL"),
    token: value("OPENWIKI_EVENTS_TOKEN"),
    tenantId: value("OPENWIKI_TENANT_ID"),
    outDir: value("OPENWIKI_EVENTS_OUT") ?? DEFAULT_OUT_DIR,
  };
}

/**
 * Convert a page's spec reference to the envelope form.
 *
 * @param specRef - Spec reference from front matter.
 * @returns Contract form, or undefined when the contract would reject it.
 */
export function toContractSpecRef(
  specRef: PageSpecRef | undefined,
): ContractSpecRef | undefined {
  if (!specRef) return undefined;
  const version = specRef.version.trim();
  if (!VERSION_RE.test(version) || !CHECKSUM_RE.test(specRef.checksum)) {
    return undefined;
  }
  return {
    ref: specRef.ref,
    version: Number(version),
    checksum: specRef.checksum,
  };
}

/**
 * Build the `wiki.updated` envelope. Pure apart from the default id, time and trace.
 *
 * @param input - Page, revision and optional spec reference.
 * @param options - Overrides for id, time and trace, mainly for tests.
 * @returns Envelope ready to serialize.
 */
export function buildWikiUpdatedEvent(
  input: WikiUpdatedInput,
  options: { eventId?: string; now?: Date; traceId?: string } = {},
): SdlcEvent {
  const specRef = toContractSpecRef(input.specRef);
  const payload: Record<string, unknown> = {
    page: input.page,
    revision: input.revision,
  };
  if (specRef) payload.spec_ref = specRef;

  const event: SdlcEvent = {
    event_id: options.eventId ?? randomUUID(),
    event_type: WIKI_UPDATED,
    occurred_at: (options.now ?? new Date()).toISOString(),
    trace_id: validTraceId(options.traceId) ?? randomTraceId(),
    source: { ...SOURCE },
    payload,
  };
  if (specRef) event.spec_ref = specRef;
  return event;
}

/**
 * Deliver the `wiki.updated` envelope, or store it in the fallback directory.
 * Never rejects: a failure here must not fail the page write that triggered it.
 *
 * @param config - Receiver settings and fallback directory.
 * @param input - Page, revision and optional spec reference.
 * @param options - Trace id, fetch replacement and clock, mainly for tests.
 * @returns How the envelope was handled. Secrets never appear in the result.
 */
export async function emitWikiUpdated(
  config: EventsConfig,
  input: WikiUpdatedInput,
  options: EmitOptions = {},
): Promise<DeliveryOutcome> {
  try {
    const event = buildWikiUpdatedEvent(input, {
      now: options.now,
      traceId: options.traceId,
    });
    if (!isReceiverConfigured(config)) {
      return await writeFallback(config.outDir, event, "not_configured");
    }
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    const delivery = await send(config, event, fetchImpl);
    if (delivery.ok) {
      return { status: "sent", httpStatus: delivery.httpStatus };
    }
    return await writeFallback(config.outDir, event, delivery.reason);
  } catch (error) {
    return { status: "failed", reason: errorReason(error) };
  }
}

type ConfiguredReceiver = EventsConfig & {
  url: string;
  token: string;
  tenantId: string;
};

function isReceiverConfigured(
  config: EventsConfig,
): config is ConfiguredReceiver {
  return Boolean(config.url && config.token && config.tenantId);
}

async function send(
  config: ConfiguredReceiver,
  event: SdlcEvent,
  fetchImpl: typeof fetch,
): Promise<{ ok: true; httpStatus: number } | { ok: false; reason: string }> {
  try {
    const response = await fetchImpl(config.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Company-Mcp-Token": config.token,
        "X-SDLC-Tenant-Id": config.tenantId,
      },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    void response.body?.cancel().catch(() => undefined);
    if (response.status >= 200 && response.status < 300) {
      return { ok: true, httpStatus: response.status };
    }
    return { ok: false, reason: `http_${response.status}` };
  } catch (error) {
    return { ok: false, reason: errorReason(error) };
  }
}

async function writeFallback(
  outDir: string,
  event: SdlcEvent,
  reason: string,
): Promise<DeliveryOutcome> {
  await mkdir(outDir, { recursive: true });
  const file = path.join(outDir, `${event.event_id}.json`);
  await writeFile(file, `${JSON.stringify(event, null, 2)}\n`, "utf8");
  return { status: "file", path: file, reason };
}

/** Error names only: messages can carry URLs or other details. */
function errorReason(error: unknown): string {
  if (error instanceof Error) {
    return error.name === "TimeoutError" || error.name === "AbortError"
      ? "timeout"
      : error.name;
  }
  return "error";
}

function validTraceId(value: string | undefined): string | undefined {
  const trimmed = value?.trim().toLowerCase();
  return trimmed && TRACE_ID_RE.test(trimmed) ? trimmed : undefined;
}

function randomTraceId(): string {
  return randomBytes(16).toString("hex");
}
