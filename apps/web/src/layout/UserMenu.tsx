import { useNavigate } from "@tanstack/react-router";
import { useSession } from "../state/session";

export function UserMenu() {
  const session = useSession((s) => s.session);
  const signOut = useSession((s) => s.signOut);
  const navigate = useNavigate();
  if (!session) return null;
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="text-muted">
        {session.username ?? "Signed in"} · <span className="text-ink">{session.role}</span>
      </span>
      <button
        type="button"
        className="rounded-xl px-3 py-2 text-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
        onClick={() => { signOut(); void navigate({ to: "/login" }); }}
      >
        Sign out
      </button>
    </div>
  );
}
