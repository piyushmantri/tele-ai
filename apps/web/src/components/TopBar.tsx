import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { qk } from "../lib/queryKeys";

interface Health {
  telegram_connected: boolean;
  uptime_s: number;
}

export default function TopBar() {
  const h = useQuery({
    queryKey: qk.health,
    queryFn: () => api.get<Health>("/api/health"),
    refetchInterval: 10_000,
  });
  const ok = h.data?.telegram_connected ?? false;
  return (
    <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-4 py-2 text-sm">
      <div className="text-slate-400">Telegram AI Agent</div>
      <div className="flex items-center gap-2">
        <span
          className={`h-2 w-2 rounded-full ${ok ? "bg-emerald-500" : "bg-rose-500"}`}
          aria-hidden
        />
        <span className="text-slate-400">
          Telegram: {ok ? "connected" : "disconnected"}
        </span>
      </div>
    </div>
  );
}
