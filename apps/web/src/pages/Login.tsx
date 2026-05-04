import { useState } from "react";
import { api } from "../lib/api";

export default function Login({ onSuccess }: { onSuccess: () => void }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await api.post("/api/login", { password: pw });
      onSuccess();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "login failed");
    }
  }

  return (
    <div className="flex h-screen items-center justify-center">
      <form
        onSubmit={submit}
        className="w-80 space-y-4 rounded border border-slate-800 bg-slate-900 p-6"
      >
        <h1 className="text-xl font-semibold">Sign in</h1>
        <input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="Dashboard password"
          className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm"
          autoFocus
        />
        {err && <div className="text-sm text-rose-400">{err}</div>}
        <button
          type="submit"
          className="w-full rounded bg-indigo-600 px-3 py-2 text-sm font-medium hover:bg-indigo-500"
        >
          Continue
        </button>
      </form>
    </div>
  );
}
