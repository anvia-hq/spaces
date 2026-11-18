import { afterEach, describe, expect, test } from "bun:test";
import { config } from "../../config.ts";
import { detectResources } from "../driver/resources.ts";
import { capacityOf, noRoomMessage, roomFor } from "./placement.ts";

const idle = { active: 0, total: 0, snapshots: 0, vcpu: 0, memMib: 0 };

describe("capacity", () => {
  test("a runtime that reported nothing has no capacity to compare against", () => {
    expect(capacityOf({ vcpu: null, memMib: null }, 1)).toBeNull();
    expect(capacityOf({ vcpu: 8, memMib: null }, 1)).toBeNull();
  });

  test("overcommit scales both dimensions and a nonsense factor means none", () => {
    expect(capacityOf({ vcpu: 8, memMib: 16384 }, 1)).toEqual({ vcpu: 8, memMib: 16384 });
    expect(capacityOf({ vcpu: 8, memMib: 16384 }, 1.5)).toEqual({ vcpu: 12, memMib: 24576 });
    expect(capacityOf({ vcpu: 8, memMib: 16384 }, 0)).toEqual({ vcpu: 8, memMib: 16384 });
    expect(capacityOf({ vcpu: 8, memMib: 16384 }, -3)).toEqual({ vcpu: 8, memMib: 16384 });
  });
});

describe("room", () => {
  const capacity = { vcpu: 8, memMib: 16384 };

  test("a size fits exactly into what is left, and not a unit more", () => {
    const load = { ...idle, vcpu: 6, memMib: 12288 };

    expect(roomFor(capacity, load, { vcpu: 2, memMib: 4096, diskGb: 51 }).fits).toBe(true);
    expect(roomFor(capacity, load, { vcpu: 3, memMib: 4096, diskGb: 51 }).fits).toBe(false);
    expect(roomFor(capacity, load, { vcpu: 2, memMib: 4097, diskGb: 51 }).fits).toBe(false);
  });

  test("either dimension can be the one that is full", () => {
    const cpuBound = roomFor(
      capacity,
      { ...idle, vcpu: 8, memMib: 0 },
      { vcpu: 1, memMib: 512, diskGb: 5 },
    );
    const memBound = roomFor(
      capacity,
      { ...idle, vcpu: 0, memMib: 16384 },
      { vcpu: 1, memMib: 512, diskGb: 5 },
    );

    expect(cpuBound.fits).toBe(false);
    expect(memBound.fits).toBe(false);
  });

  test("utilization is the fuller dimension after placement", () => {
    const room = roomFor(
      capacity,
      { ...idle, vcpu: 2, memMib: 8192 },
      { vcpu: 2, memMib: 4096, diskGb: 5 },
    );

    expect(room.utilization).toBe(Math.max(4 / 8, 12288 / 16384));
    expect(room.utilization).toBe(0.75);
  });

  test("free never goes negative when a runtime is already over", () => {
    const room = roomFor(
      capacity,
      { ...idle, vcpu: 20, memMib: 99999 },
      { vcpu: 1, memMib: 512, diskGb: 5 },
    );

    expect(room.free).toEqual({ vcpu: 0, memMib: 0 });
    expect(room.fits).toBe(false);
  });

  test("the refusal says what was asked and what is free", () => {
    const size = { vcpu: 4, memMib: 8192, diskGb: 51 };
    const room = roomFor(capacity, { ...idle, vcpu: 6, memMib: 8192 }, size);

    expect(noRoomMessage("edge", size, room)).toBe(
      "runtime edge has no room for 4 vCPU / 8192 MiB (free: 2 vCPU / 8192 MiB of 8 vCPU / 16384 MiB)",
    );
  });
});

describe("what a runtime reports about itself", () => {
  const original = { ...config.runtime };

  afterEach(() => {
    Object.assign(config.runtime, original);
  });

  test("the mock driver is not a machine, so it reports nothing", () => {
    expect(detectResources("mock", true)).toBeNull();
  });

  test("an operator's numbers win, for any driver", () => {
    Object.assign(config.runtime, { vcpu: 6, memMib: 12000 });

    expect(detectResources("mock", true)).toEqual({ vcpu: 6, memMib: 12000 });
    expect(detectResources("microsandbox", false)).toEqual({ vcpu: 6, memMib: 12000 });
  });

  test("a local microsandbox host is measured, less what is reserved for the host", () => {
    Object.assign(config.runtime, { vcpu: 0, memMib: 0, reserveMib: 1024 });
    const detected = detectResources("microsandbox", true);

    expect(detected).not.toBeNull();
    expect(detected!.vcpu).toBeGreaterThanOrEqual(1);

    Object.assign(config.runtime, { reserveMib: 0 });
    const unreserved = detectResources("microsandbox", true);

    expect(unreserved!.memMib - detected!.memMib).toBe(1024);
  });

  test("a host reached over SSH cannot be measured from here", () => {
    Object.assign(config.runtime, { vcpu: 0, memMib: 0 });

    expect(detectResources("microsandbox", false)).toBeNull();
  });

  test("half a declaration is completed from the host, not trusted alone", () => {
    Object.assign(config.runtime, { vcpu: 3, memMib: 0, reserveMib: 0 });
    const detected = detectResources("microsandbox", true);

    expect(detected!.vcpu).toBe(3);
    expect(detected!.memMib).toBeGreaterThan(256);
  });
});
