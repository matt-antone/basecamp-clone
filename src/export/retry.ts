export type RetryClass =
  | "rate_limited"
  | "server_error"
  | "network_error"
  | "client_error"
  | "unknown";

export type RetryClassification = {
  className: RetryClass;
  retryable: boolean;
  status?: number;
  retryAfterSeconds?: number;
};

export type RetryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
  random?: () => number;
  onRetry?: (context: {
    attempt: number;
    delayMs: number;
    classification: RetryClassification;
    error: unknown;
  }) => void;
  sleep?: (ms: number) => Promise<void>;
};

type RetryLikeError = {
  status?: number;
  retryAfterSeconds?: number;
  code?: string;
};

function extractStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const maybe = error as RetryLikeError;
  return typeof maybe.status === "number" ? maybe.status : undefined;
}

function extractRetryAfterSeconds(error: unknown): number | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const maybe = error as RetryLikeError;
  return typeof maybe.retryAfterSeconds === "number"
    ? maybe.retryAfterSeconds
    : undefined;
}

export function classifyRetryError(error: unknown): RetryClassification {
  const status = extractStatus(error);

  if (status === 429) {
    return {
      className: "rate_limited",
      retryable: true,
      status,
      retryAfterSeconds: extractRetryAfterSeconds(error)
    };
  }

  if (typeof status === "number" && status >= 500) {
    return {
      className: "server_error",
      retryable: true,
      status,
      retryAfterSeconds: extractRetryAfterSeconds(error)
    };
  }

  if (typeof status === "number" && status >= 400) {
    return {
      className: "client_error",
      retryable: false,
      status
    };
  }

  if (error instanceof Error) {
    const name = error.name.toLowerCase();
    const message = error.message.toLowerCase();

    if (
      name.includes("abort") ||
      name.includes("timeout") ||
      message.includes("network") ||
      message.includes("fetch")
    ) {
      return {
        className: "network_error",
        retryable: true
      };
    }
  }

  return {
    className: "unknown",
    retryable: false,
    status
  };
}

export function calculateRetryDelayMs(
  attempt: number,
  classification: RetryClassification,
  options: Pick<RetryOptions, "baseDelayMs" | "maxDelayMs" | "jitterRatio" | "random">
): number {
  const baseDelayMs = options.baseDelayMs ?? 250;
  const maxDelayMs = options.maxDelayMs ?? 10_000;
  const jitterRatio = options.jitterRatio ?? 0.2;
  const random = options.random ?? Math.random;

  const retryAfterMs = classification.retryAfterSeconds
    ? classification.retryAfterSeconds * 1_000
    : undefined;

  const exponential = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
  const base = retryAfterMs ?? exponential;
  const jitterWindow = Math.max(1, Math.floor(base * jitterRatio));
  const jitter = Math.floor((random() * 2 - 1) * jitterWindow);

  return Math.max(0, Math.min(base + jitter, maxDelayMs));
}

export async function executeWithRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 4;
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  let attempt = 1;

  while (attempt <= maxAttempts) {
    try {
      return await operation(attempt);
    } catch (error) {
      const classification = classifyRetryError(error);
      const hasAttemptsRemaining = attempt < maxAttempts;

      if (!classification.retryable || !hasAttemptsRemaining) {
        throw error;
      }

      const delayMs = calculateRetryDelayMs(attempt, classification, options);
      options.onRetry?.({
        attempt,
        delayMs,
        classification,
        error
      });

      await sleep(delayMs);
      attempt += 1;
    }
  }

  throw new Error("Retry loop exited unexpectedly.");
}
