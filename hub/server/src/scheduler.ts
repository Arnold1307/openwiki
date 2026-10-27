import cron from "node-cron";

export interface ScheduledJob {
  stop(): void;
}

/**
 * Run a job on a cron schedule.
 *
 * @param expression - Five-field cron expression, e.g. `0 2 * * *`.
 * @param job - Async work; failures are logged by the job itself.
 * @returns Handle that stops the schedule.
 * @throws {Error} When the expression is invalid. The message names the
 *   setting, not the value.
 */
export function startScheduler(expression: string, job: () => Promise<unknown>): ScheduledJob {
  if (!cron.validate(expression)) {
    throw new Error("OPENWIKI_HUB_SCHEDULE is not a valid cron expression.");
  }
  return cron.schedule(expression, () => {
    void job();
  });
}
