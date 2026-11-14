import { useState, type FormEvent } from "react";
import { FIELD, PrimaryButton } from "../../components/ui";
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
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
      <p className="font-display text-xl font-semibold">FileGrid</p>
      <h1 className="mt-8 font-display text-4xl font-semibold">Sign in</h1>
      <p className="mt-3 text-muted">Your role decides which files you can upload, find and download.</p>
      <form onSubmit={submit} className="mt-10 space-y-5">
        <label className="block text-sm">
          <span className="mb-1.5 block text-[13px] text-muted">Username</span>
          <input className={FIELD} autoComplete="username" autoFocus required value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label className="block text-sm">
          <span className="mb-1.5 block text-[13px] text-muted">Password</span>
          <input className={FIELD} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {login.isError && <p role="alert" className="text-sm text-bad">{login.error.message}</p>}
        <PrimaryButton type="submit" disabled={login.isPending}>{login.isPending ? "Signing in…" : "Sign in"}</PrimaryButton>
      </form>
    </main>
  );
}
