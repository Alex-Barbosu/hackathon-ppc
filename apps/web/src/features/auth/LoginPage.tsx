import { useState, type FormEvent } from "react";
import { FIELD, PrimaryButton } from "../../components/ui";
import { GridMark } from "../../components/phone/PhoneScreen";
import { TexturePanel, Scrim } from "../../components/Texture";
import { LoginPhone } from "./LoginPhone";
import { useLogin } from "./useLogin";

export function LoginPage() {
  const login = useLogin();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate({ username: username.trim(), password });
  };

  return (
    <main className="p-4 sm:p-6">
      {/* Origin's opening frame: sky, a light serif promise, the product in a hand-sized device. */}
      <TexturePanel texture="sky" className="flex min-h-[calc(100vh-48px)] flex-col items-center px-5 pt-6 pb-16 sm:px-10">
        <p className="flex items-center gap-2.5 self-start text-base font-medium"><GridMark /> FileGrid</p>
        <p className="label mt-14 text-white/75 sm:mt-20">Rețele Electrice România</p>
        <h1 className="mt-5 text-center font-display text-[52px] leading-[1.05] text-balance sm:text-[80px] lg:text-[96px]">Every file, <em>proven</em>.</h1>
        <p className="mt-5 max-w-md text-center text-base text-white/80">Four categories, three storages, one door. Sign in with your role to upload, find and verify records.</p>
        <div className="mt-14 grid w-full max-w-4xl items-center gap-12 lg:grid-cols-2">
          <Scrim texture="sky" className="p-6 sm:p-8">
            <form onSubmit={submit} className="space-y-5">
              <p className="label text-white/75">Sign in</p>
              <label className="block">
                <span className="mb-2 block text-sm text-white/80">Username</span>
                <input className={FIELD} autoComplete="username" autoFocus required value={username} onChange={(e) => setUsername(e.target.value)} />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm text-white/80">Password</span>
                <input className={FIELD} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
              </label>
              {login.isError && <p role="alert" className="rounded-lg bg-black/40 px-3 py-2 text-sm text-bad">{login.error.message}</p>}
              <PrimaryButton type="submit" className="w-full" disabled={login.isPending}>{login.isPending ? "Signing in…" : "Sign in"}</PrimaryButton>
              <p className="text-[13px] text-white/70">Your role decides which files you can upload, find and download.</p>
            </form>
          </Scrim>
          <LoginPhone />
        </div>
      </TexturePanel>
    </main>
  );
}
