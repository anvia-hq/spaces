import type { SshKeyResult } from "@/lib/api.ts";

export function looksPublic(key: string): boolean {
  return /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521))\s+AAAA[A-Za-z0-9+/=]+/.test(
    key.trim(),
  );
}

export function sshCommand(result: SshKeyResult): string {
  const endpoint = result.sshEndpoint;
  const port = endpoint?.split(":").pop();
  const host = endpoint ? endpoint.split(":").slice(0, -1).join(":") : result.machineIp;
  return `ssh${endpoint ? ` -p ${port}` : ""} ${result.sshUser}@${host}`;
}
