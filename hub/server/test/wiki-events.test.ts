import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../src/index.ts";
import { CSRF_HEADER_VALUE } from "../src/routes/api.ts";
import {
  buildWikiUpdatedEvent,
  emitWikiUpdated,
  loadEventsConfig,
  type EventsConfig,
} from "../src/events/wikiEvents.ts";
import { testConfig } from "./helpers.ts";

/* Patterns copied from sdlc-contracts/schemas/sdlc-event-v1.schema.json. */
const EVENT_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const EVENT_TYPE_RE = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;
const OCCURRED_AT_RE =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$/;
const TRACE_ID_RE = /^[0-9a-f]{32}$/;
const CHECKSUM_RE = /^sha256:[0-9a-f]{64}$/;
const ENVELOPE_KEYS = [
  "event_id",
  "event_type",
  "occurred_at",
  "trace_id",
  "source",
  "spec_ref",
  "payload",
];

const TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";
const SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const ENDPOINT = "https://company-mcp.test/api/v1/events";
const TOKEN = "events-token-value";
const TENANT = "7e2a9d41-3b6c-4f08-a1e5-d2c4b8f09a36";
const WIKI_SPEC = {
  ref: "SPEC-GP-PASSWD",
  version: "1",
  checksum: `sha256:${"ab".repeat(32)}`,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function tempDir(): string {
  return mkdtempSync(path.join(tmpdir(), "wiki-events-"));
}

function eventsConfig(
  outDir: string,
  overrides: Partial<EventsConfig> = {},
): EventsConfig {
  return { outDir, ...overrides };
}

/** Fake fetch: records calls, never touches the network. */
function fakeFetch(respond: () => Response | Promise<Response>) {
  return vi.fn(async (_input: unknown, _init?: RequestInit) => respond());
}

function readOutFiles(dir: string): Record<string, unknown>[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map(
      (name) =>
        JSON.parse(readFileSync(path.join(dir, name), "utf8")) as Record<
          string,
          unknown
        >,
    );
}

/** Asserts the envelope against the sdlc-event/v1 rules it must satisfy. */
function expectValidEnvelope(envelope: Record<string, unknown>): void {
  for (const key of Object.keys(envelope)) {
    expect(ENVELOPE_KEYS).toContain(key);
  }
  expect(String(envelope.event_id)).toMatch(EVENT_ID_RE);
  expect(String(envelope.event_type)).toMatch(EVENT_TYPE_RE);
  expect(String(envelope.occurred_at)).toMatch(OCCURRED_AT_RE);
  expect(String(envelope.trace_id)).toMatch(TRACE_ID_RE);
  const source = envelope.source as Record<string, unknown>;
  expect(Object.keys(source).sort()).toEqual(["instance", "system"]);
  expect(typeof source.system).toBe("string");
  expect(typeof source.instance).toBe("string");
  if (envelope.spec_ref !== undefined) {
    const specRef = envelope.spec_ref as Record<string, unknown>;
    expect(typeof specRef.ref).toBe("string");
    expect(Number.isInteger(specRef.version)).toBe(true);
    expect(specRef.version as number).toBeGreaterThanOrEqual(1);
    expect(String(specRef.checksum)).toMatch(CHECKSUM_RE);
  }
  expect(typeof envelope.payload).toBe("object");
}

describe("loadEventsConfig", () => {
  it("defaults the output directory and leaves the receiver unset", () => {
    const config = loadEventsConfig({});
    expect(config.outDir).toBe("./out/events");
    expect(config.url).toBeUndefined();
    expect(config.token).toBeUndefined();
    expect(config.tenantId).toBeUndefined();
  });

  it("reads and trims the receiver settings, treating blanks as unset", () => {
    const config = loadEventsConfig({
      OPENWIKI_EVENTS_URL: `  ${ENDPOINT}  `,
      OPENWIKI_EVENTS_TOKEN: TOKEN,
      OPENWIKI_TENANT_ID: "   ",
      OPENWIKI_EVENTS_OUT: "/var/lib/openwiki/events",
    });
    expect(config.url).toBe(ENDPOINT);
    expect(config.token).toBe(TOKEN);
    expect(config.tenantId).toBeUndefined();
    expect(config.outDir).toBe("/var/lib/openwiki/events");
  });
});

describe("buildWikiUpdatedEvent", () => {
  it("builds the envelope with page, revision and spec_ref", () => {
    const envelope = buildWikiUpdatedEvent(
      { page: "passwd-reset.md", revision: SHA, specRef: WIKI_SPEC },
      {
        now: new Date("2026-11-13T18:00:00.000Z"),
        eventId: "0b7f3c2e-6a1d-4e8b-9f20-3c5d7e9a1b4f",
        traceId: TRACE_ID,
      },
    );
    expect(envelope).toEqual({
      event_id: "0b7f3c2e-6a1d-4e8b-9f20-3c5d7e9a1b4f",
      event_type: "wiki.updated",
      occurred_at: "2026-11-13T18:00:00.000Z",
      trace_id: TRACE_ID,
      source: { system: "openwiki", instance: "hub" },
      spec_ref: {
        ref: "SPEC-GP-PASSWD",
        version: 1,
        checksum: WIKI_SPEC.checksum,
      },
      payload: {
        page: "passwd-reset.md",
        revision: SHA,
        spec_ref: {
          ref: "SPEC-GP-PASSWD",
          version: 1,
          checksum: WIKI_SPEC.checksum,
        },
      },
    });
    expectValidEnvelope(envelope as unknown as Record<string, unknown>);
  });

  it("omits spec_ref when the page has none", () => {
    const envelope = buildWikiUpdatedEvent(
      { page: "readme.md", revision: SHA },
      {
        now: new Date("2026-11-13T18:00:00.000Z"),
        eventId: "0b7f3c2e-6a1d-4e8b-9f20-3c5d7e9a1b4f",
        traceId: TRACE_ID,
      },
    );
    expect("spec_ref" in envelope).toBe(false);
    expect("spec_ref" in (envelope.payload as object)).toBe(false);
    expectValidEnvelope(envelope as unknown as Record<string, unknown>);
  });

  it("drops a spec_ref that the contract would reject", () => {
    const badVersion = buildWikiUpdatedEvent(
      {
        page: "p.md",
        revision: SHA,
        specRef: { ...WIKI_SPEC, version: "v2" },
      },
      { eventId: "0b7f3c2e-6a1d-4e8b-9f20-3c5d7e9a1b4f", traceId: TRACE_ID },
    );
    expect("spec_ref" in badVersion).toBe(false);

    const badChecksum = buildWikiUpdatedEvent(
      {
        page: "p.md",
        revision: SHA,
        specRef: { ...WIKI_SPEC, checksum: "md5:1234" },
      },
      { eventId: "0b7f3c2e-6a1d-4e8b-9f20-3c5d7e9a1b4f", traceId: TRACE_ID },
    );
    expect("spec_ref" in badChecksum).toBe(false);
  });
});

describe("emitWikiUpdated", () => {
  it("writes a file and makes no network call when no receiver is configured", async () => {
    const outDir = tempDir();
    const fetchImpl = fakeFetch(() => new Response(null, { status: 201 }));

    const result = await emitWikiUpdated(
      eventsConfig(outDir),
      { page: "passwd-reset.md", revision: SHA, specRef: WIKI_SPEC },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.status).toBe("file");
    const files = readOutFiles(outDir);
    expect(files).toHaveLength(1);
    expectValidEnvelope(files[0]!);
    expect(files[0]!.event_type).toBe("wiki.updated");
    expect(readdirSync(outDir)).toEqual([`${files[0]!.event_id}.json`]);
  });

  it("sends the envelope with token and tenant headers on 201", async () => {
    const outDir = tempDir();
    const fetchImpl = fakeFetch(() => new Response(null, { status: 201 }));

    const result = await emitWikiUpdated(
      eventsConfig(outDir, { url: ENDPOINT, token: TOKEN, tenantId: TENANT }),
      { page: "passwd-reset.md", revision: SHA, specRef: WIKI_SPEC },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );

    expect(result.status).toBe("sent");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(ENDPOINT);
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Company-Mcp-Token"]).toBe(TOKEN);
    expect(headers["X-SDLC-Tenant-Id"]).toBe(TENANT);
    expect(headers["Content-Type"]).toBe("application/json");
    const sent = JSON.parse(String(init.body)) as Record<string, unknown>;
    expectValidEnvelope(sent);
    expect(sent.event_type).toBe("wiki.updated");
    expect(readdirSync(outDir)).toEqual([]);
  });

  it("writes the envelope to a file and resolves when the receiver answers 503", async () => {
    const outDir = tempDir();
    const fetchImpl = fakeFetch(() => new Response(null, { status: 503 }));

    const result = await emitWikiUpdated(
      eventsConfig(outDir, { url: ENDPOINT, token: TOKEN, tenantId: TENANT }),
      { page: "passwd-reset.md", revision: SHA, specRef: WIKI_SPEC },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("file");
    const files = readOutFiles(outDir);
    expect(files).toHaveLength(1);
    expectValidEnvelope(files[0]!);
  });

  it("writes a file when the network call rejects", async () => {
    const outDir = tempDir();
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });

    const result = await emitWikiUpdated(
      eventsConfig(outDir, { url: ENDPOINT, token: TOKEN, tenantId: TENANT }),
      { page: "passwd-reset.md", revision: SHA },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );

    expect(result.status).toBe("file");
    expect(readOutFiles(outDir)).toHaveLength(1);
  });

  it("treats a URL without token or tenant as not configured", async () => {
    const outDir = tempDir();
    const fetchImpl = fakeFetch(() => new Response(null, { status: 201 }));

    const result = await emitWikiUpdated(
      eventsConfig(outDir, { url: ENDPOINT, token: TOKEN }),
      { page: "passwd-reset.md", revision: SHA },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.status).toBe("file");
  });

  it("stores a URL without token as a file with reason not_configured, never sending or writing the URL", async () => {
    const outDir = tempDir();
    const fetchImpl = fakeFetch(() => new Response(null, { status: 201 }));

    const result = await emitWikiUpdated(
      eventsConfig(outDir, { url: ENDPOINT, tenantId: TENANT }),
      { page: "passwd-reset.md", revision: SHA },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "file", reason: "not_configured" });
    const names = readdirSync(outDir);
    expect(names).toHaveLength(1);
    const raw = readFileSync(path.join(outDir, names[0]!), "utf8");
    expectValidEnvelope(JSON.parse(raw) as Record<string, unknown>);
    expect(raw).not.toContain(ENDPOINT);
  });

  it("never throws, even when the event file cannot be written", async () => {
    const blocker = path.join(tempDir(), "not-a-directory");
    writeFileSync(blocker, "occupied");

    const result = await emitWikiUpdated(
      eventsConfig(path.join(blocker, "events")),
      { page: "passwd-reset.md", revision: SHA },
    );

    expect(result.status).toBe("failed");
  });

  it("uses the incoming trace id when it is valid and a fresh one otherwise", async () => {
    const outDir = tempDir();
    await emitWikiUpdated(
      eventsConfig(outDir),
      { page: "a.md", revision: SHA },
      { traceId: TRACE_ID },
    );
    await emitWikiUpdated(
      eventsConfig(outDir),
      { page: "b.md", revision: SHA },
      { traceId: "not-a-trace" },
    );
    const [first, second] = readOutFiles(outDir).sort((a, b) =>
      String(a.payload && (a.payload as { page: string }).page).localeCompare(
        String((b.payload as { page: string }).page),
      ),
    );
    expect(first!.trace_id).toBe(TRACE_ID);
    expect(String(second!.trace_id)).toMatch(TRACE_ID_RE);
    expect(second!.trace_id).not.toBe(TRACE_ID);
  });
});

