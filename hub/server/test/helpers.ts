import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { HubConfig } from "../src/config.ts";

/** Config for tests: temp data dir, no network, fixed secrets. */
export function testConfig(overrides: Partial<HubConfig> = {}): HubConfig {
  return {
    gitlabBaseUrl: "https://gitlab.test",
    gitlabToken: "test-token-value",
    groups: ["platform"],
    schedule: "0 2 * * *",
    dataDir: mkdtempSync(path.join(tmpdir(), "hub-test-")),
    concurrency: 1,
    webhookToken: "hook-secret",
    retention: 20,
    ...overrides,
  };
}
