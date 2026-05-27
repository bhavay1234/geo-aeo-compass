import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { runWithRuntime, type ExecutionCtxLike } from "./lib/server/runtime";
import { handleApiRoute } from "./lib/api/handler";
import { processQueueBatch } from "./lib/audit/queue-consumer";
import type { Env, AuditQueueMessage } from "./lib/db/supabase";

// Minimal shape of Cloudflare's MessageBatch — only the bits we use.
type MessageBatchLike<T> = {
  messages: Array<{ body: T }>;
  ackAll: () => void;
  retryAll: () => void;
};

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => ((m as { default?: ServerEntry }).default ?? (m as unknown as ServerEntry)),
    );
  }
  return serverEntryPromise;
}

function brandedErrorResponse(): Response {
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isCatastrophicSsrErrorBody(body: string, responseStatus: number): boolean {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return false;
  }

  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    return false;
  }

  const fields = payload as Record<string, unknown>;
  const expectedKeys = new Set(["message", "status", "unhandled"]);
  if (!Object.keys(fields).every((key) => expectedKeys.has(key))) {
    return false;
  }

  return (
    fields.unhandled === true &&
    fields.message === "HTTPError" &&
    (fields.status === undefined || fields.status === responseStatus)
  );
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isCatastrophicSsrErrorBody(body, response.status)) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return brandedErrorResponse();
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    // PHASE 3.10 DIAGNOSTIC — remove after env binding confirmed working
    console.log("[server.ts] env keys:", Object.keys((env as object) || {}));
    try {
      // Plain-JSON API routes — dispatched before TanStack Start so they
      // bypass the Seroval-encoded createServerFn RPC protocol. Usable from
      // any HTTP client. See src/lib/api/handler.ts.
      const url = new URL(request.url);
      if (url.pathname.startsWith("/api/")) {
        return await runWithRuntime(
          env as Env,
          ctx as ExecutionCtxLike | null,
          () => handleApiRoute(request)
        );
      }

      const handler = await getServerEntry();
      const response = await runWithRuntime(
        env as Env,
        ctx as ExecutionCtxLike | null,
        () => handler.fetch(request, env, ctx)
      );
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return brandedErrorResponse();
    }
  },

  // Cloudflare Queues consumer — invoked once per batch from audit-jobs.
  // wrappped in runWithRuntime so getEnv() in downstream code works the same
  // way as it does in fetch handlers.
  async queue(
    batch: MessageBatchLike<AuditQueueMessage>,
    env: unknown,
    ctx: unknown
  ) {
    console.log("[server.ts:queue] batch size:", batch.messages.length);
    return await runWithRuntime(
      env as Env,
      ctx as ExecutionCtxLike | null,
      async () => {
        try {
          await processQueueBatch(batch.messages, env as Env);
          batch.ackAll();
        } catch (err) {
          console.error("[queue] batch processing failed:", err);
          batch.retryAll();
        }
      }
    );
  },
};
