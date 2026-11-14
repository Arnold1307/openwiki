import {
  context,
  propagation,
  trace,
  type SpanContext,
} from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

let contextManagerReady = false;

/** Enable AsyncLocalStorage so context.with propagates without the full SDK. */
function ensureContextManager(): void {
  if (contextManagerReady) return;
  const manager = new AsyncLocalStorageContextManager();
  manager.enable();
  context.setGlobalContextManager(manager);
  contextManagerReady = true;
}

const SERVICE_NAME = "openwiki-hub";
const DEFAULT_LOCAL_TRACES_URL = "http://localhost:4318/v1/traces";

/** W3C traceparent: version-trace_id-parent_id-flags */
const TRACEPARENT_RE =
  /^[\t ]*([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})[\t ]*$/i;

export type TraceIds = { trace_id?: string; span_id?: string };

export type HeaderMap = Record<
  string,
  string | string[] | undefined
>;

export type DiagnosticSink = (line: string) => void;

let sdk: NodeSDK | undefined;
const HTTP_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.3, 0.5, 1, 2.5, 5, 10] as const;
type HttpObservation = { count: number; sum: number; buckets: number[] };
const httpObservations = new Map<string, HttpObservation>();
let diagnosticSink: DiagnosticSink = (line) => {
  // Vitest sets VITEST; keep the suite quiet unless a test installs a sink.
  if (process.env.VITEST) return;
  console.log(line);
};

/**
 * Resolve the OTLP/HTTP traces URL from env.
 * Starts only when an endpoint is set, or when SDLC_OTEL_ENABLED=true
 * (then defaults to the local collector).
 */
export function resolveOtlpTracesUrl(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const raw =
    env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim() ||
    env.SDLC_OTEL_ENDPOINT?.trim();
  if (raw) {
    const base = raw.replace(/\/+$/, "");
    return base.endsWith("/v1/traces") ? base : `${base}/v1/traces`;
  }
  if (env.SDLC_OTEL_ENABLED === "true") {
    return DEFAULT_LOCAL_TRACES_URL;
  }
  return undefined;
}

/** Parse a W3C `traceparent` header value into trace/span ids. */
export function parseTraceparent(value: string | undefined): TraceIds {
  if (!value) return {};
  const match = TRACEPARENT_RE.exec(value);
  if (!match) return {};
  return {
    trace_id: match[2]!.toLowerCase(),
    span_id: match[3]!.toLowerCase(),
  };
}

/** Read `trace_id` from request headers (`traceparent`). */
export function traceIdFromHeaders(headers: HeaderMap): string | undefined {
  const raw = headers.traceparent ?? headers.Traceparent;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return parseTraceparent(value).trace_id;
}

/** Trace/span ids from the active OpenTelemetry span, if any. */
export function activeTraceIds(): TraceIds {
  const span = trace.getActiveSpan();
  const sc = span?.spanContext();
  if (!sc || !trace.isSpanContextValid(sc)) return {};
  return { trace_id: sc.traceId, span_id: sc.spanId };
}

/**
 * Prefer the active span; otherwise fall back to the incoming traceparent.
 * Used so inject()-based tests still enrich logs without the HTTP server.
 */
export function enrichLogFields(headers: HeaderMap): TraceIds {
  const active = activeTraceIds();
  if (active.trace_id) return active;
  const raw = headers.traceparent ?? headers.Traceparent;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return parseTraceparent(value);
}

/**
 * Run `fn` with a remote span context derived from a traceparent value.
 * Does not require the full SDK.
 */
export function runWithTraceparent<T>(traceparent: string, fn: () => T): T {
  ensureContextManager();
  const ids = parseTraceparent(traceparent);
  if (!ids.trace_id || !ids.span_id) return fn();
  const spanContext: SpanContext = {
    traceId: ids.trace_id,
    spanId: ids.span_id,
    traceFlags: 1,
    isRemote: true,
  };
  return context.with(trace.setSpanContext(context.active(), spanContext), fn);
}

/** Replace or restore the diagnostic log sink (tests capture lines here). */
export function setDiagnosticSink(sink: DiagnosticSink | undefined): void {
  diagnosticSink =
    sink ??
    ((line) => {
      if (process.env.VITEST) return;
      console.log(line);
    });
}

/**
 * Emit a structured request log line with trace_id/span_id.
 * Never logs bodies, tokens, or prompt content.
 */
