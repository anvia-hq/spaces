import { config } from "../../config.ts";
import { ServiceError } from "../../errors.ts";
import { driver } from "../driver/service.ts";
import { isLocalHost } from "../driver/ssh.ts";
import { hostSandboxPort } from "../ports/service.ts";
import { requireLiveSandbox } from "../sandboxes/service.ts";

function sshHostOf(remote: boolean, origin: string): string {
  if (config.previewHost) return config.previewHost.replace(/^https?:\/\//, "").replace(/\/$/, "");

  if (remote) return config.msbHost;

  return new URL(origin).hostname;
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
  const { ref } = await requireLiveSandbox(id);
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
  const setup = await driver().exec(ref, {
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
  const start = await driver().exec(ref, {
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

  // The client reaches the published port on the host that runs msb, which is
  // not this machine when SPACES_MSB_HOST points elsewhere. Either way, a port
  // bound to loopback is reachable only from the host itself — including when
  // the control plane and the runner are the same machine, because the caller
  // is still somewhere else (a browser behind `tailscale serve`).
  const remote = !isLocalHost(config.msbHost);
  const host = sshHostOf(remote, origin);

  // Exposure is governed by what the port binds, not by where msb runs.
  const loopbackOnly = /^(127\.|localhost$|::1$)/.test(config.portBind);
  const forwardTarget = remote ? config.msbHost : new URL(origin).hostname;

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

  if (loopbackOnly) {
    answer.note =
      `Port ${hosted.hostPort} is published on ` +
      `${remote ? `${config.msbHost}'s` : "this host's"} loopback only, so it is ` +
      "reachable from that machine rather than over the network. Forward it " +
      `yourself: ssh -N -L ${hosted.hostPort}:127.0.0.1:${hosted.hostPort} ` +
      `${forwardTarget}, or set SPACES_PORT_BIND=0.0.0.0 there to connect directly.`;
  }

  return answer;
}
