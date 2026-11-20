export function createRetryingFetch(
  fetchImpl: typeof fetch = globalThis.fetch,
  maxRetries = 2,
): typeof fetch {
  const attempts = Math.max(1, Math.min(Math.trunc(maxRetries) + 1, 10));
  return async (input, init) => {
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (init?.signal?.aborted) throw init.signal.reason ?? new Error("Request cancelled.");
      try {
        const response = await fetchImpl(input, init);
        if (attempt + 1 >= attempts || !isRetryable(response.status)) return response;
        await response.body?.cancel().catch(() => undefined);
        const delay = retryDelay(response.headers.get("retry-after"), attempt);
        await wait(delay, init?.signal ?? undefined);
      } catch (error) {
        lastError = error;
        if (attempt + 1 >= attempts || init?.signal?.aborted) throw error;
        await wait(Math.min(250 * 2 ** attempt, 2_000), init?.signal ?? undefined);
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Provider request failed after retries.");
  };
}

function isRetryable(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function retryDelay(value: string | null, attempt: number): number {
  if (value) {
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return Math.max(0, Math.min(seconds * 1_000, 30_000));
    const date = Date.parse(value);
    if (Number.isFinite(date)) return Math.max(0, Math.min(date - Date.now(), 30_000));
  }
  return Math.min(250 * 2 ** attempt, 2_000);
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error("Request cancelled."));
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(signal?.reason ?? new Error("Request cancelled."));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
