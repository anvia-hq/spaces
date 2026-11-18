import { describe, expect, test } from "bun:test";
import {
  AgentFrame,
  ControlFrame,
  DRIVER_METHODS,
  PROTOCOL_VERSION,
  decodeFrame,
  encodeFrame,
} from "@spaces/shared/runtime";
import { MockDriver } from "../driver/mock.ts";
import { MicrosandboxDriver } from "../driver/microsandbox.ts";
import { remoteDriver } from "../driver/remote.ts";
import { controlSocketUrl, wireErrorOf } from "../runtime-agent/agent.ts";
import { DriverFailure, DriverUnsupported } from "../../errors.ts";

describe("the frame codec", () => {
  test("bytes survive a round trip, nested anywhere", () => {
    const original = {
      t: "call",
      id: 7,
      method: "writeFile",
      args: [
        "ref",
        "/home/user/a.bin",
        new Uint8Array([0, 1, 254, 255]),
        { nested: [new Uint8Array([9])] },
      ],
    };
    const decoded = decodeFrame(encodeFrame(original)) as typeof original;

    expect(decoded.args[2]).toEqual(new Uint8Array([0, 1, 254, 255]));
    expect((decoded.args[3] as { nested: Uint8Array[] }).nested[0]).toEqual(new Uint8Array([9]));
    expect(decoded.args[0]).toBe("ref");
  });

  test("a Node Buffer is encoded as bytes too", () => {
    const decoded = decodeFrame(encodeFrame({ data: Buffer.from("hello") })) as {
      data: Uint8Array;
    };

    expect(new TextDecoder().decode(decoded.data)).toBe("hello");
  });

  test("a plain object that merely mentions the marker is left alone", () => {
    const decoded = decodeFrame(encodeFrame({ note: "$b64", list: [1, 2] }));

    expect(decoded).toEqual({ note: "$b64", list: [1, 2] });
  });
});

describe("the frames", () => {
  test("a call to a method that is not a driver method is refused", () => {
    const refused = ControlFrame.safeParse({ t: "call", id: 1, method: "constructor", args: [] });

    expect(refused.success).toBe(false);
  });

  test("an agent's hello carries what the control plane needs to route to it", () => {
    const hello = AgentFrame.safeParse({
      t: "hello",
      protocol: PROTOCOL_VERSION,
      agentVersion: "1",
      driver: "mock",
      capabilities: { exec: true, files: false, persistence: true },
      portRange: { start: 1, end: 2 },
      portBind: "127.0.0.1",
      publicHost: null,
    });

    expect(hello.success).toBe(true);
  });

  test("the first result variant and the error variant both parse", () => {
    expect(AgentFrame.safeParse({ t: "result", id: 1, ok: true, value: null }).success).toBe(true);
    expect(
      AgentFrame.safeParse({
        t: "result",
        id: 1,
        ok: false,
        error: { name: "Error", message: "x" },
      }).success,
    ).toBe(true);
    expect(AgentFrame.safeParse({ t: "result", id: 1, ok: false }).success).toBe(false);
  });
});

describe("every SandboxDriver method crosses the wire", () => {
  test("each name in the protocol is a function on both real drivers", () => {
    const mock = new MockDriver() as unknown as Record<string, unknown>;
    const micro = new MicrosandboxDriver({ host: "local" }) as unknown as Record<string, unknown>;

    for (const method of DRIVER_METHODS) {
      expect({ method, mock: typeof mock[method] }).toEqual({ method, mock: "function" });
      expect({ method, micro: typeof micro[method] }).toEqual({ method, micro: "function" });
    }
  });

  test("the remote driver answers to exactly those names and forwards arguments untouched", async () => {
    const seen: { method: string; args: unknown[] }[] = [];
    const built = remoteDriver(
      {
        async call(method, args) {
          seen.push({ method, args });
          return method;
        },
      },
      { kind: "mock", capabilities: { exec: true, files: true, persistence: true } },
    );
    const driver = built as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;

    for (const method of DRIVER_METHODS) {
      expect(String(await driver[method]!("a", 2))).toBe(method);
    }

    expect(seen.map((call) => call.method)).toEqual([...DRIVER_METHODS]);
    expect(seen[0]!.args).toEqual(["a", 2]);
    expect(built.kind).toBe("mock");
  });
});

describe("errors keep their class on the way over", () => {
  test("a refusal stays a refusal and keeps what it was about", () => {
    const wire = wireErrorOf(new DriverUnsupported("Guest operations", "no guest here"));

    expect(wire).toMatchObject({
      name: "DriverUnsupported",
      operation: "Guest operations",
      reason: "no guest here",
    });
  });

  test("a failure keeps its detail, an unknown error becomes a plain one", () => {
    expect(wireErrorOf(new DriverFailure("boom", "stderr text"))).toEqual({
      name: "DriverFailure",
      message: "boom",
      detail: "stderr text",
    });
    expect(wireErrorOf("odd")).toEqual({ name: "Error", message: "odd" });
  });
});

describe("the control URL", () => {
  test("http becomes ws and https becomes wss, on the connect path", () => {
    expect(controlSocketUrl("http://localhost:8787")).toBe("ws://localhost:8787/runtime/connect");
    expect(controlSocketUrl("https://spaces.example.com/ignored?x=1")).toBe(
      "wss://spaces.example.com/runtime/connect",
    );
  });
});
