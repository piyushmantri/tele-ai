import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardBody, Select, Input, Button, Badge } from "kodeui";
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

  const contactOptions = [
    { value: "", label: "— pick from contacts —" },
    ...(chatsQ.data?.chats.map((c) => ({
      value: c.tg_chat_id,
      label: chatDisplayName(c),
    })) ?? []),
  ];

  return (
    <div className="h-full overflow-y-auto p-6">
      <h1
        className="mb-4 text-xl font-semibold"
        style={{ color: "var(--kode-text-primary)", fontFamily: "var(--kode-font-mono)" }}
      >
        Contact rules
      </h1>

      <div className="mb-6 max-w-2xl">
        <Card>
          <CardBody>
            <div className="space-y-3">
              <div className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-2">
                  <Select
                    value={type}
                    onChange={(e) => setType(e.target.value as "allow" | "block")}
                    options={[
                      { value: "block", label: "block" },
                      { value: "allow", label: "allow" },
                    ]}
                  />
                </div>
                <div className="col-span-5">
                  <Select
                    value={pickedChatId}
                    onChange={(e) => handlePickChat(e.target.value)}
                    options={contactOptions}
                  />
                </div>
                <div className="col-span-3">
                  <Input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="note (optional)"
                  />
                </div>
                <div className="col-span-2">
                  <Button
                    variant="filled"
                    fullWidth
                    disabled={!match || create.isPending}
                    onClick={() => create.mutate({ type, match, note: note || undefined })}
                  >
                    Add
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-12 gap-2">
                <div className="col-span-2 flex items-center justify-center text-xs" style={{ color: "var(--kode-text-muted)" }}>or</div>
                <div className="col-span-10">
                  <Input
                    value={match}
                    onChange={(e) => handleMatchInput(e.target.value)}
                    placeholder="type username or numeric tg id"
                  />
                </div>
              </div>
            </div>
          </CardBody>
        </Card>
      </div>

      <div
        className="max-w-3xl rounded"
        style={{ border: "1px solid var(--kode-border)", background: "var(--kode-bg-darker)" }}
      >
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: "1px solid var(--kode-border)", color: "var(--kode-text-muted)" }} className="text-left text-xs uppercase">
              <th className="px-4 py-2">Type</th>
              <th className="px-4 py-2">Match</th>
              <th className="px-4 py-2">Note</th>
              <th className="px-4 py-2">Created</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {q.data?.rules.map((r) => (
              <tr key={r.id} style={{ borderBottom: "1px solid var(--kode-border)" }}>
                <td className="px-4 py-2">
                  <Badge variant={r.type === "block" ? "error" : "success"}>{r.type}</Badge>
                </td>
                <td className="px-4 py-2 font-mono">{r.match}</td>
                <td className="px-4 py-2" style={{ color: "var(--kode-text-muted)" }}>{r.note ?? ""}</td>
                <td className="px-4 py-2" style={{ color: "var(--kode-text-muted)" }}>
                  {new Date(r.created_at).toLocaleString()}
                </td>
                <td className="px-4 py-2 text-right">
                  <Button variant="ghost" size="sm" onClick={() => remove.mutate(r.id)}>
                    Delete
                  </Button>
                </td>
              </tr>
            ))}
            {q.data && q.data.rules.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center" style={{ color: "var(--kode-text-muted)" }}>
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
            <h2 className="mb-2 text-sm font-medium" style={{ color: "var(--kode-text-muted)" }}>
              Blocked contacts (chat-level)
            </h2>
            <div
              className="rounded"
              style={{ border: "1px solid var(--kode-border)", background: "var(--kode-bg-darker)" }}
            >
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--kode-border)", color: "var(--kode-text-muted)" }} className="text-left text-xs uppercase">
                    <th className="px-4 py-2">Contact</th>
                    <th className="px-4 py-2">Tg ID</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {blocked.map((c) => (
                    <tr key={c.id} style={{ borderBottom: "1px solid var(--kode-border)" }}>
                      <td className="px-4 py-2 font-medium">{chatDisplayName(c)}</td>
                      <td className="px-4 py-2 font-mono text-xs" style={{ color: "var(--kode-text-muted)" }}>
                        {c.tg_chat_id}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => unblock.mutate(c.id)}
                          disabled={unblock.isPending}
                        >
                          Unblock
                        </Button>
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
