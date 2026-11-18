import { config } from "../../config.ts";
import { ServiceError } from "../../errors.ts";
import { isLocalHost } from "../driver/ssh.ts";
import { hostSandboxPort } from "../ports/service.ts";
import { requireRuntime } from "../runtimes/service.ts";
import { requireLiveSandbox } from "../sandboxes/service.ts";
import { bindOf } from "../sandboxes/host-ports.ts";
import type { RuntimeRow } from "../../db.ts";

function runtimeHost(runtime: RuntimeRow): string | null {
  if (runtime.kind === "agent") return runtime.publicHost;

  return isLocalHost(config.msbHost) ? null : config.msbHost;
}

function sshHostOf(runtime: RuntimeRow, origin: string): string {
  const host = runtimeHost(runtime);

  if (runtime.kind === "agent" && host) return host;

  if (config.previewHost) return config.previewHost.replace(/^https?:\/\//, "").replace(/\/$/, "");

  return host ?? new URL(origin).hostname;
}

const SSH_PUBLIC_KEY =
  /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521))\s+AAAA[A-Za-z0-9+/=]+(\s+.*)?$/;

/**
 * Authorize a public key for SSH and bring up sshd in the guest.
 *
 * The guest has no public address, so the answer carries `sshEndpoint`
 * (`host:port`) rather than `machineIp`, exactly the case boat's schema
 * describes. The port is published *before* sshd starts, because adding a
 * mapping restarts the microVM and would kill the daemon it just launched.
 */
export async function configureSandboxSsh(id: string, publicKey: string, origin: string) {
  const { sandbox, ref, driver } = await requireLiveSandbox(id);
  const runtime = await requireRuntime(sandbox.runtimeId);
  const key = publicKey.trim().replace(/\r/g, "");

  if (/PRIVATE KEY/.test(key)) {
    throw new ServiceError(
      "invalid_body",
      "Send an OpenSSH public key (`ssh-ed25519 AAAA...`), not a private key.",
    );
  }

  if (!SSH_PUBLIC_KEY.test(key)) {
    throw new ServiceError(
      "invalid_body",
      "Not an OpenSSH public key: expected `ssh-ed25519|ssh-rsa|ecdsa-... AAAA...`.",
    );
  }

  // 1. Publish guest 22 first: this may restart the microVM.
  const hosted = await hostSandboxPort(id, { port: 22 }, origin);

  // 2. Install sshd and authorize the key (disk changes, so a restart is safe).
  const setup = await driver.exec(ref, {
    runAs: "root",
    command: [
      "set -e",
      "command -v sshd >/dev/null 2>&1 || { command -v apk >/dev/null 2>&1 && apk add --no-cache openssh >/dev/null 2>&1; }",
      "id user >/dev/null 2>&1 || adduser -D -s /bin/sh user >/dev/null 2>&1 || true",
      // adduser leaves the account locked (`!` in /etc/shadow), and OpenSSH
      // refuses even pubkey logins for a locked account. Give it an unusable
      // random hash: PasswordAuthentication stays off, so it only unlocks it.
      `echo "user:$(head -c 24 /dev/urandom | base64)" | chpasswd 2>/dev/null || true`,
      "mkdir -p /home/user/.ssh",
      "chmod 700 /home/user/.ssh",
      `printf '%s\\n' "$1" > /home/user/.ssh/authorized_keys`,
      "chmod 600 /home/user/.ssh/authorized_keys",
      "chown -R user:user /home/user/.ssh 2>/dev/null || true",
      "ssh-keygen -A >/dev/null 2>&1 || true",
      "mkdir -p /run/sshd",
      "echo SETUP_OK",
    ].join("\n"),
    timeoutSeconds: 240,
    // The key travels as an argument, never interpolated into the script.
    args: [key],
  });

  if (setup.exitCode !== 0 || !setup.stdout.includes("SETUP_OK")) {
    throw new ServiceError(
      "provider_not_configured",
      `Could not prepare sshd in the sandbox: ${(setup.stderr || setup.stdout).trim().slice(0, 300)}`,
    );
  }

  // 3. Start sshd detached (a plain background job would block the exec).
  const start = await driver.exec(ref, {
    runAs: "root",
    command: [
      "set -e",
      "pkill -x sshd >/dev/null 2>&1 || true",
      "sleep 0.2",
      "setsid /usr/sbin/sshd -D -p 22 -o PermitRootLogin=no -o PasswordAuthentication=no -o PubkeyAuthentication=yes </dev/null >/var/log/sshd.log 2>&1 &",
      "sleep 1.5",
      "netstat -tln 2>/dev/null | grep -q ':22 ' && echo SSH_LISTENING || { echo SSH_NOT_LISTENING; tail -5 /var/log/sshd.log; }",
      "cat /etc/ssh/ssh_host_ed25519_key.pub 2>/dev/null || true",
    ].join("\n"),
    timeoutSeconds: 60,
  });

  if (!start.stdout.includes("SSH_LISTENING")) {
    throw new ServiceError(
      "internal",
      `sshd did not start in the sandbox: ${(start.stdout || start.stderr).trim().slice(0, 300)}`,
    );
  }

  const hostKey =
    start.stdout
      .split("\n")
      .find((line) => line.startsWith("ssh-"))
      ?.trim() ?? "";

  const published = runtimeHost(runtime);
  const host = sshHostOf(runtime, origin);
  const loopbackOnly = /^(127\.|localhost$|::1$)/.test(bindOf(runtime));
  const forwardTarget = published ?? new URL(origin).hostname;
  let where = "this host's";

  if (runtime.kind === "agent") where = `runtime ${runtime.name}'s`;
  else if (published) where = `${published}'s`;

  const answer: {
    machineIp: string | null;
    sshUser: string;
    sshEndpoint: string;
    hostKey: string;
    restartRequired: boolean;
    note?: string;
  } = {
    machineIp: null,
    sshUser: "user",
    sshEndpoint: `${host}:${hosted.hostPort}`,
    hostKey,
    restartRequired: hosted.restartRequired,
  };

  const notes: string[] = [];

  if (runtime.kind === "agent" && !runtime.publicHost) {
    notes.push(
      `Runtime ${runtime.name} advertised no public host (SPACES_RUNTIME_PUBLIC_HOST), so the ` +
        "endpoint names this API's host, which is probably not the machine that holds the port.",
    );
  }

  if (loopbackOnly) {
    notes.push(
      `Port ${hosted.hostPort} is published on ${where} loopback only, so it is ` +
        "reachable from that machine rather than over the network. Forward it " +
        `yourself: ssh -N -L ${hosted.hostPort}:127.0.0.1:${hosted.hostPort} ` +
        `${forwardTarget}, or set SPACES_PORT_BIND=0.0.0.0 there to connect directly.`,
    );
  }

  if (notes.length > 0) answer.note = notes.join(" ");

  return answer;
}
