import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Chat, Rule } from "@tele/shared";
import { api } from "../lib/api";
import { qk } from "../lib/queryKeys";

function chatDisplayName(c: Chat): string {
  const name = [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
  if (name && c.username) return `${name} (@${c.username})`;
  if (name) return name;
  if (c.username) return `@${c.username}`;
  return c.tg_chat_id;
}

export default function Rules() {
  const qc = useQueryClient();
  const [type, setType] = useState<"allow" | "block">("block");
  const [match, setMatch] = useState("");
  const [note, setNote] = useState("");
  const [pickedChatId, setPickedChatId] = useState("");

  const q = useQuery({
    queryKey: qk.rules,
    queryFn: () => api.get<{ rules: Rule[] }>("/api/rules"),
  });

  const chatsQ = useQuery({
    queryKey: qk.chats,
    queryFn: () => api.get<{ chats: Chat[] }>("/api/chats"),
  });

  const create = useMutation({
    mutationFn: (body: { type: string; match: string; note?: string }) =>
      api.post("/api/rules", body),
    onSuccess: () => {
      setMatch("");
      setNote("");
      setPickedChatId("");
      qc.invalidateQueries({ queryKey: qk.rules });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/rules/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.rules }),
  });

  const unblock = useMutation({
    mutationFn: (id: string) => api.patch(`/api/chats/${id}/blocked`, { blocked: false }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.chats }),
  });

  function handlePickChat(tgChatId: string) {
    setPickedChatId(tgChatId);
    setMatch(tgChatId);
  }

  function handleMatchInput(val: string) {
    setMatch(val);
    if (pickedChatId && val !== pickedChatId) setPickedChatId("");
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <h1 className="mb-4 text-xl font-semibold">Contact rules</h1>

      <div className="mb-6 max-w-2xl rounded border border-slate-800 bg-slate-900 p-4 space-y-2">
        <div className="grid grid-cols-12 gap-2">
          <select
            value={type}
            onChange={(e) => setType(e.target.value as "allow" | "block")}
            className="col-span-2 rounded border border-slate-700 bg-slate-800 px-2 py-2 text-sm"
          >
            <option value="block">block</option>
            <option value="allow">allow</option>
          </select>

          <select
            value={pickedChatId}
            onChange={(e) => handlePickChat(e.target.value)}
            className="col-span-5 rounded border border-slate-700 bg-slate-800 px-2 py-2 text-sm text-slate-300"
          >
            <option value="">— pick from contacts —</option>
            {chatsQ.data?.chats.map((c) => (
              <option key={c.id} value={c.tg_chat_id}>
                {chatDisplayName(c)}
              </option>
            ))}
          </select>

          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="note (optional)"
            className="col-span-3 rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm"
          />
          <button
            disabled={!match || create.isPending}
            onClick={() => create.mutate({ type, match, note: note || undefined })}
            className="col-span-2 rounded bg-indigo-600 px-3 py-2 text-sm font-medium hover:bg-indigo-500 disabled:opacity-50"
          >
            Add
          </button>
        </div>

        <div className="grid grid-cols-12 gap-2">
          <div className="col-span-2 flex items-center justify-center text-xs text-slate-500">or</div>
          <input
            value={match}
            onChange={(e) => handleMatchInput(e.target.value)}
            placeholder="type username or numeric tg id"
            className="col-span-10 rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div className="max-w-3xl rounded border border-slate-800 bg-slate-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-left text-xs uppercase text-slate-500">
              <th className="px-4 py-2">Type</th>
              <th className="px-4 py-2">Match</th>
              <th className="px-4 py-2">Note</th>
              <th className="px-4 py-2">Created</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {q.data?.rules.map((r) => (
              <tr key={r.id} className="border-b border-slate-800 last:border-b-0">
                <td className="px-4 py-2">
                  <span
                    className={`rounded px-2 py-0.5 text-xs ${
                      r.type === "block"
                        ? "bg-rose-900/60 text-rose-200"
                        : "bg-emerald-900/60 text-emerald-200"
                    }`}
                  >
                    {r.type}
                  </span>
                </td>
                <td className="px-4 py-2 font-mono">{r.match}</td>
                <td className="px-4 py-2 text-slate-400">{r.note ?? ""}</td>
                <td className="px-4 py-2 text-slate-500">
                  {new Date(r.created_at).toLocaleString()}
                </td>
                <td className="px-4 py-2 text-right">
                  <button
                    onClick={() => remove.mutate(r.id)}
                    className="text-xs text-rose-400 hover:text-rose-300"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {q.data && q.data.rules.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                  No rules yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {(() => {
        const blocked = chatsQ.data?.chats.filter((c) => c.is_blocked) ?? [];
        if (blocked.length === 0) return null;
        return (
          <div className="mt-6 max-w-3xl">
            <h2 className="mb-2 text-sm font-medium text-slate-400">Blocked contacts (chat-level)</h2>
            <div className="rounded border border-slate-800 bg-slate-900">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-left text-xs uppercase text-slate-500">
                    <th className="px-4 py-2">Contact</th>
                    <th className="px-4 py-2">Tg ID</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {blocked.map((c) => (
                    <tr key={c.id} className="border-b border-slate-800 last:border-b-0">
                      <td className="px-4 py-2 font-medium">{chatDisplayName(c)}</td>
                      <td className="px-4 py-2 font-mono text-xs text-slate-400">{c.tg_chat_id}</td>
                      <td className="px-4 py-2 text-right">
                        <button
                          onClick={() => unblock.mutate(c.id)}
                          disabled={unblock.isPending}
                          className="text-xs text-emerald-400 hover:text-emerald-300 disabled:opacity-50"
                        >
                          Unblock
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

