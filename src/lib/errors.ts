export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "EMAIL_TAKEN"
  | "NOT_A_WORD"
  | "UNSUPPORTED_LANGUAGE"
  | "RATE_LIMITED"
  | "INTERNAL";

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(message = "Request validation failed", details?: unknown) {
    super(400, "VALIDATION_ERROR", message, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized") {
    super(401, "UNAUTHORIZED", message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found") {
    super(404, "NOT_FOUND", message);
  }
}

export class EmailTakenError extends AppError {
  constructor() {
    super(409, "EMAIL_TAKEN", "An account with this email already exists");
  }
}

export class NotAWordError extends AppError {
  constructor(message = "The input is not a recognised word in this language") {
    super(422, "NOT_A_WORD", message);
  }
}

export class UnsupportedLanguageError extends AppError {
  constructor(language: string) {
    super(422, "UNSUPPORTED_LANGUAGE", `Language "${language}" is not supported`);
  }
}

export class RateLimitedError extends AppError {
  constructor() {
    super(429, "RATE_LIMITED", "Too many requests, please try again later");
  }
}
