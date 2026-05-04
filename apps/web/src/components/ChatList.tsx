import type { Chat } from "@tele/shared";

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
  return (
    <div className="flex h-full w-64 flex-col overflow-y-auto border-r border-slate-800 bg-slate-900">
      {chats.length === 0 && (
        <div className="p-4 text-sm text-slate-500">No conversations yet.</div>
      )}
      {chats.map((c) => {
        const sel = c.id === selectedId;
        return (
          <button
            key={c.id}
            onClick={() => onSelect(c.id)}
            className={`flex flex-col items-start gap-0.5 border-b border-slate-800 px-3 py-3 text-left text-sm hover:bg-slate-800 ${
              sel ? "bg-slate-800" : ""
            }`}
          >
            <div className="flex w-full items-center justify-between">
              <span className="truncate font-medium">{chatTitle(c)}</span>
              {c.unread_count > 0 && (
                <span className="ml-2 rounded-full bg-indigo-600 px-2 py-0.5 text-xs">
                  {c.unread_count}
                </span>
              )}
            </div>
            {c.username && (
              <span className="truncate text-xs text-slate-500">@{c.username}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
