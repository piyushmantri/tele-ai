import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Chat, Reminder } from "@tele/shared";
import { api } from "../lib/api";
import { qk } from "../lib/queryKeys";
import { useWsEvent } from "../lib/ws";

export default function Reminders() {
  const qc = useQueryClient();
  const [chatId, setChatId] = useState("");
  const [message, setMessage] = useState("");
  const [cron, setCron] = useState("");
  const [fireAt, setFireAt] = useState("");

  const q = useQuery({
    queryKey: qk.reminders,
    queryFn: () => api.get<{ reminders: Reminder[] }>("/api/reminders"),
  });
  const chatsQ = useQuery({
    queryKey: qk.chats,
    queryFn: () => api.get<{ chats: Chat[] }>("/api/chats"),
  });

  useWsEvent("reminder:fired", () => {
    qc.invalidateQueries({ queryKey: qk.reminders });
  });

  const create = useMutation({
    mutationFn: (body: {
      target_chat_id: string;
      message: string;
      cron_expr?: string;
      fire_at?: string;
    }) => api.post("/api/reminders", body),
    onSuccess: () => {
      setMessage("");
      setCron("");
      setFireAt("");
      qc.invalidateQueries({ queryKey: qk.reminders });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/reminders/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.reminders }),
  });

  function chatTitle(c: Chat) {
    return [c.first_name, c.last_name].filter(Boolean).join(" ") || c.username || c.tg_chat_id;
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <h1 className="mb-4 text-xl font-semibold">Reminders</h1>

      <div className="mb-6 max-w-3xl rounded border border-slate-800 bg-slate-900 p-4">
        <div className="grid grid-cols-12 gap-2">
          <select
            value={chatId}
            onChange={(e) => setChatId(e.target.value)}
            className="col-span-3 rounded border border-slate-700 bg-slate-800 px-2 py-2 text-sm"
          >
            <option value="">target chat...</option>
            {chatsQ.data?.chats.map((c) => (
              <option key={c.id} value={c.id}>
                {chatTitle(c)}
              </option>
            ))}
          </select>
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="message"
            className="col-span-5 rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm"
          />
          <input
            value={cron}
            onChange={(e) => setCron(e.target.value)}
            placeholder="cron e.g. 0 * * * *"
            className="col-span-2 rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm"
          />
          <input
            type="datetime-local"
            value={fireAt}
            onChange={(e) => setFireAt(e.target.value)}
            className="col-span-2 rounded border border-slate-700 bg-slate-800 px-2 py-2 text-sm"
          />
        </div>
        <div className="mt-3 flex justify-end">
          <button
            disabled={!chatId || !message || (!cron && !fireAt) || create.isPending}
            onClick={() =>
              create.mutate({
                target_chat_id: chatId,
                message,
                cron_expr: cron || undefined,
                fire_at: fireAt ? new Date(fireAt).toISOString() : undefined,
              })
            }
            className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium hover:bg-indigo-500 disabled:opacity-50"
          >
            Add reminder
          </button>
        </div>
      </div>

      <div className="max-w-4xl rounded border border-slate-800 bg-slate-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-left text-xs uppercase text-slate-500">
              <th className="px-4 py-2">Schedule</th>
              <th className="px-4 py-2">Target chat</th>
              <th className="px-4 py-2">Message</th>
              <th className="px-4 py-2">Source</th>
              <th className="px-4 py-2">Next fire</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {q.data?.reminders.map((r) => {
              const chat = chatsQ.data?.chats.find((c) => c.id === r.target_chat_id);
              return (
                <tr key={r.id} className="border-b border-slate-800 last:border-b-0">
                  <td className="px-4 py-2 font-mono text-xs">
                    {r.cron_expr ? `cron: ${r.cron_expr}` : `at: ${r.fire_at}`}
                  </td>
                  <td className="px-4 py-2">{chat ? chatTitle(chat) : r.target_chat_id}</td>
                  <td className="px-4 py-2">{r.message}</td>
                  <td className="px-4 py-2 text-slate-400">{r.source}</td>
                  <td className="px-4 py-2 text-slate-500">
                    {r.next_fire_at ? new Date(r.next_fire_at).toLocaleString() : "-"}
                  </td>
                  <td className="px-4 py-2">
                    {r.fired ? "fired" : r.active ? "active" : "cancelled"}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {r.active && !r.fired && (
                      <button
                        onClick={() => remove.mutate(r.id)}
                        className="text-xs text-rose-400 hover:text-rose-300"
                      >
                        Cancel
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {q.data && q.data.reminders.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                  No reminders yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
