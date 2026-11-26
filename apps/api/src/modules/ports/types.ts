export interface HostedPort {
  port: number;
  hostPort: number;
  url: string;
  token: string;
  isProtected: boolean;
  access: "private" | "public";
  title: string | null;
  localhost: boolean;
  restartRequired: boolean;
}
