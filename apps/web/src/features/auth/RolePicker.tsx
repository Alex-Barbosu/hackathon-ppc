// The API signs in four demo accounts named after their roles; picking one here fills the username,
// so nobody has to know the convention. The password is shared and comes from DEMO_PASSWORD in .env.
export const ROLES = [
  { id: "dispatch", label: "Dispatch", hint: "Outage records" },
  { id: "field", label: "Field", hint: "Drone video" },
  { id: "connections", label: "Connections", hint: "Customer documents" },
  { id: "admin", label: "Admin", hint: "Policy and chaos" },
] as const;

export function RolePicker({ value, onPick }: { value: string; onPick: (role: string) => void }) {
  return (
    <div role="radiogroup" aria-label="Sign in as" className="grid grid-cols-2 gap-2">
      {ROLES.map((r) => {
        const on = value === r.id;
        return (
          <button key={r.id} type="button" role="radio" aria-checked={on} onClick={() => onPick(r.id)}
            className={`rounded-lg border-[0.8px] px-3 py-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
              on ? "border-white bg-white text-black" : "border-white/16 bg-black/20 text-white hover:bg-white/10"
            }`}>
            <span className="block text-sm font-normal">{r.label}</span>
            <span className={`block text-xs ${on ? "text-black/60" : "text-white/65"}`}>{r.hint}</span>
          </button>
        );
      })}
    </div>
  );
}
