import { describe, expect, it } from "vitest";
import { SyncQueue } from "../src/sync/queue.ts";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

describe("SyncQueue", () => {
  it("runs one job at a time when concurrency is 1", async () => {
    const queue = new SyncQueue(1);
    const order: string[] = [];
    const gate = deferred();

    const first = queue.run(async () => {
      order.push("first-start");
      await gate.promise;
      order.push("first-end");
    });
    const second = queue.run(async () => {
      order.push("second-start");
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual(["first-start"]);
    gate.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual(["first-start", "first-end", "second-start"]);
  });

  it("runs up to the configured number of jobs together", async () => {
    const queue = new SyncQueue(2);
    let active = 0;
    let peak = 0;
    const job = async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
    };
    await Promise.all([1, 2, 3, 4].map(() => queue.run(job)));
    expect(peak).toBe(2);
  });

  it("rejects only the failing job", async () => {
    const queue = new SyncQueue(1);
    const failing = queue.run(async () => {
      throw new Error("boom");
    });
    const passing = queue.run(async () => "ok");
    await expect(failing).rejects.toThrow("boom");
    await expect(passing).resolves.toBe("ok");
  });
});

describe("SyncQueue.drain", () => {
  it("resolves only after every queued job has finished", async () => {
    const queue = new SyncQueue(1);
    let finished = 0;
    void queue.run(async () => {
      await new Promise((r) => setTimeout(r, 10));
      finished++;
    });
    void queue.run(async () => {
      finished++;
    });
    await queue.drain();
    expect(finished).toBe(2);
  });
});
