export type CreateSource =
  | { kind: "sandbox"; id: string; driverRef: string }
  | { kind: "snapshot"; name: string; driverRef: string };
