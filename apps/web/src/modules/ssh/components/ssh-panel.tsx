import { KeyRound, TerminalSquare } from "lucide-react";
import { CopyButton } from "@/components/console/copy-button";
import { EmptyState } from "@/components/console/empty-state";
import { Notice } from "@/components/console/notice";
import { Panel } from "@/components/console/panel";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { looksPublic, sshCommand } from "../command.ts";
import { useSsh } from "../hooks/use-ssh.ts";

export function SshPanel({ sandboxId, live }: { sandboxId: string; live: boolean }) {
  const { publicKey, setPublicKey, busy, error, result, storedKey, configure } = useSsh(sandboxId);

  return (
    <div className="flex flex-col gap-4">
      <Panel flush>
        <div className="flex flex-col gap-3 p-3.5">
          <div>
            <h2 className="text-base font-semibold text-foreground">Authorize a key</h2>
            <p className="mt-0.5 text-base text-muted-foreground">
              Installs an SSH server in the guest, authorizes your key and publishes port 22.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="sshkey-input"
              className="flex items-center gap-1.5 text-base font-medium text-muted-foreground"
            >
              <KeyRound className="size-3" />
              Public key
            </label>
            <Textarea
              id="sshkey-input"
              className="min-h-[84px] resize-y text-base leading-relaxed"
              value={publicKey}
              spellCheck={false}
              placeholder="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI… you@laptop"
              aria-invalid={publicKey.length > 0 && !looksPublic(publicKey) ? true : undefined}
              onChange={(e) => setPublicKey(e.target.value)}
              disabled={!live}
            />
            <span className="text-base leading-relaxed text-muted-foreground/80">
              Paste the contents of an <code>id_ed25519.pub</code>. The private key never leaves
              your machine.
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={!live || !publicKey.trim() || busy}
              onClick={() => void configure()}
            >
              {busy ? <Spinner className="size-3.5" /> : <KeyRound className="size-3.5" />}
              Authorize key
            </Button>
            {!live && <span className="text-base text-warning">Resume the sandbox first.</span>}
          </div>

          {error && <Notice>{error}</Notice>}
          {result?.message && <Notice kind="warn">{result.message}</Notice>}
        </div>
      </Panel>

      {result ? (
        <Panel title="Connect" subtitle="Run this from a terminal on your own machine." flush>
          <dl className="divide-y divide-border/70">
            <div className="flex flex-wrap items-center gap-2 px-3.5 py-2.5">
              <dt className="w-24 shrink-0 text-base tracking-wide text-muted-foreground">
                endpoint
              </dt>
              <dd className="min-w-0 flex-1 truncate text-base text-foreground">
                {result.sshEndpoint ?? result.machineIp ?? "—"}
              </dd>
              <CopyButton value={result.sshEndpoint ?? result.machineIp ?? ""} label="" />
            </div>
            <div className="flex flex-wrap items-center gap-2 px-3.5 py-2.5">
              <dt className="w-24 shrink-0 text-base tracking-wide text-muted-foreground">
                command
              </dt>
              <dd className="min-w-0 flex-1 truncate text-base text-foreground">
                {sshCommand(result)}
              </dd>
              <CopyButton value={sshCommand(result)} label="" />
            </div>
            {result.hostKey && (
              <div className="flex flex-wrap items-start gap-2 px-3.5 py-2.5">
                <dt className="w-24 shrink-0 pt-0.5 text-base tracking-wide text-muted-foreground">
                  host key
                </dt>
                <dd className="min-w-0 flex-1 text-base break-all text-foreground/80">
                  {result.hostKey}
                </dd>
                <CopyButton value={result.hostKey} label="" />
              </div>
            )}
          </dl>
          <div className="flex items-center justify-between gap-2 border-t border-border/70 px-3.5 py-2">
            <span className="text-base text-muted-foreground">
              {storedKey
                ? `authorized ${storedKey.split(" ").pop()}`
                : "authorized key stored in this browser"}
            </span>
            <span className="text-base text-muted-foreground/70">
              pin the host key in known_hosts
            </span>
          </div>
          {result.note && (
            <div className="border-t border-border/70 p-3">
              <Notice kind="warn">{result.note}</Notice>
            </div>
          )}
        </Panel>
      ) : (
        <Panel>
          <EmptyState
            glyph="⌸"
            icon={<TerminalSquare className="size-4" />}
            title="No key authorized yet"
            hint="Authorize a public key above and the connection details appear here."
          />
        </Panel>
      )}
    </div>
  );
}
