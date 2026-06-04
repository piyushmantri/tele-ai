import { useEffect, useState } from "react";
import { Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "./lib/api";
import { qk } from "./lib/queryKeys";
import Sidebar from "./components/Sidebar";
import TopBar from "./components/TopBar";
import Login from "./pages/Login";
import Sessions from "./pages/Sessions";
import Settings from "./pages/Settings";
import Rules from "./pages/Rules";
import Reminders from "./pages/Reminders";
import MCPServers from "./pages/MCPServers";
import Kanban from "./pages/Kanban";
import Skills from "./pages/Skills";
import SlashCommands from "./pages/SlashCommands";
import Bots from "./pages/Bots";
import Metrics from "./pages/Metrics";
import Applications from "./pages/Applications";
import ApplicationDetail from "./pages/ApplicationDetail";
import Docs from "./pages/Docs";

export default function App() {
  const loc = useLocation();
  const nav = useNavigate();
  const meQ = useQuery({
    queryKey: qk.me,
    queryFn: () => api.get<{ authenticated: boolean }>("/api/me"),
  });

  useEffect(() => {
    if (meQ.data && !meQ.data.authenticated && loc.pathname !== "/login") {
      nav("/login", { replace: true });
    }
  }, [meQ.data, loc.pathname, nav]);

  if (loc.pathname === "/login") {
    return (
      <Routes>
        <Route path="/login" element={<Login onSuccess={async () => { await meQ.refetch(); nav("/sessions", { replace: true }); }} />} />
      </Routes>
    );
  }

  if (!meQ.data?.authenticated) return null;

  return (
    <div className="flex h-screen w-screen">
      <Sidebar />
      <div className="flex flex-1 flex-col">
        <TopBar />
        <div className="flex-1 overflow-hidden">
          <Routes>
            <Route path="/" element={<Navigate to="/sessions" replace />} />
            <Route path="/sessions" element={<Sessions />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/rules" element={<Rules />} />
            <Route path="/reminders" element={<Reminders />} />
            <Route path="/kanban" element={<Kanban />} />
            <Route path="/mcp" element={<MCPServers />} />
            <Route path="/skills" element={<Skills />} />
            <Route path="/applications" element={<Applications />} />
            <Route path="/applications/docs" element={<Docs />} />
            <Route path="/applications/:id" element={<ApplicationDetail />} />
            <Route path="/slash-commands" element={<SlashCommands />} />
            <Route path="/bots" element={<Bots />} />
            <Route path="/metrics" element={<Metrics />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}