describe("POST /api/local/pages emits wiki.updated", () => {
  const pageBody = {
    projectPath: "demo/passwd",
    page: "passwd-reset.md",
    sha: SHA,
    title: "Passwort zurücksetzen",
    body: "# Ziel\n\nReset per E-Mail.\n",
    spec_ref: {
      ref: "SPEC-GP-PASSWD",
      version: "1",
      checksum: WIKI_SPEC.checksum,
    },
  };

  it("sends wiki.updated after the page is written", async () => {
    const outDir = tempDir();
    const fetchImpl = fakeFetch(() => new Response(null, { status: 201 }));
    vi.stubGlobal("fetch", fetchImpl);
    const app = await buildServer(
      testConfig({
        events: { outDir, url: ENDPOINT, token: TOKEN, tenantId: TENANT },
      }),
    );
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/local/pages",
        headers: {
          "x-requested-with": CSRF_HEADER_VALUE,
          traceparent: `00-${TRACE_ID}-00f067aa0ba902b7-01`,
        },
        payload: pageBody,
      });
      expect(response.statusCode).toBe(201);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const sent = JSON.parse(
        String(
          (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body,
        ),
      ) as Record<string, unknown>;
      expectValidEnvelope(sent);
      expect(sent.trace_id).toBe(TRACE_ID);
      expect(sent.payload).toMatchObject({
        page: "passwd-reset.md",
        revision: SHA,
        spec_ref: { ref: "SPEC-GP-PASSWD", version: 1 },
      });
    } finally {
      await app.close();
    }
  });

  it("keeps the page write successful when the receiver fails", async () => {
    const outDir = tempDir();
    vi.stubGlobal(
      "fetch",
      fakeFetch(() => new Response(null, { status: 503 })),
    );
    const app = await buildServer(
      testConfig({
        events: { outDir, url: ENDPOINT, token: TOKEN, tenantId: TENANT },
      }),
    );
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/local/pages",
        headers: { "x-requested-with": CSRF_HEADER_VALUE },
        payload: pageBody,
      });
      expect(response.statusCode).toBe(201);
      const files = readOutFiles(outDir);
      expect(files).toHaveLength(1);
      expectValidEnvelope(files[0]!);
    } finally {
      await app.close();
    }
  });
});