export function logRequestDiagnostic(fields: {
  method: string;
  url: string;
  statusCode: number;
  trace_id?: string;
  span_id?: string;
}): void {
  const payload: Record<string, string | number> = {
    msg: "http_request",
    method: fields.method,
    url: fields.url,
    statusCode: fields.statusCode,
  };
  if (fields.trace_id) payload.trace_id = fields.trace_id;
  if (fields.span_id) payload.span_id = fields.span_id;
  diagnosticSink(JSON.stringify(payload));
}

/** Record a request with bounded status-code labels and duration in seconds. */
export function recordHttpRequest(statusCode: number, durationSeconds: number): void {
  const status = Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599
    ? String(statusCode)
    : "other";
  const observation = httpObservations.get(status) ?? {
    count: 0,
    sum: 0,
    buckets: HTTP_BUCKETS.map(() => 0),
  };
  const duration = Number.isFinite(durationSeconds) ? Math.max(0, durationSeconds) : 0;
  observation.count += 1;
  observation.sum += duration;
  HTTP_BUCKETS.forEach((bound, index) => {
    if (duration <= bound) observation.buckets[index] += 1;
  });
  httpObservations.set(status, observation);
}

/** Reset the in-process request counter (tests only). */
export function resetHttpRequestCounter(): void {
  httpObservations.clear();
}

/**
 * Prometheus text exposition: process gauges plus an HTTP duration histogram.
 * Content-Type: text/plain; version=0.0.4
 */
export function formatPrometheusMetrics(
  now: NodeJS.Process = process,
): string {
  const mem = now.memoryUsage();
  const lines = [
    "# HELP process_uptime_seconds Process uptime in seconds.",
    "# TYPE process_uptime_seconds gauge",
    `process_uptime_seconds ${now.uptime()}`,
    "# HELP process_resident_memory_bytes Resident memory size in bytes.",
    "# TYPE process_resident_memory_bytes gauge",
    `process_resident_memory_bytes ${mem.rss}`,
    "# HELP process_heap_bytes Process heap used in bytes.",
    "# TYPE process_heap_bytes gauge",
    `process_heap_bytes ${mem.heapUsed}`,
    "# HELP http_request_duration_seconds HTTP request duration in seconds.",
    "# TYPE http_request_duration_seconds histogram",
  ];
  for (const [status, observation] of [...httpObservations.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    HTTP_BUCKETS.forEach((bound, index) => {
      lines.push(`http_request_duration_seconds_bucket{status_code="${status}",le="${bound}"} ${observation.buckets[index]}`);
    });
    lines.push(`http_request_duration_seconds_bucket{status_code="${status}",le="+Inf"} ${observation.count}`);
    lines.push(`http_request_duration_seconds_sum{status_code="${status}"} ${observation.sum}`);
    lines.push(`http_request_duration_seconds_count{status_code="${status}"} ${observation.count}`);
  }
  if (httpObservations.size === 0) {
    for (const bound of HTTP_BUCKETS) {
      lines.push(`http_request_duration_seconds_bucket{status_code="other",le="${bound}"} 0`);
    }
    lines.push('http_request_duration_seconds_bucket{status_code="other",le="+Inf"} 0');
    lines.push('http_request_duration_seconds_sum{status_code="other"} 0');
    lines.push('http_request_duration_seconds_count{status_code="other"} 0');
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * Start the NodeSDK when an OTLP endpoint is configured.
 * Registers W3C trace-context propagation and HTTP instrumentation.
 */
export function startTelemetry(
  env: NodeJS.ProcessEnv = process.env,
): NodeSDK | undefined {
  if (sdk) return sdk;
  const url = resolveOtlpTracesUrl(env);
  if (!url) return undefined;

  ensureContextManager();
  // Ensure extract/inject work even before the first request.
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());

  const instance = new NodeSDK({
    serviceName: SERVICE_NAME,
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: SERVICE_NAME,
    }),
    traceExporter: new OTLPTraceExporter({ url }),
    instrumentations: [
      new HttpInstrumentation({
        // Skip the scrape endpoint; keep other routes instrumented.
        ignoreIncomingRequestHook: (req) =>
          (req.url ?? "").startsWith("/metrics"),
      }),
    ],
  });
  instance.start();
  sdk = instance;
  return instance;
}

/** Flush and unregister the SDK (no-op if never started). */
export async function shutdownTelemetry(): Promise<void> {
  if (!sdk) return;
  const instance = sdk;
  sdk = undefined;
  await instance.shutdown();
}
