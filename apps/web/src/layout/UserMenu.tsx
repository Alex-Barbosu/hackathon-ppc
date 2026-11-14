import { useNavigate } from "@tanstack/react-router";
import { SecondaryButton } from "../components/ui";
import { useSession } from "../state/session";

export function UserMenu() {
  const session = useSession((s) => s.session);
  const signOut = useSession((s) => s.signOut);
  const navigate = useNavigate();
  if (!session) return null;
  return (
    <div className="flex items-center gap-1">
      <span className="label hidden px-3 text-muted md:inline" title={session.username ?? undefined}>{session.role}</span>
      <SecondaryButton onClick={() => { signOut(); void navigate({ to: "/login" }); }}>Sign out</SecondaryButton>
    </div>
  );
}
