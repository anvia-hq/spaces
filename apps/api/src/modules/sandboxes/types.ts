import type { NetworkPolicy } from "@spaces/shared/sandbox";

export type CreateSource =
  | {
      kind: "sandbox";
      id: string;
      driverRef: string;
      runtimeId: string;
      networkPolicy: NetworkPolicy | null;
    }
  | { kind: "snapshot"; name: string; driverRef: string; runtimeId: string };
