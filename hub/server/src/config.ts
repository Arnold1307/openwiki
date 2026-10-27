/** Runtime settings for the hub server, read once at startup. */
export interface HubConfig {
  gitlabBaseUrl: string;
  gitlabToken: string;
  groups: string[];
  schedule: string;
  dataDir: string;
  concurrency: number;
  webhookToken: string;
  retention: number;
}

/**
 * Read hub settings from environment variables.
 *
 * Error messages name the variable only, never its value, so a secret cannot
 * leak through startup diagnostics.
 *
 * @param env - Environment to read, normally `process.env`.
 * @returns Validated configuration with defaults applied.
 * @throws {Error} When a required variable is missing or a value is invalid.
 */
export function loadConfig(env: NodeJS.ProcessEnv): HubConfig {
  const required = (name: string): string => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`Missing required variable ${name}.`);
    return value;
  };

  const positiveInteger = (name: string, fallback: number): number => {
    const raw = env[name]?.trim();
    if (raw === undefined || raw === "") return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`${name} must be a positive integer.`);
    }
    return value;
  };

  return {
    gitlabBaseUrl: required("GITLAB_BASE_URL").replace(/\/+$/, ""),
    gitlabToken: required("GITLAB_TOKEN"),
    groups: (env.OPENWIKI_HUB_GROUPS ?? "")
      .split(",")
      .map((group) => group.trim())
      .filter(Boolean),
    schedule: env.OPENWIKI_HUB_SCHEDULE?.trim() || "0 2 * * *",
    dataDir: env.OPENWIKI_HUB_DATA_DIR?.trim() || "./data",
    concurrency: positiveInteger("OPENWIKI_HUB_CONCURRENCY", 1),
    webhookToken: required("OPENWIKI_HUB_WEBHOOK_TOKEN"),
    retention: positiveInteger("OPENWIKI_HUB_RETENTION", 20),
  };
}
