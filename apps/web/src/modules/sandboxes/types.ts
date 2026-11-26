export type SandboxTab = "terminal" | "files" | "ports" | "ssh" | "snapshots" | "usage";

export type Act = (key: string, fn: () => Promise<unknown>, done: string) => Promise<void>;
