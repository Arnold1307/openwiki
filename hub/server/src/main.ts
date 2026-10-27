import { loadConfig } from "./config.js";
import { buildServer } from "./index.js";
import { startScheduler } from "./scheduler.js";
import { runScanAll } from "./sync/scan-all.js";

/**
 * Process entry point: read configuration, start the server and the nightly
 * scan, and shut down cleanly on SIGINT or SIGTERM.
 */
async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (error) {
    // Messages name the variable only; they never contain a value.
    console.error(
      error instanceof Error ? error.message : "Invalid configuration.",
    );
    process.exit(1);
  }

  const app = await buildServer(config);
  const { redact } = app.hubDeps;

  const schedule = startScheduler(config.schedule, () =>
    runScanAll(app.hubDeps).catch((error: unknown) => {
      console.error(
        redact(error instanceof Error ? error.message : String(error)),
      );
    }),
  );

  const port = Number(process.env.PORT ?? 8080);
  const host = process.env.HOST ?? "0.0.0.0";
  await app.listen({ port, host });
  console.log(`OpenWiki Hub listening on ${host}:${port}`);

  const shutdown = async () => {
    schedule.stop();
    await app.close();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

void main();
