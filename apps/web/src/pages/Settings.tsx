import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardBody, Input, TextArea, Select, Switch, Button, Spinner, Alert, Divider } from "kodeui";
import type { Settings as SettingsT } from "@tele/shared";
import { api } from "../lib/api";
import { qk } from "../lib/queryKeys";

const noteStyle: React.CSSProperties = { fontSize: "0.75rem", color: "var(--kode-text-dim)", marginTop: "0.25rem" };

export default function Settings() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: qk.settings,
    queryFn: () => api.get<{ settings: SettingsT }>("/api/settings"),
  });
  const [draft, setDraft] = useState<SettingsT | null>(null);
  useEffect(() => {
    if (q.data?.settings) setDraft(q.data.settings);
  }, [q.data]);

  const save = useMutation({
    mutationFn: (s: SettingsT) => api.put<{ settings: SettingsT }>("/api/settings", s),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.settings }),
  });

  if (!draft) {
    return (
      <div className="p-6 text-sm flex items-center gap-2" style={{ color: "var(--kode-text-muted)" }}>
        <Spinner size="sm" />
        Loading…
      </div>
    );
  }

  function set<K extends keyof SettingsT>(k: K, v: SettingsT[K]) {
    setDraft((prev) => (prev ? { ...prev, [k]: v } : prev));
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <h1
        className="mb-4 text-xl font-semibold"
        style={{ color: "var(--kode-text-primary)", fontFamily: "var(--kode-font-mono)" }}
      >
        Settings
      </h1>
      <div style={{ maxWidth: 640 }}>
        <Card>
          <CardBody>
            <div className="space-y-5">
              <Switch
                checked={draft.auto_reply_enabled}
                onChange={(checked: boolean) => set("auto_reply_enabled", checked)}
                label="Auto-reply enabled"
              />

              <Divider />

              <Input
                label="User name"
                value={draft.user_name}
                onChange={(e) => set("user_name", e.target.value)}
              />

              <TextArea
                label="Persona"
                rows={4}
                value={draft.persona}
                onChange={(e) => set("persona", e.target.value)}
              />

              <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                <label style={{ fontSize: "0.8125rem", color: "var(--kode-text-muted)" }}>
                  Temperature: {draft.temperature.toFixed(2)}
                </label>
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.05}
                  value={draft.temperature}
                  onChange={(e) => set("temperature", Number(e.target.value))}
                  className="w-full"
                  style={{ accentColor: "var(--kode-green)" }}
                />
              </div>

              <Divider />

              <Select
                label="Gemini model"
                value={draft.gemini_model}
                onChange={(e) => set("gemini_model", e.target.value)}
                options={[
                  { value: "gemini-3-flash-preview", label: "gemini-3-flash-preview" },
                  { value: "gemini-2.0-flash", label: "gemini-2.0-flash" },
                  { value: "gemini-1.5-pro", label: "gemini-1.5-pro" },
                ]}
              />

              <Input
                label="Workspace root"
                value={draft.workspace_root}
                onChange={(e) => set("workspace_root", e.target.value)}
              />

              <Divider />

              <div>
                <Input
                  label="Bot prefix"
                  value={draft.bot_prefix}
                  onChange={(e) => set("bot_prefix", e.target.value)}
                  placeholder="[Woody]"
                  style={{ fontFamily: "var(--kode-font-mono)" }}
                />
                <div style={noteStyle}>(prepended to AI replies; used to detect and skip bot messages)</div>
              </div>

              <div>
                <Input
                  label="AI username"
                  value={draft.ai_username}
                  onChange={(e) => set("ai_username", e.target.value)}
                  placeholder="woody"
                  style={{ fontFamily: "var(--kode-font-mono)" }}
                />
                <div style={noteStyle}>
                  (used in <code>/unblock &lt;ai_username&gt;</code> to unblock blocked chats; case-insensitive; default: woody)
                </div>
              </div>

              <Input
                type="number"
                label="Reply delay (ms)"
                min={0}
                max={60000}
                value={draft.reply_delay_ms}
                onChange={(e) => set("reply_delay_ms", Number(e.target.value))}
              />

              <Divider />

              <TextArea
                label="Shell allow list (one per line)"
                rows={5}
                value={draft.shell_allow.join("\n")}
                onChange={(e) =>
                  set("shell_allow", e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))
                }
                style={{ fontFamily: "var(--kode-font-mono)", fontSize: "0.75rem" }}
              />

              <TextArea
                label="Shell deny list (substrings, one per line)"
                rows={5}
                value={draft.shell_deny.join("\n")}
                onChange={(e) =>
                  set("shell_deny", e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))
                }
                style={{ fontFamily: "var(--kode-font-mono)", fontSize: "0.75rem" }}
              />

              <Divider />

              <div style={{ maxWidth: "8rem" }}>
                <Input
                  label="Reaction: thinking"
                  value={draft.reaction_thinking}
                  onChange={(e) => set("reaction_thinking", e.target.value)}
                  placeholder="👀"
                />
                <div style={noteStyle}>(sent when message received; leave blank to disable)</div>
              </div>

              <div style={{ maxWidth: "8rem" }}>
                <Input
                  label="Reaction: done"
                  value={draft.reaction_done}
                  onChange={(e) => set("reaction_done", e.target.value)}
                  placeholder="✅"
                />
                <div style={noteStyle}>(replaces thinking reaction after AI replies)</div>
              </div>

              <div className="flex items-center gap-3">
                <Button
                  variant="filled"
                  onClick={() => save.mutate(draft)}
                  disabled={save.isPending}
                >
                  {save.isPending ? "Saving…" : "Save"}
                </Button>
                {save.isError && (
                  <Alert variant="error">
                    {save.error instanceof Error ? save.error.message : "save failed"}
                  </Alert>
                )}
              </div>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
