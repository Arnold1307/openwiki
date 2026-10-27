import { describe, expect, it } from "vitest";
import { startScheduler } from "../src/scheduler.ts";

describe("startScheduler", () => {
  it("rejects an invalid cron expression with a message that names the setting", () => {
    expect(() => startScheduler("every tuesday", async () => {})).toThrow(
      /OPENWIKI_HUB_SCHEDULE/,
    );
  });

  it("returns a handle that stops the schedule", () => {
    const task = startScheduler("0 2 * * *", async () => {});
    expect(typeof task.stop).toBe("function");
    task.stop();
  });
});
