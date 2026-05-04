import { NavLink } from "react-router-dom";

const items = [
  { to: "/sessions", label: "Sessions" },
  { to: "/rules", label: "Rules" },
  { to: "/reminders", label: "Reminders" },
  { to: "/kanban", label: "Kanban" },
  { to: "/mcp", label: "MCP Servers" },
  { to: "/skills", label: "Skills" },
  { to: "/slash-commands", label: "Commands" },
  { to: "/settings", label: "Settings" },
];

export default function Sidebar() {
  return (
    <aside className="flex w-48 flex-col border-r border-slate-800 bg-slate-900 p-3">
      <div className="mb-6 px-2 text-lg font-semibold">Tele AI</div>
      <nav className="flex flex-col gap-1">
        {items.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            className={({ isActive }) =>
              `rounded px-3 py-2 text-sm ${
                isActive ? "bg-slate-700 text-white" : "text-slate-300 hover:bg-slate-800"
              }`
            }
          >
            {it.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
