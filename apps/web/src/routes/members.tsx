import { createFileRoute } from "@tanstack/react-router";
import { Notice } from "@/components/console/notice";
import { MembersPage } from "@/modules/members/components/members-page.tsx";
import { useAuth } from "@/modules/auth/hooks/use-auth.ts";

export const Route = createFileRoute("/members")({ component: MembersRoute });

function MembersRoute() {
  const { auth } = useAuth();

  if (auth.status !== "signed-in" || !auth.user.admin) {
    return (
      <Notice kind="warn">
        Only an admin can manage accounts and machine sizes. Ask an admin to promote this address,
        or put it in SPACES_ADMIN_EMAILS and sign in again.
      </Notice>
    );
  }

  return <MembersPage self={null} />;
}
