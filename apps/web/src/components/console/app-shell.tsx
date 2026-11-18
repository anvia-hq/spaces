import { useState, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  Archive,
  Boxes,
  KeyRound,
  LogOut,
  Menu,
  ScrollText,
  Server,
  Users,
} from "lucide-react";
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
      { to: "/runtimes", label: "Runtimes", icon: Server, match: (path) => path === "/runtimes" },
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

/** Only an admin sees this: everything behind it answers 403 to anybody else. */
const ADMIN_GROUP: readonly { label: string; items: readonly NavItem[] }[] = [
  {
    label: "Admin",
    items: [
      { to: "/members", label: "Members", icon: Users, match: (path) => path === "/members" },
    ],
  },
];

/**
 * The signed-in frame: one sidebar and one content column.
 *
 * Pages own their own header, actions and spacing, so the shell stays out of
 * the way. The sidebar is the same component on desktop (a fixed rail) and in
 * the mobile sheet, so the two cannot drift apart.
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
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[240px] border-r bg-sidebar lg:flex">
        <SidebarContent user={user} path={path} onSignOut={onSignOut} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col lg:pl-[240px]">
        <header className="sticky top-0 z-20 flex h-12 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur-xl lg:hidden">
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
            <span className="text-lg font-semibold tracking-brand">spaces</span>
          </Link>
        </header>

        <main
          id="main"
          className={cn(
            "mx-auto w-full flex-1 px-5 py-6 sm:px-8 sm:py-8",
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
          className="bg-sidebar p-0 data-[side=left]:w-[240px] data-[side=left]:border-r lg:hidden"
          showCloseButton={false}
        >
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarContent
            user={user}
            path={path}
            onSignOut={onSignOut}
            onNavigate={() => setMenuOpen(false)}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}

function SidebarContent({
  user,
  path,
  onSignOut,
  onNavigate,
}: {
  user: AuthUser;
  path: string;
  onSignOut: () => void;
  onNavigate?: () => void;
}) {
  const groups = user.admin ? [...GROUPS, ...ADMIN_GROUP] : GROUPS;

  return (
    <div className="flex h-full w-full flex-col">
      <div className="px-3 pt-3 pb-2">
        <Link
          to="/"
          onClick={onNavigate}
          aria-label="spaces home"
          className="flex items-center gap-2.5 rounded-lg p-1.5 transition-colors hover:text-foreground"
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-secondary text-foreground">
            <Mark size={15} />
          </span>
          <span className="truncate text-lg font-semibold tracking-brand text-foreground">
            spaces
          </span>
        </Link>
      </div>

      <nav aria-label="Sections" className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-2">
        {groups.map((group) => (
          <div key={group.label} className="flex flex-col gap-0.5">
            <p className="mb-1 px-2.5 text-2xs font-medium tracking-caps text-muted-foreground uppercase">
              {group.label}
            </p>
            {group.items.map((item) => (
              <NavLink
                key={item.to}
                item={item}
                active={item.match(path)}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        ))}
      </nav>

      <div className="flex flex-col gap-2 p-3">
        <p className="flex items-center gap-2 px-2.5 text-xs text-muted-foreground">
          <kbd className="rounded-sm border bg-card px-1.5 py-0.5 font-mono text-2xs text-foreground">
            D
          </kbd>
          theme
        </p>
        <AccountCard user={user} onSignOut={onSignOut} />
      </div>
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
        "group flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-base transition-colors duration-150",
        active
          ? "bg-accent font-medium text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon
        className={cn(
          "size-4 shrink-0 transition-colors",
          active ? "text-foreground" : "text-muted-foreground group-hover:text-foreground",
        )}
      />
      {item.label}
    </Link>
  );
}

function AccountCard({ user, onSignOut }: { user: AuthUser; onSignOut: () => void }) {
  // The email is the identity here; a display name is decoration on top of it.
  const initials = user.email
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div className="flex items-center gap-2.5 rounded-lg border bg-background/60 p-2">
      <Avatar className="size-8 shrink-0">
        <AvatarFallback className="bg-secondary text-foreground">{initials || "SP"}</AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        <p className="truncate text-base text-foreground" title={user.email}>
          {user.email}
        </p>
        <p className="text-xs text-muted-foreground">{user.admin ? "Admin" : "Member"}</p>
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
