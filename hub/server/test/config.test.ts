import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.ts";

const required = {
  GITLAB_BASE_URL: "https://gitlab.test",
  GITLAB_TOKEN: "super-secret-value",
  OPENWIKI_HUB_GROUPS: "platform",
  OPENWIKI_HUB_WEBHOOK_TOKEN: "hook-secret",
};

describe("loadConfig", () => {
  it("applies defaults for optional settings", () => {
    const config = loadConfig(required);
    expect(config.schedule).toBe("0 2 * * *");
    expect(config.dataDir).toBe("./data");
    expect(config.concurrency).toBe(1);
    expect(config.retention).toBe(20);
  });

  it("splits and trims group lists and drops empty entries", () => {
    const config = loadConfig({
      ...required,
      OPENWIKI_HUB_GROUPS: "a, b ,,",
    });
    expect(config.groups).toEqual(["a", "b"]);
  });

  it("names the missing variable but never echoes a secret", () => {
    const { GITLAB_TOKEN: _token, ...withoutToken } = required;
    expect(() => loadConfig(withoutToken)).toThrow(/GITLAB_TOKEN/);
    try {
      loadConfig({ ...withoutToken, GITLAB_BASE_URL: "" });
    } catch (error) {
      expect(String(error)).not.toContain("super-secret-value");
    }
  });

  it("rejects a non-positive concurrency", () => {
    expect(() =>
      loadConfig({ ...required, OPENWIKI_HUB_CONCURRENCY: "0" }),
    ).toThrow(/OPENWIKI_HUB_CONCURRENCY/);
  });
});
