import { badRequest, serverError, unauthorized } from "@/lib/http";
import { ZodError } from "zod";

/**
 * Pattern matched against `Error.message` to classify an error as auth-shaped
 * (e.g. thrown by `requireUser`). Matching errors map to 401 in `withRouteErrors`.
 */
const AUTH_ERROR_PATTERN = /auth|token|workspace/i;

type RouteHandler<Args extends readonly unknown[]> = (...args: Args) => Promise<Response>;

type WithRouteErrorsOptions = {
  /**
   * Optional first-pass error mapper. Runs before the default mapping.
   * Return a Response to short-circuit; return null to fall through to defaults.
   */
  mapError?: (error: unknown) => Response | null;
};

/**
 * Wraps a route handler with the standard error mapping used across the app:
 * - Errors whose message matches `AUTH_ERROR_PATTERN` → 401
 * - ZodError → 400
 * - Anything else → 500
 *
 * Pass `options.mapError` to add a route-specific case before the defaults.
 */
export function withRouteErrors<Args extends readonly unknown[]>(
  handler: RouteHandler<Args>,
  options?: WithRouteErrorsOptions
): RouteHandler<Args> {
  return async (...args: Args) => {
    try {
      return await handler(...args);
    } catch (error) {
      const custom = options?.mapError?.(error);
      if (custom !== null && custom !== undefined) {
        return custom;
      }
      if (error instanceof Error && AUTH_ERROR_PATTERN.test(error.message)) {
        return unauthorized(error.message);
      }
      if (error instanceof ZodError) {
        return badRequest(error.message);
      }
      return serverError();
    }
  };
}
