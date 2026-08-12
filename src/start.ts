import { createStart, createCsrfMiddleware, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { validateEnv } from "./lib/env";
import { getClientIp } from "./lib/rate-limit";

// Validate env once on cold start so the operator sees ALL missing keys
// in a single log line instead of one-at-a-time per serverFn.
validateEnv();

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// Stash the client IP and the request headers into the serverFn context
// so handlers can read them without re-deriving from the raw `Request`.
// The request middleware runs before every serverFn call (and every page
// request), but the IP + headers are only read by handlers that care
// about rate-limiting or origin validation.
const ipMiddleware = createMiddleware({ type: "request" }).server(async ({ request, next }) => {
  const ip = getClientIp(request.headers);
  return next({ context: { ip, headers: request.headers } });
});

// Start installs this automatically when src/start.ts is absent; defining the
// file opts out, so re-add it explicitly to keep server functions protected
// from cross-site requests.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  requestMiddleware: [errorMiddleware, ipMiddleware, csrfMiddleware],
}));
