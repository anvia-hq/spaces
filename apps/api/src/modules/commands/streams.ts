import { ServiceError } from "../../errors.ts";
import { readSandboxProcessOutput, sandboxProcessState, startSandboxProcess } from "./service.ts";

export function commandStream(
  id: string,
  request: { command: string; cwd?: string; timeoutSeconds: number },
): () => AsyncGenerator<Record<string, unknown>, void, unknown> {
  return async function* () {
    let started: Awaited<ReturnType<typeof startSandboxProcess>>;
    try {
      started = await startSandboxProcess(id, request, "stream");
    } catch (error) {
      yield {
        type: "error",
        error: error instanceof ServiceError ? error.code : "internal_error",
        message: error instanceof Error ? error.message : "failed to start command",
        retryable: false,
      };
      return;
    }

    yield { type: "started", commandId: started.commandId, startedAt: started.startedAt };

    let stdoutOffset = 0;
    let stderrOffset = 0;
    for (;;) {
      let state: { running: boolean; exitCode: number | null; known: boolean } | null = null;
      try {
        const [output, live] = await Promise.all([
          readSandboxProcessOutput(id, String(started.pid), { stdoutOffset, stderrOffset }),
          sandboxProcessState(id, String(started.pid)),
        ]);
        state = live;

        if (output.stdout.byteLength > 0) {
          stdoutOffset = output.stdoutNextOffset;
          yield { type: "stdout", data: Buffer.from(output.stdout).toString("utf8") };
        }

        if (output.stderr.byteLength > 0) {
          stderrOffset = output.stderrNextOffset;
          yield { type: "stderr", data: Buffer.from(output.stderr).toString("utf8") };
        }
      } catch (error) {
        yield {
          type: "error",
          error: error instanceof ServiceError ? error.code : "internal_error",
          message: error instanceof Error ? error.message : "stream failed",
          retryable: false,
        };
        return;
      }

      if (!state.running) {
        yield {
          type: "exit",
          success: state.exitCode === 0,
          exitCode: state.exitCode,
          signal: null,
          timedOut: false,
          commandId: started.commandId,
        };
        return;
      }

      await Bun.sleep(150);
    }
  };
}

export function attachStream(
  id: string,
  processId: string,
  query: { stdoutOffset?: number; stderrOffset?: number },
): () => AsyncGenerator<Record<string, unknown>, void, unknown> {
  return async function* () {
    let stdoutOffset = query.stdoutOffset ?? 0;
    let stderrOffset = query.stderrOffset ?? 0;
    const startedAtMs = Date.now();
    let lastFrameAt = Date.now();

    yield {
      type: "attached",
      processId: Number(processId),
      stdoutOffset,
      stderrOffset,
    };

    for (;;) {
      if (Date.now() - startedAtMs > 10 * 60 * 1000) {
        yield { type: "reconnect", stdoutOffset, stderrOffset };
        return;
      }

      let state: { running: boolean; exitCode: number | null; known: boolean } | null = null;
      try {
        const [output, live] = await Promise.all([
          readSandboxProcessOutput(id, processId, { stdoutOffset, stderrOffset }),
          sandboxProcessState(id, processId),
        ]);
        state = live;

        if (output.stdout.byteLength > 0) {
          stdoutOffset = output.stdoutNextOffset;
          lastFrameAt = Date.now();
          yield {
            type: "stdout",
            data: Buffer.from(output.stdout).toString("utf8"),
            nextOffset: stdoutOffset,
          };
        }

        if (output.stderr.byteLength > 0) {
          stderrOffset = output.stderrNextOffset;
          lastFrameAt = Date.now();
          yield {
            type: "stderr",
            data: Buffer.from(output.stderr).toString("utf8"),
            nextOffset: stderrOffset,
          };
        }
      } catch (error) {
        yield {
          type: "error",
          error: error instanceof ServiceError ? error.code : "internal_error",
          message: error instanceof Error ? error.message : "attach failed",
          stdoutOffset,
          stderrOffset,
        };
        return;
      }

      if (!state.running) {
        yield {
          type: "exit",
          status: state.known ? "exited" : "lost",
          exitCode: state.exitCode,
          signal: null,
          stdoutOffset,
          stderrOffset,
        };
        return;
      }

      if (Date.now() - lastFrameAt > 15_000) {
        lastFrameAt = Date.now();
        yield { type: "heartbeat", stdoutOffset, stderrOffset };
      }

      await Bun.sleep(150);
    }
  };
}

export function ndjson(
  factory: () => AsyncGenerator<Record<string, unknown>, void, unknown>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const frames = factory();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await frames.next();

      if (done) {
        controller.close();
        return;
      }

      controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
    },
  });
}
