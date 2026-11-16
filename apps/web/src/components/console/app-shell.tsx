import { useState, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { Activity, Archive, Boxes, KeyRound, LogOut, Menu, ScrollText, XIcon } from "lucide-react";
import { Mark } from "@/components/console/mark";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { AuthUser } from "@/modules/auth/hooks/use-auth.ts";
import { cn } from "@/lib/utils";

type NavItem = {
  to: string;
  label: string;
  icon: typeof Boxes;
  match: (path: string) => boolean;
  exact?: boolean;
};

const GROUPS: readonly { label: string; items: readonly NavItem[] }[] = [
  {
    label: "Workspace",
    items: [
      {
        to: "/",
        label: "Sandboxes",
        icon: Boxes,
        match: (path) => path === "/" || path.startsWith("/sandboxes"),
      },
      {
        to: "/snapshots",
        label: "Snapshots",
        icon: Archive,
        match: (path) => path === "/snapshots",
      },
      { to: "/keys", label: "API keys", icon: KeyRound, match: (path) => path === "/keys" },
    ],
  },
  {
    label: "Observability",
    items: [
      { to: "/traces", label: "Traces", icon: Activity, match: (path) => path === "/traces" },
      {
        to: "/audit",
        label: "Audit log",
        icon: ScrollText,
        match: (path) => path === "/audit",
      },
    ],
  },
];

/**
 * The signed-in frame: a fixed sidebar and one content column.
 *
 * Pages own their own header, actions and spacing, so the shell stays out of
 * the way — the alternative (a global top bar plus per-page sub-headers) is
 * what made the console hard to follow.
 */
export function AppShell({
  user,
  onSignOut,
  children,
}: {
  user: AuthUser;
  onSignOut: () => void;
  children: ReactNode;
}) {
  const path = useRouterState({ select: (state) => state.location.pathname });
  // A route can opt out of the centred column (traces, audit) by declaring
  // `staticData.fullWidth`. Reading it from the match keeps the list of
  // full-width pages in the routes themselves rather than in this shell.
  const fullWidth = useRouterState({
    select: (state) =>
      Boolean((state.matches.at(-1)?.staticData as { fullWidth?: boolean } | undefined)?.fullWidth),
  });
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="flex min-h-dvh bg-background">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[224px] flex-col bg-card/60 lg:flex">
        <Brand />

        <nav
          aria-label="Sections"
          className="flex flex-1 flex-col gap-3.5 overflow-y-auto px-2 py-2"
        >
          {GROUPS.map((group) => (
            <div key={group.label} className="flex flex-col">
              <p className="mb-1 px-2 text-base font-medium text-muted-foreground/70">
                {group.label}
              </p>
              {group.items.map((item) => (
                <NavLink key={item.to} item={item} active={item.match(path)} />
              ))}
            </div>
          ))}
        </nav>

        <div className="p-1.5">
          <AccountBlock user={user} onSignOut={onSignOut} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col lg:pl-[224px]">
        <header className="sticky top-0 z-20 flex h-11 items-center gap-2 bg-background/85 px-3 backdrop-blur-xl lg:hidden">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Open navigation"
            onClick={() => setMenuOpen(true)}
          >
            <Menu />
          </Button>
          <Link to="/" className="flex items-center gap-2">
            <Mark size={17} />
            <span className="text-base font-semibold tracking-brand">spaces</span>
          </Link>
        </header>

        <main
          id="main"
          className={cn(
            "mx-auto w-full flex-1 px-5 py-6 sm:px-8 sm:py-7",
            fullWidth ? "max-w-none" : "max-w-[1180px]",
          )}
        >
          {children}
        </main>
      </div>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        {/* width and border live under the data-side variant, so they must be
            overridden in that namespace — a plain w-[…] loses the merge */}
        <SheetContent
          side="left"
          className="p-0 data-[side=left]:w-[228px] data-[side=left]:border-r-0 lg:hidden"
          showCloseButton={false}
        >
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between px-2 py-2">
              <Link
                to="/"
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-2 px-1"
              >
                <Mark size={17} />
                <span className="text-base font-semibold tracking-brand">spaces</span>
              </Link>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Close navigation"
                onClick={() => setMenuOpen(false)}
              >
                <XIcon />
              </Button>
            </div>

            <nav aria-label="Sections" className="flex flex-1 flex-col gap-3.5 px-2 py-1">
              {GROUPS.map((group) => (
                <div key={group.label} className="flex flex-col">
                  <p className="mb-1 px-2 text-base font-medium text-muted-foreground/70">
                    {group.label}
                  </p>
                  {group.items.map((item) => (
                    <NavLink
                      key={item.to}
                      item={item}
                      active={item.match(path)}
                      onNavigate={() => setMenuOpen(false)}
                    />
                  ))}
                </div>
              ))}
            </nav>

            <div className="p-1.5">
              <AccountBlock user={user} onSignOut={onSignOut} />
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Brand() {
  return (
    <div className="flex h-10 shrink-0 items-center px-2">
      <Link to="/" className="flex items-center gap-2 px-1" aria-label="spaces home">
        <Mark size={17} />
        <span className="text-base font-semibold tracking-brand text-foreground">spaces</span>
      </Link>
    </div>
  );
}

function NavLink({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;

  return (
    <Link
      to={item.to}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex items-center gap-2 rounded-md px-2 py-1.5 text-base font-medium transition-colors duration-150",
        active
          ? "bg-secondary text-foreground"
          : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
      )}
    >
      <Icon
        className={cn(
          "size-3.5 shrink-0 transition-colors",
          active ? "text-foreground" : "text-muted-foreground group-hover:text-foreground",
        )}
      />
      {item.label}
    </Link>
  );
}

function AccountBlock({ user, onSignOut }: { user: AuthUser; onSignOut: () => void }) {
  // The email is the identity here; a display name is decoration on top of it.
  const initials = user.email
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div className="flex items-center gap-2 rounded-md px-1.5 py-1">
      <Avatar className="size-7 shrink-0">
        <AvatarFallback className="bg-secondary text-foreground">{initials || "SP"}</AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        <p className="truncate text-foreground" title={user.email}>
          {user.email}
        </p>
      </div>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button variant="ghost" size="icon-sm" aria-label="Sign out" onClick={onSignOut} />
          }
        >
          <LogOut className="text-muted-foreground" />
        </TooltipTrigger>
        <TooltipContent>Sign out</TooltipContent>
      </Tooltip>
    </div>
  );
}
