export type CreateSource =
  | { kind: "sandbox"; id: string; driverRef: string; runtimeId: string }
  | { kind: "snapshot"; name: string; driverRef: string; runtimeId: string };
