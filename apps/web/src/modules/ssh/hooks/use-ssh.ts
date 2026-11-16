import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ApiError, api, type SshKeyResult } from "@/lib/api.ts";
import { looksPublic } from "../command.ts";

const STORE = "spaces.ssh.";
const KEY = "spaces.sshkey.";

export function useSsh(sandboxId: string) {
  const [publicKey, setPublicKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SshKeyResult | null>(null);
  const [storedKey, setStoredKey] = useState<string | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem(STORE + sandboxId);
    setStoredKey(localStorage.getItem(KEY + sandboxId));

    if (!saved) return;

    try {
      setResult(JSON.parse(saved) as SshKeyResult);
    } catch {
      setResult(null);
    }
  }, [sandboxId]);

  async function configure() {
    setError(null);

    if (!looksPublic(publicKey)) {
      setError("That does not look like an OpenSSH public key (ssh-ed25519 AAAA…).");
      return;
    }

    setBusy(true);
    try {
      const value = await api.sshKey(sandboxId, publicKey.trim());
      setResult(value);
      setStoredKey(publicKey.trim());
      localStorage.setItem(STORE + sandboxId, JSON.stringify(value));
      localStorage.setItem(KEY + sandboxId, publicKey.trim());
      setPublicKey("");
      toast.success("Key authorized");
    } catch (e) {
      setError(e instanceof ApiError ? `${e.code}: ${e.message}` : String(e));
    } finally {
      setBusy(false);
    }
  }

  return { publicKey, setPublicKey, busy, error, result, storedKey, configure };
}
