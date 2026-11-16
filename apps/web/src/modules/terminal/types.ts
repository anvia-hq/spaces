export type Mode = "run" | "stream" | "background";

export interface Output {
  commandId: string | null;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  running: boolean;
  pid?: number;
  startedAt?: string;
  finishedAt?: string | null;
}
