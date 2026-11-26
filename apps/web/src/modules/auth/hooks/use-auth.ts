import { useCallback } from "react";
import { signOut as authSignOut, useSession } from "@/lib/auth-client.ts";

export type AuthUser = { email: string; name: string | null; admin: boolean };

export type Auth =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "signed-in"; user: AuthUser };

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
    const role = (session.data.user as { role?: string | null }).role ?? "user";

    auth = {
      status: "signed-in",
      user: {
        email: session.data.user.email,
        name: session.data.user.name ?? null,
        admin: role.split(",").includes("admin"),
      },
    };
  }

  return { auth, signOut };
}
