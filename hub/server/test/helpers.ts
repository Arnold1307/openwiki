import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { HubConfig } from "../src/config.ts";

/** Config for tests: temp data dir, no network, fixed secrets. */
export function testConfig(overrides: Partial<HubConfig> = {}): HubConfig {
  const dataDir = mkdtempSync(path.join(tmpdir(), "hub-test-"));
  return {
    gitlabBaseUrl: "https://gitlab.test",
    gitlabToken: "test-token-value",
    groups: ["platform"],
    schedule: "0 2 * * *",
    dataDir,
    concurrency: 1,
    webhookToken: "hook-secret",
    retention: 20,
    // No receiver, and event files go to a temp dir, never into the repo.
    events: { outDir: path.join(dataDir, "events") },
    ...overrides,
  };
}
