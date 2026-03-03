export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

export class ScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScopeError";
  }
}

export class BasecampApiError extends Error {
  readonly status: number;
  readonly body: string | undefined;
  readonly retryAfterSeconds: number | undefined;

  constructor(
    message: string,
    options: {
      status: number;
      body?: string;
      retryAfterSeconds?: number;
    }
  ) {
    super(message);
    this.name = "BasecampApiError";
    this.status = options.status;
    this.body = options.body;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}
