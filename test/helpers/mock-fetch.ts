import { vi } from "vitest";

type JsonValue = Record<string, unknown> | Array<unknown>;

export function jsonResponse(
  body: JsonValue,
  init: ResponseInit = {}
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      "content-type": "application/json",
      ...init.headers
    }
  });
}

export function createRouteFetch(
  routes: Record<string, (url: URL) => Response | Promise<Response>>
): typeof fetch {
  return vi.fn(async (input) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    const handler = routes[url.pathname];

    if (!handler) {
      throw new Error(`No mock route for ${url.pathname}`);
    }

    return handler(url);
  }) as unknown as typeof fetch;
}
