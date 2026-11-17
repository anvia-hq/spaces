import { useEffect, useState } from "react";
import { api } from "@/lib/api.ts";
import type { LoginProviderFlags } from "../types.ts";

/**
 * Which alternative sign-in providers the API has credentials for.
 *
 * The flag comes from the server (`GET /api/v1/me`, which needs a credential
 * the signed-out browser does not have) rather than from the build, so one
 * console build serves every deployment. Until the answer arrives nothing is
 * offered: a "Continue with GitHub" button that the server would answer `404`
 * on is worse than no button at all (docs/decision/0034).
 */
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
