import { useState, type FormEvent } from "react";
import { FIELD, PrimaryButton } from "../../components/ui";
import { GridMark } from "../../components/phone/PhoneScreen";
import { TexturePanel } from "../../components/Texture";
import { LoginPhone } from "./LoginPhone";
import { RolePicker } from "./RolePicker";
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
    // A conventional split sign-in: the form on plain ground, the picture beside it. Exactly one viewport tall.
    <main className="grid h-dvh overflow-y-auto p-3 lg:grid-cols-[minmax(420px,1fr)_1.25fr] lg:gap-3 lg:overflow-hidden">
      <section className="flex flex-col px-4 py-4 sm:px-10">
        <p className="flex items-center gap-2.5 text-base font-medium"><GridMark /> FileGrid</p>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-8 [@media(max-height:760px)]:py-3">
          <h1 className="font-display text-[40px] leading-[1.1] [@media(max-height:760px)]:text-[32px]">Sign <em>in</em></h1>
          <p className="mt-2 text-[15px] text-muted">Choose your role. It decides which files and screens you see.</p>
          <form onSubmit={submit} className="mt-8 space-y-5 [@media(max-height:760px)]:mt-4 [@media(max-height:760px)]:space-y-3">
            <RolePicker value={username} onPick={setUsername} />
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
          <p className="mt-6 text-[13px] text-faint [@media(max-height:760px)]:hidden">Demo accounts share one password, set as DEMO_PASSWORD in .env.</p>
        </div>
        <p className="text-[13px] text-faint">Rețele Electrice România · PPC group</p>
      </section>
      <TexturePanel texture="lines-sky" className="hidden flex-col items-center justify-center gap-10 overflow-hidden p-10 lg:flex [@media(max-height:760px)]:gap-4 [@media(max-height:760px)]:p-6">
        <h2 className="max-w-md text-center font-display text-[56px] leading-[1.05] xl:text-[72px] [@media(max-height:760px)]:text-[44px]">Every file, <em>proven</em>.</h2>
        <LoginPhone />
      </TexturePanel>
    </main>
  );
}
