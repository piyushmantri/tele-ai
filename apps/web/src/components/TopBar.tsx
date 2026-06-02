import { useQuery } from "@tanstack/react-query";
import { Badge } from "kodeui";
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
    <div className="kode-topbar flex items-center justify-between px-4 py-2 text-sm">
      <div style={{ color: "var(--kode-text-tertiary)" }}>Telegram AI Agent</div>
      <div className="flex items-center gap-2">
        <Badge variant={ok ? "success" : "error"} pill>
          Telegram: {ok ? "connected" : "disconnected"}
        </Badge>
      </div>
    </div>
  );
}

