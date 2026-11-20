export class ProviderRequestError extends Error {
  readonly status?: number;
  readonly provider: string;

  constructor(provider: string, message: string, status?: number) {
    super(message);
    this.name = "ProviderRequestError";
    this.provider = provider;
    this.status = status;
  }
}

export async function providerError(
  provider: string,
  response: Response,
): Promise<ProviderRequestError> {
  let detail = "";
  try {
    const payload: unknown = await response.clone().json();
    if (isRecord(payload)) {
      const error = payload.error;
      if (typeof error === "string") detail = error;
      else if (isRecord(error) && typeof error.message === "string") {
        detail = error.message;
      }
    }
  } catch {
    // Providers sometimes return plain text or an empty body.
  }
  return new ProviderRequestError(
    provider,
    `${provider} request failed (${response.status})${detail ? `: ${detail.slice(0, 500)}` : ""}`,
    response.status,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
