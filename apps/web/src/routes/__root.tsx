import { Outlet, createRootRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/console/app-shell";
import { NotFound } from "@/components/console/not-found";
import { AuthScreen } from "@/modules/auth/components/auth-screen.tsx";
import { useAuth } from "@/modules/auth/hooks/use-auth.ts";
import { useThemeShortcut } from "@/lib/use-theme-shortcut.ts";

export const Route = createRootRoute({
  component: Root,
  notFoundComponent: NotFound,
});

function Root() {
  const { auth, signOut } = useAuth();
  useThemeShortcut();

  if (auth.status === "loading") {
    return <Booting />;
  }

  if (auth.status === "signed-out") {
    return <AuthScreen />;
  }

  return (
    <AppShell user={auth.user} onSignOut={() => void signOut()}>
      <Outlet />
    </AppShell>
  );
}

function Booting() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <div className="flex items-center gap-2.5 text-base text-muted-foreground">
        <span
          aria-hidden
          className="size-3 animate-spin rounded-full border border-current border-t-transparent"
        />
        spaces
      </div>
    </div>
  );
}
