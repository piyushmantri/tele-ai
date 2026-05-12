import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

  if (q.isLoading) return <div className="p-6 text-sm text-slate-400">Loading...</div>;

  const hasExisting = Boolean(q.data?.config);

  return (
    <div className="h-full overflow-y-auto p-6">
      <h1 className="mb-4 text-xl font-semibold">Bots</h1>
      <div className="max-w-2xl space-y-5 rounded border border-slate-800 bg-slate-900 p-5">
        <div>
          <label className="block text-sm text-slate-400">
            Bot token{" "}
            <span className="text-slate-500 text-xs">(from @BotFather)</span>
          </label>
          <input
            type="password"
            value={draft.token}
            onChange={(e) => set("token", e.target.value)}
            placeholder="123456789:AA..."
            autoComplete="off"
            className="mt-1 w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-mono"
          />
        </div>

        <div>
          <label className="block text-sm text-slate-400">System prompt</label>
          <textarea
            value={draft.system_prompt}
            onChange={(e) => set("system_prompt", e.target.value)}
            rows={6}
            placeholder="You are a helpful assistant operating as a Telegram bot..."
            className="mt-1 w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm"
          />
        </div>

        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => set("enabled", e.target.checked)}
          />
          <span>Enabled</span>
        </label>

        <div className="flex gap-3">
          <button
            onClick={() => save.mutate(draft)}
            disabled={save.isPending || !draft.token}
            className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium hover:bg-indigo-500 disabled:opacity-50"
          >
            {save.isPending ? "Saving..." : "Save"}
          </button>
          {hasExisting && (
            <button
              onClick={onDelete}
              disabled={del.isPending}
              className="rounded bg-rose-700 px-4 py-2 text-sm font-medium hover:bg-rose-600 disabled:opacity-50"
            >
              {del.isPending ? "Deleting..." : "Delete config"}
            </button>
          )}
        </div>

        {save.isError && (
          <div className="text-sm text-rose-400">
            {save.error instanceof Error ? save.error.message : "save failed"}
          </div>
        )}
        {del.isError && (
          <div className="text-sm text-rose-400">
            {del.error instanceof Error ? del.error.message : "delete failed"}
          </div>
        )}

        <div className="border-t border-slate-800 pt-4 text-xs text-slate-500">
          When enabled, the bot connects via MTProto using your existing TG_API_ID / TG_API_HASH.
          To rotate credentials, save a new token. To stop the bot temporarily, toggle Enabled off.
        </div>
      </div>
    </div>
  );
}
