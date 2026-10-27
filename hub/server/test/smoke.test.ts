import { describe, expect, it } from "vitest";
import { buildServer } from "../src/index.ts";
import { testConfig } from "./helpers.ts";

describe("hub server scaffold", () => {
  it("answers the health check", async () => {
    const app = await buildServer(testConfig());
    try {
      const response = await app.inject({ method: "GET", url: "/healthz" });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true });
    } finally {
      await app.close();
    }
  });
});
