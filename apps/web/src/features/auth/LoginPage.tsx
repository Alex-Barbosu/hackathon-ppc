import { useState, type FormEvent } from "react";
import { FIELD, PrimaryButton } from "../../components/ui";
import { GridMark } from "../../components/phone/PhoneScreen";
import { GridScene } from "../../components/GridScene";
import { ROLES } from "./roles";
import { useLogin } from "./useLogin";

export function LoginPage() {
  const login = useLogin();
  const [username, setUsername] = useState("dispatch");
  const [password, setPassword] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate({ username: username.trim(), password });
  };
  return (
    // An operator console sign-in: the form and nothing to read first. The live scene stays as the backdrop.
    <main className="relative grid min-h-dvh place-items-center overflow-hidden p-4">
      <div className="absolute inset-0 opacity-70"><GridScene mood="dusk" /></div>
      <div aria-hidden className="absolute inset-0 bg-linear-to-t from-canvas via-canvas/60 to-canvas/20" />
      <section className="relative w-full max-w-[430px] rounded-card border-[0.8px] border-white/14 bg-[#0c0c0c]/85 p-7 shadow-[0_32px_80px_-24px_rgb(0_0_0/0.9)] backdrop-blur-xl">
        <p className="flex items-center gap-2.5 text-base font-medium"><GridMark /> FileGrid</p>
        <p className="mt-1 text-[13px] text-faint">Rețele Electrice România · operations console</p>
        <form onSubmit={submit} className="mt-7 space-y-4">
          <label className="block">
            <span className="label mb-2 block text-faint">Username</span>
            <input className={FIELD} autoComplete="username" required value={username} onChange={(e) => setUsername(e.target.value)} />
          </label>
          <label className="block">
            <span className="label mb-2 block text-faint">Password</span>
            <input className={FIELD} type="password" autoComplete="current-password" autoFocus required value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          {login.isError && <p role="alert" className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">{login.error.message}</p>}
          <PrimaryButton type="submit" className="w-full" disabled={login.isPending}>{login.isPending ? "Signing in…" : "Sign in"}</PrimaryButton>
        </form>
        {/* Demo accounts are named after their roles; one row of chips fills the username without a wall of cards. */}
        <div role="radiogroup" aria-label="Demo account" className="mt-6 flex flex-wrap items-center gap-1.5 border-t-[0.8px] border-line pt-4">
          <span className="label mr-1 text-faint">Demo</span>
          {ROLES.map((r) => (
            <button key={r.id} type="button" role="radio" aria-checked={username === r.id} title={r.hint} onClick={() => setUsername(r.id)}
              className={`label rounded-md px-2 py-1 transition-colors focus-visible:outline-2 focus-visible:outline-accent ${username === r.id ? "bg-white text-black" : "bg-white/8 text-muted hover:text-ink"}`}>
              {r.label}
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}
