import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge, Tooltip } from "kodeui";
import type { Chat } from "@tele/shared";
import { api } from "../lib/api";
import { qk } from "../lib/queryKeys";

interface Props {
  chats: Chat[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function chatTitle(c: Chat): string {
  const name = [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
  return name || (c.username ? `@${c.username}` : c.tg_chat_id);
}

export default function ChatList({ chats, selectedId, onSelect }: Props) {
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: (id: string) => api.del<{ ok: true }>(`/api/chats/${id}`),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: qk.chats });
      if (id === selectedId) onSelect("");
    },
  });

  return (
    <div
      className="flex h-full w-64 flex-col overflow-y-auto"
      style={{ borderRight: "1px solid var(--kode-border)", background: "var(--kode-bg-darker)" }}
    >
      {chats.length === 0 && (
        <div className="p-4 text-sm" style={{ color: "var(--kode-text-muted)" }}>No conversations yet.</div>
      )}
      {chats.map((c) => {
        const sel = c.id === selectedId;
        return (
          <div
            key={c.id}
            className="group flex items-center gap-1"
            style={{
              borderBottom: "1px solid var(--kode-border)",
              background: sel ? "rgba(0,255,0,0.06)" : "transparent",
              transition: "var(--kode-transition-fast)",
            }}
            onMouseEnter={(e) => {
              if (!sel) (e.currentTarget as HTMLElement).style.background = "rgba(0,255,0,0.03)";
            }}
            onMouseLeave={(e) => {
              if (!sel) (e.currentTarget as HTMLElement).style.background = "transparent";
            }}
          >
            <button
              onClick={() => onSelect(c.id)}
              className="flex flex-1 flex-col items-start gap-0.5 px-3 py-3 text-left text-sm"
            >
              <div className="flex w-full items-center justify-between">
                <span
                  className="truncate font-medium"
                  style={{ color: sel ? "var(--kode-green)" : "var(--kode-text-secondary)" }}
                >
                  {chatTitle(c)}
                </span>
                {c.unread_count > 0 && (
                  <span className="ml-2">
                    <Badge variant="info" pill>{c.unread_count}</Badge>
                  </span>
                )}
              </div>
              {c.username && (
                <span className="truncate text-xs" style={{ color: "var(--kode-text-muted)" }}>
                  @{c.username}
                </span>
              )}
            </button>
            <Tooltip content="Delete chat">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Delete chat with ${chatTitle(c)}? This removes all messages permanently.`)) {
                    del.mutate(c.id);
                  }
                }}
                disabled={del.isPending}
                className="mr-2 rounded px-2 py-1 text-xs opacity-0 group-hover:opacity-100 disabled:opacity-50"
                style={{ color: "var(--kode-text-muted)" }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.background = "var(--kode-error)";
                  (e.currentTarget as HTMLElement).style.color = "#fff";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background = "transparent";
                  (e.currentTarget as HTMLElement).style.color = "var(--kode-text-muted)";
                }}
              >
                ×
              </button>
            </Tooltip>
          </div>
        );
      })}
    </div>
  );
}
