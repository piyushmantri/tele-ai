import { useState } from "react";
import { Input, Button } from "kodeui";

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
    <form
      onSubmit={submit}
      className="flex gap-2 p-3"
      style={{ borderTop: "1px solid var(--kode-border)", background: "var(--kode-bg-darker)" }}
    >
      <div className="flex-1">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Send a manual reply..."
          disabled={busy}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) submit(e);
          }}
        />
      </div>
      <Button variant="filled" type="submit" disabled={busy}>
        Send
      </Button>
    </form>
  );
}
