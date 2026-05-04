import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Settings as SettingsT } from "@tele/shared";
import { api } from "../lib/api";
import { qk } from "../lib/queryKeys";

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

  if (!draft) return <div className="p-6 text-sm text-slate-400">Loading...</div>;

  function set<K extends keyof SettingsT>(k: K, v: SettingsT[K]) {
    setDraft((prev) => (prev ? { ...prev, [k]: v } : prev));
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <h1 className="mb-4 text-xl font-semibold">Settings</h1>
      <div className="max-w-2xl space-y-5 rounded border border-slate-800 bg-slate-900 p-5">
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={draft.auto_reply_enabled}
            onChange={(e) => set("auto_reply_enabled", e.target.checked)}
          />
          <span>Auto-reply enabled</span>
        </label>

        <div>
          <label className="block text-sm text-slate-400">User name</label>
          <input
            value={draft.user_name}
            onChange={(e) => set("user_name", e.target.value)}
            className="mt-1 w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-sm text-slate-400">Persona</label>
          <textarea
            value={draft.persona}
            onChange={(e) => set("persona", e.target.value)}
            rows={4}
            className="mt-1 w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-sm text-slate-400">
            Temperature: {draft.temperature.toFixed(2)}
          </label>
          <input
            type="range"
            min={0}
            max={2}
            step={0.05}
            value={draft.temperature}
            onChange={(e) => set("temperature", Number(e.target.value))}
            className="mt-1 w-full"
          />
        </div>

        <div>
          <label className="block text-sm text-slate-400">Gemini model</label>
          <select
            value={draft.gemini_model}
            onChange={(e) => set("gemini_model", e.target.value)}
            className="mt-1 w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm"
          >
            <option value="gemini-3-flash-preview">gemini-3-flash-preview</option>
            <option value="gemini-2.0-flash">gemini-2.0-flash</option>
            <option value="gemini-1.5-pro">gemini-1.5-pro</option>
          </select>
        </div>

        <div>
          <label className="block text-sm text-slate-400">Workspace root</label>
          <input
            value={draft.workspace_root}
            onChange={(e) => set("workspace_root", e.target.value)}
            className="mt-1 w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-sm text-slate-400">
            Bot prefix{" "}
            <span className="text-slate-500 text-xs">(prepended to AI replies; used to detect and skip bot messages)</span>
          </label>
          <input
            value={draft.bot_prefix}
            onChange={(e) => set("bot_prefix", e.target.value)}
            placeholder="[Woody]"
            className="mt-1 w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-mono"
          />
        </div>

        <div>
          <label className="block text-sm text-slate-400">Reply delay (ms)</label>
          <input
            type="number"
            min={0}
            max={60000}
            value={draft.reply_delay_ms}
            onChange={(e) => set("reply_delay_ms", Number(e.target.value))}
            className="mt-1 w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-sm text-slate-400">Shell allow list (one per line)</label>
          <textarea
            value={draft.shell_allow.join("\n")}
            onChange={(e) =>
              set(
                "shell_allow",
                e.target.value.split("\n").map((s) => s.trim()).filter(Boolean),
              )
            }
            rows={5}
            className="mt-1 w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 font-mono text-xs"
          />
        </div>

        <div>
          <label className="block text-sm text-slate-400">Shell deny list (substrings, one per line)</label>
          <textarea
            value={draft.shell_deny.join("\n")}
            onChange={(e) =>
              set(
                "shell_deny",
                e.target.value.split("\n").map((s) => s.trim()).filter(Boolean),
              )
            }
            rows={5}
            className="mt-1 w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 font-mono text-xs"
          />
        </div>

        <div>
          <label className="block text-sm text-slate-400">
            Reaction: thinking{" "}
            <span className="text-slate-500 text-xs">(sent when message received; leave blank to disable)</span>
          </label>
          <input
            value={draft.reaction_thinking}
            onChange={(e) => set("reaction_thinking", e.target.value)}
            placeholder="👀"
            className="mt-1 w-24 rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-sm text-slate-400">
            Reaction: done{" "}
            <span className="text-slate-500 text-xs">(replaces thinking reaction after AI replies)</span>
          </label>
          <input
            value={draft.reaction_done}
            onChange={(e) => set("reaction_done", e.target.value)}
            placeholder="✅"
            className="mt-1 w-24 rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm"
          />
        </div>

        <button
          onClick={() => save.mutate(draft)}
          disabled={save.isPending}
          className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium hover:bg-indigo-500 disabled:opacity-50"
        >
          {save.isPending ? "Saving..." : "Save"}
        </button>
        {save.isError && (
          <div className="text-sm text-rose-400">
            {save.error instanceof Error ? save.error.message : "save failed"}
          </div>
        )}
      </div>
    </div>
  );
}
