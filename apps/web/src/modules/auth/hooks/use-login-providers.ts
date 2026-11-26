import { useEffect, useState } from "react";
import { api } from "@/lib/api.ts";
import type { LoginProviderFlags } from "../types.ts";

export function useLoginProviders() {
  const [providers, setProviders] = useState<LoginProviderFlags | null>(null);

  useEffect(() => {
    let live = true;

    api
      .me()
      .then((answer) => {
        if (live) setProviders(answer.login);
      })
      .catch(() => undefined);

    return () => {
      live = false;
    };
  }, []);

  return providers;
}
