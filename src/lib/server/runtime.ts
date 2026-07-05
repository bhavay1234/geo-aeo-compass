import { AsyncLocalStorage } from 'node:async_hooks';
import type { Env } from '../db/supabase';

export interface ExecutionCtxLike {
  waitUntil?: (promise: Promise<unknown>) => void;
  passThroughOnException?: () => void;
}

export interface WorkerRuntime {
  env: Env;
  ctx: ExecutionCtxLike | null;
}

// AsyncLocalStorage instance is pinned to a global symbol so HMR / module
// duplication in dev can't fork it into two stores.
const STORAGE_KEY = Symbol.for('aeo-tracker:worker-runtime');
const g = globalThis as unknown as Record<symbol, unknown>;
if (!g[STORAGE_KEY]) {
  g[STORAGE_KEY] = new AsyncLocalStorage<WorkerRuntime>();
}
const runtimeStorage = g[STORAGE_KEY] as AsyncLocalStorage<WorkerRuntime>;

/**
 * Wraps a request handler invocation in AsyncLocalStorage so that any
 * downstream server function can read Cloudflare's `env` and `ctx`
 * via getEnv() / getExecutionCtx().
 */
export function runWithRuntime<T>(
  env: Env,
  ctx: ExecutionCtxLike | null | undefined,
  fn: () => T
): T {
  // PHASE 3.10 DIAGNOSTIC - remove after env binding confirmed working
  console.log(
    '[runtime.ts] storing env keys:',
    Object.keys((env as object) || {})
  );
  return runtimeStorage.run({ env, ctx: ctx ?? null }, fn);
}

export function getEnv(): Env {
  const runtime = runtimeStorage.getStore();
  // PHASE 3.10 DIAGNOSTIC - remove after env binding confirmed working
  console.log(
    '[runtime.ts] getEnv returning keys:',
    Object.keys((runtime?.env as object) || {})
  );
  if (!runtime?.env) {
    throw new Error(
      'Worker runtime not initialized - env unavailable. ' +
        'Server function called outside runWithRuntime() scope.'
    );
  }
  return runtime.env;
}

export function getExecutionCtx(): ExecutionCtxLike | null {
  return runtimeStorage.getStore()?.ctx ?? null;
}
