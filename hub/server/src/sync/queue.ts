/**
 * Bounded FIFO runner for sync jobs. Keeps LLM-free but network-heavy syncs
 * from overwhelming the server or GitLab.
 */
export class SyncQueue {
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  private readonly pending = new Set<Promise<unknown>>();

  constructor(private readonly concurrency: number) {}

  /**
   * Run a job once a slot is free.
   *
   * @param job - Async work to run.
   * @returns The job's result; rejects with the job's error.
   */
  run<T>(job: () => Promise<T>): Promise<T> {
    const result = new Promise<T>((resolve, reject) => {
      const start = () => {
        this.active++;
        job()
          .then(resolve, reject)
          .finally(() => {
            this.active--;
            this.waiting.shift()?.();
          });
      };
      if (this.active < this.concurrency) start();
      else this.waiting.push(start);
    });
    this.pending.add(result);
    void result.finally(() => this.pending.delete(result)).catch(() => undefined);
    return result;
  }

  /**
   * Wait until every job queued so far has settled, including jobs that were
   * queued while waiting.
   */
  async drain(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.allSettled([...this.pending]);
    }
  }
}
