import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardBody, Select, Input, Button, Badge } from "kodeui";
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

  const chatOptions = [
    { value: "", label: "target chat..." },
    ...(chatsQ.data?.chats.map((c) => ({ value: c.id, label: chatTitle(c) })) ?? []),
  ];

  return (
    <div className="h-full overflow-y-auto p-6">
      <h1
        className="mb-4 text-xl font-semibold"
        style={{ color: "var(--kode-text-primary)", fontFamily: "var(--kode-font-mono)" }}
      >
        Reminders
      </h1>

      <div className="mb-6 max-w-3xl">
        <Card>
          <CardBody>
            <div className="grid grid-cols-12 gap-2">
              <div className="col-span-3">
                <Select
                  value={chatId}
                  onChange={(e) => setChatId(e.target.value)}
                  options={chatOptions}
                />
              </div>
              <div className="col-span-5">
                <Input
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="message"
                />
              </div>
              <div className="col-span-2">
                <Input
                  value={cron}
                  onChange={(e) => setCron(e.target.value)}
                  placeholder="cron e.g. 0 * * * *"
                />
              </div>
              <div className="col-span-2">
                <Input
                  type="datetime-local"
                  value={fireAt}
                  onChange={(e) => setFireAt(e.target.value)}
                />
              </div>
            </div>
            <div className="mt-3 flex justify-end">
              <Button
                variant="filled"
                disabled={!chatId || !message || (!cron && !fireAt) || create.isPending}
                onClick={() =>
                  create.mutate({
                    target_chat_id: chatId,
                    message,
                    cron_expr: cron || undefined,
                    fire_at: fireAt ? new Date(fireAt).toISOString() : undefined,
                  })
                }
              >
                Add reminder
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>

      <div
        className="max-w-4xl rounded"
        style={{ border: "1px solid var(--kode-border)", background: "var(--kode-bg-darker)" }}
      >
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: "1px solid var(--kode-border)", color: "var(--kode-text-muted)" }} className="text-left text-xs uppercase">
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
              const statusVariant: "success" | "error" | "default" =
                r.fired ? "default" : r.active ? "success" : "error";
              const statusLabel = r.fired ? "fired" : r.active ? "active" : "cancelled";
              return (
                <tr key={r.id} style={{ borderBottom: "1px solid var(--kode-border)" }}>
                  <td className="px-4 py-2 font-mono text-xs">
                    {r.cron_expr ? `cron: ${r.cron_expr}` : `at: ${r.fire_at}`}
                  </td>
                  <td className="px-4 py-2">{chat ? chatTitle(chat) : r.target_chat_id}</td>
                  <td className="px-4 py-2">{r.message}</td>
                  <td className="px-4 py-2" style={{ color: "var(--kode-text-muted)" }}>{r.source}</td>
                  <td className="px-4 py-2" style={{ color: "var(--kode-text-muted)" }}>
                    {r.next_fire_at ? new Date(r.next_fire_at).toLocaleString() : "-"}
                  </td>
                  <td className="px-4 py-2">
                    <Badge variant={statusVariant}>{statusLabel}</Badge>
                  </td>
                  <td className="px-4 py-2 text-right">
                    {r.active && !r.fired && (
                      <Button variant="ghost" size="sm" onClick={() => remove.mutate(r.id)}>
                        Cancel
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
            {q.data && q.data.reminders.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center" style={{ color: "var(--kode-text-muted)" }}>
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
