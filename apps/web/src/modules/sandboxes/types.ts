export type SandboxTab = "terminal" | "files" | "ports" | "ssh" | "snapshots" | "usage";

/** Run a mutation, then refresh the source it changed, with its toast. */
export type Act = (key: string, fn: () => Promise<unknown>, done: string) => Promise<void>;
