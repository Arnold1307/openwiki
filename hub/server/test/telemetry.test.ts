import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/index.ts";
import {
  activeTraceIds,
  enrichLogFields,
  formatPrometheusMetrics,
  parseTraceparent,
  recordHttpRequest,
  resetHttpRequestCounter,
  resolveOtlpTracesUrl,
  runWithTraceparent,
  setDiagnosticSink,
  traceIdFromHeaders,
} from "../src/telemetry.ts";
import { testConfig } from "./helpers.ts";

const TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";
const SPAN_ID = "00f067aa0ba902b7";
const TRACEPARENT = `00-${TRACE_ID}-${SPAN_ID}-01`;

afterEach(() => {
  setDiagnosticSink(undefined);
  resetHttpRequestCounter();
});

describe("traceparent helpers", () => {
  it("parses a W3C traceparent into trace_id and span_id", () => {
    expect(parseTraceparent(TRACEPARENT)).toEqual({
      trace_id: TRACE_ID,
      span_id: SPAN_ID,
    });
    expect(traceIdFromHeaders({ traceparent: TRACEPARENT })).toBe(TRACE_ID);
    expect(parseTraceparent("not-a-traceparent")).toEqual({});
  });

  it("runWithTraceparent exposes the same trace_id on the active context", () => {
    const seen = runWithTraceparent(TRACEPARENT, () => activeTraceIds());
    expect(seen.trace_id).toBe(TRACE_ID);
    expect(seen.span_id).toBe(SPAN_ID);
  });

  it("enrichLogFields prefers the active span, then the header", () => {
    expect(enrichLogFields({ traceparent: TRACEPARENT }).trace_id).toBe(
      TRACE_ID,
    );
    const fromContext = runWithTraceparent(TRACEPARENT, () =>
      enrichLogFields({}),
    );
    expect(fromContext.trace_id).toBe(TRACE_ID);
  });
});

describe("OTLP endpoint resolution", () => {
  it("stays off without endpoint or SDLC_OTEL_ENABLED", () => {
    expect(resolveOtlpTracesUrl({})).toBeUndefined();
  });

  it("defaults locally when SDLC_OTEL_ENABLED=true", () => {
    expect(resolveOtlpTracesUrl({ SDLC_OTEL_ENABLED: "true" })).toBe(
      "http://localhost:4318/v1/traces",
    );
  });

  it("accepts OTEL_EXPORTER_OTLP_ENDPOINT and SDLC_OTEL_ENDPOINT", () => {
    expect(
      resolveOtlpTracesUrl({
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318",
      }),
    ).toBe("http://collector:4318/v1/traces");
    expect(
      resolveOtlpTracesUrl({
        SDLC_OTEL_ENDPOINT: "http://collector:4318/v1/traces",
      }),
    ).toBe("http://collector:4318/v1/traces");
  });
});

describe("request log enrichment", () => {
  it("logs the trace_id from an incoming traceparent on /healthz", async () => {
    const lines: string[] = [];
    setDiagnosticSink((line) => lines.push(line));

    const app = await buildServer(testConfig());
    try {
      const response = await app.inject({
        method: "GET",
        url: "/healthz",
        headers: { traceparent: TRACEPARENT },
      });
      expect(response.statusCode).toBe(200);

      const matching = lines.filter((line) => line.includes(TRACE_ID));
      expect(matching.length).toBeGreaterThan(0);
      const payload = JSON.parse(matching[0]!) as {
        msg: string;
        trace_id: string;
        url: string;
      };
      expect(payload.msg).toBe("http_request");
      expect(payload.trace_id).toBe(TRACE_ID);
      expect(payload.url).toBe("/healthz");
      expect(matching[0]).not.toMatch(/token|prompt|gitlab/i);
    } finally {
      await app.close();
    }
  });
});

describe("GET /metrics", () => {
  it("exposes Prometheus process metrics and is not an SPA fallback", async () => {
    const app = await buildServer(testConfig());
    try {
      await app.inject({ method: "GET", url: "/healthz" });
      const response = await app.inject({ method: "GET", url: "/metrics" });
      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toMatch(/text\/plain/);
      expect(response.body).toContain("process_uptime_seconds");
      expect(response.body).toContain('http_request_duration_seconds_count{status_code="200"} 1');
    } finally {
      await app.close();
    }
  });

  it("formatPrometheusMetrics includes the required series", () => {
    recordHttpRequest(500, 0.12);
    const body = formatPrometheusMetrics();
    expect(body).toContain("# TYPE process_uptime_seconds gauge");
    expect(body).toContain("# TYPE http_request_duration_seconds histogram");
    expect(body).toContain('http_request_duration_seconds_bucket{status_code="500",le="0.1"}');
    expect(body).toContain('http_request_duration_seconds_count{status_code="500"} 1');
    expect(body).not.toMatch(/\{[^}]*path=/);
  });

  it("records request count, status and duration in bounded labels", async () => {
    const app = await buildServer(testConfig());
    try {
      await app.inject({ method: "GET", url: "/healthz" });
      const response = await app.inject({ method: "GET", url: "/missing-route" });
      expect(response.statusCode).toBe(404);
      const metrics = (await app.inject({ method: "GET", url: "/metrics" })).body;
      expect(metrics).toContain('http_request_duration_seconds_count{status_code="200"} 1');
      expect(metrics).toContain('http_request_duration_seconds_count{status_code="404"} 1');
      expect(metrics).toContain('http_request_duration_seconds_bucket{status_code="200",le="+Inf"} 1');
      expect(metrics).not.toContain("/healthz");
      expect(metrics).not.toContain("/missing-route");
    } finally {
      await app.close();
    }
  });
});
