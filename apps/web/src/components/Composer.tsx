import { useState } from "react";

export default function Composer({ onSend }: { onSend: (text: string) => Promise<void> }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      await onSend(t);
      setText("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex gap-2 border-t border-slate-800 bg-slate-900 p-3">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Send a manual reply..."
        className="flex-1 rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm"
        disabled={busy}
      />
      <button
        type="submit"
        disabled={busy}
        className="rounded bg-indigo-600 px-4 text-sm font-medium hover:bg-indigo-500 disabled:opacity-50"
      >
        Send
      </button>
    </form>
  );
}
