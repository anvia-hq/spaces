import { SpanKind, context, trace } from "@opentelemetry/api";
import type { SandboxDriver } from "../driver/types.ts";

const tracer = () => trace.getTracer("spaces");

const SKIP = new Set(["capabilities", "kind", "then", "constructor"]);

/** Typed property access for a proxy handler, which may be asked for a symbol. */
function read(target: unknown, property: string | symbol): unknown {
  return (target as Record<string | symbol, unknown>)[property];
}

/** Everything async the driver exposes, in one span each. */
export function tracedDriver(driver: SandboxDriver, runtimeId: string): SandboxDriver {
  return new Proxy(driver, {
    get(target, property) {
      const value = read(target, property);

      if (typeof property !== "string" || SKIP.has(property) || typeof value !== "function") {
        return value;
      }

      return (...args: unknown[]) => {
        const result = (value as (...inner: unknown[]) => unknown).apply(target, args);

        if (!(result instanceof Promise)) return result;

        const span = tracer().startSpan(`driver.${property}`, {
          kind: SpanKind.CLIENT,
          attributes: { "spaces.sandbox_id": sandboxIdOf(args), "spaces.runtime_id": runtimeId },
        });

        return context.with(trace.setSpan(context.active(), span), async () => {
          try {
            return await result;
          } catch (error) {
            span.setStatus({
              code: 2,
              message: error instanceof Error ? error.message : String(error),
            });
            throw error;
          } finally {
            span.end();
          }
        });
      };
    },
  });
}

/** First string that looks like a sandbox id, or the first string argument. */
function sandboxIdOf(args: unknown[]): string {
  for (const arg of args) {
    if (typeof arg === "string" && arg.startsWith("bx_")) return arg;

    if (arg && typeof arg === "object" && "sandboxId" in arg) {
      const id = (arg as { sandboxId?: unknown }).sandboxId;

      if (typeof id === "string") return id;
    }
  }

  return "";
}

const QUIET = new Set(["then", "constructor"]);

/** Every store method, in one span each — the query and the mapping under it. */
export function tracedStore<T extends object>(store: T): T {
  return new Proxy(store, {
    get(target, property) {
      const value = read(target, property);

      if (typeof property !== "string" || QUIET.has(property) || typeof value !== "function") {
        return value;
      }

      return (...args: unknown[]) => {
        const result = (value as (...inner: unknown[]) => unknown).apply(target, args);

        if (!(result instanceof Promise)) return result;

        const span = tracer().startSpan(`db.${property}`, { kind: SpanKind.INTERNAL });

        return context.with(trace.setSpan(context.active(), span), async () => {
          try {
            return await result;
          } catch (error) {
            span.setStatus({
              code: 2,
              message: error instanceof Error ? error.message : String(error),
            });
            throw error;
          } finally {
            span.end();
          }
        });
      };
    },
  });
}
