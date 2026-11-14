import { useState, type FormEvent } from "react";
import { FIELD, PrimaryButton } from "../../components/ui";
import { GridMark } from "../../components/phone/PhoneScreen";
import { TexturePanel, Scrim } from "../../components/Texture";
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
    // One screen, no scroll: the frame is exactly the viewport and the phone scales with its height.
    <main className="h-dvh p-3 sm:p-4">
      <TexturePanel texture="lines-sky" className="flex h-full flex-col overflow-y-auto px-5 py-5 sm:px-10 lg:overflow-hidden">
        <p className="flex items-center gap-2.5 text-base font-medium"><GridMark /> FileGrid</p>
        <div className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-10 py-6 lg:grid-cols-[1fr_auto]">
          <div className="max-w-lg">
            <p className="label text-white/75">Rețele Electrice România</p>
            <h1 className="mt-4 font-display text-[44px] leading-[1.05] text-balance sm:text-[64px] xl:text-[80px]">Every file, <em>proven</em>.</h1>
            <p className="mt-4 text-base text-white/80">Four categories, three storages, one door.</p>
            {/* Near-opaque so the pylons behind never cross the fields. */}
            <Scrim texture="lines-sky" className="mt-8 !bg-[rgb(4_14_26/0.82)] p-5 backdrop-blur-md sm:p-6">
              <form onSubmit={submit} className="space-y-4">
                <RolePicker value={username} onPick={setUsername} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="label mb-2 block text-white/75">Username</span>
                    <input className={FIELD} autoComplete="username" required value={username} onChange={(e) => setUsername(e.target.value)} />
                  </label>
                  <label className="block">
                    <span className="label mb-2 block text-white/75">Password</span>
                    <input className={FIELD} type="password" autoComplete="current-password" autoFocus required value={password} onChange={(e) => setPassword(e.target.value)} />
                  </label>
                </div>
                {login.isError && <p role="alert" className="rounded-lg bg-black/40 px-3 py-2 text-sm text-bad">{login.error.message}</p>}
                <PrimaryButton type="submit" className="w-full" disabled={login.isPending}>{login.isPending ? "Signing in…" : "Sign in"}</PrimaryButton>
                <p className="text-[13px] text-white/70">Every role shares the demo password set as DEMO_PASSWORD in .env.</p>
              </form>
            </Scrim>
          </div>
          <LoginPhone />
        </div>
      </TexturePanel>
    </main>
  );
}
