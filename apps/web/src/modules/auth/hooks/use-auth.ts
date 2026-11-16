import { useCallback } from "react";
import { signOut as authSignOut, useSession } from "@/lib/auth-client.ts";

export type AuthUser = { email: string; name: string | null };

export type Auth =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "signed-in"; user: AuthUser };

/**
 * Who the console is acting as.
 *
 * The console is login-first and session-only: without a session the shell is
 * not rendered at all. The operator key is for API clients, not this UI. `loading` matters — better-auth resolves the
 * session asynchronously, and treating "not known yet" as "signed out" flashes
 * the login screen on every reload.
 */
export function useAuth() {
  const session = useSession();

  const signOut = useCallback(async () => {
    await authSignOut().catch(() => undefined);
    await session.refetch();
  }, [session]);

  let auth: Auth = { status: "signed-out" };

  if (session.isPending) {
    auth = { status: "loading" };
  } else if (session.data?.user) {
    auth = {
      status: "signed-in",
      user: { email: session.data.user.email, name: session.data.user.name ?? null },
    };
  }

  return { auth, signOut };
}
