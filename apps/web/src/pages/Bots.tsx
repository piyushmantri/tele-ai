import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardBody, Input, TextArea, Switch, Button, Alert, Spinner } from "kodeui";
import type { TelegramBotConfig } from "@tele/shared";
import { api } from "../lib/api";
import { qk } from "../lib/queryKeys";

interface Draft {
  token: string;
  system_prompt: string;
  enabled: boolean;
}

const EMPTY_DRAFT: Draft = { token: "", system_prompt: "", enabled: true };

export default function Bots() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: qk.telegramBot,
    queryFn: () => api.get<{ config: TelegramBotConfig | null }>("/api/telegram-bot"),
  });

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);

  useEffect(() => {
    if (q.data?.config) {
      setDraft({
        token: q.data.config.token,
        system_prompt: q.data.config.system_prompt,
        enabled: q.data.config.enabled,
      });
    } else if (q.data && !q.data.config) {
      setDraft(EMPTY_DRAFT);
    }
  }, [q.data]);

  const save = useMutation({
    mutationFn: (body: Draft) =>
      api.put<{ config: TelegramBotConfig }>("/api/telegram-bot", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.telegramBot }),
  });

  const del = useMutation({
    mutationFn: () => api.del<{ ok: boolean }>("/api/telegram-bot"),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.telegramBot }),
  });

  function set<K extends keyof Draft>(k: K, v: Draft[K]) {
    setDraft((prev) => ({ ...prev, [k]: v }));
  }

  function onDelete() {
    if (!q.data?.config) return;
    if (!window.confirm("Delete the Telegram bot config and disconnect the bot?")) return;
    del.mutate();
  }

  if (q.isLoading) {
    return (
      <div className="p-6 text-sm flex items-center gap-2" style={{ color: "var(--kode-text-muted)" }}>
        <Spinner size="md" />
        Loading…
      </div>
    );
  }

  const hasExisting = Boolean(q.data?.config);

  return (
    <div className="h-full overflow-y-auto p-6">
      <h1
        className="mb-4 text-xl font-semibold"
        style={{ color: "var(--kode-text-primary)", fontFamily: "var(--kode-font-mono)" }}
      >
        Bots
      </h1>
      <div className="max-w-2xl">
        <Card>
          <CardBody>
            <div className="space-y-5">
              <div>
                <Input
                  type="password"
                  label="Bot token"
                  value={draft.token}
                  onChange={(e) => set("token", e.target.value)}
                  placeholder="123456789:AA..."
                  autoComplete="off"
                  style={{ fontFamily: "var(--kode-font-mono)" }}
                />
                <div style={{ fontSize: "0.75rem", color: "var(--kode-text-dim)", marginTop: "0.25rem" }}>
                  (from @BotFather)
                </div>
              </div>

              <TextArea
                label="System prompt"
                value={draft.system_prompt}
                onChange={(e) => set("system_prompt", e.target.value)}
                rows={6}
                placeholder="You are a helpful assistant operating as a Telegram bot..."
              />

              <Switch
                checked={draft.enabled}
                onChange={(checked: boolean) => set("enabled", checked)}
                label="Enabled"
              />

              <div className="flex gap-3">
                <Button
                  variant="filled"
                  onClick={() => save.mutate(draft)}
                  disabled={save.isPending || !draft.token}
                >
                  {save.isPending ? "Saving..." : "Save"}
                </Button>
                {hasExisting && (
                  <Button variant="danger" onClick={onDelete} disabled={del.isPending}>
                    {del.isPending ? "Deleting..." : "Delete config"}
                  </Button>
                )}
              </div>

              {save.isError && (
                <Alert variant="error">
                  {save.error instanceof Error ? save.error.message : "save failed"}
                </Alert>
              )}
              {del.isError && (
                <Alert variant="error">
                  {del.error instanceof Error ? del.error.message : "delete failed"}
                </Alert>
              )}

              <div
                className="pt-4 text-xs"
                style={{ borderTop: "1px solid var(--kode-border)", color: "var(--kode-text-muted)" }}
              >
                When enabled, the bot connects via MTProto using your existing TG_API_ID / TG_API_HASH.
                To rotate credentials, save a new token. To stop the bot temporarily, toggle Enabled off.
              </div>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
