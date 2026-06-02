import { NavLink } from "react-router-dom";

const items = [
  { to: "/sessions", label: "Sessions" },
  { to: "/rules", label: "Rules" },
  { to: "/reminders", label: "Reminders" },
  { to: "/kanban", label: "Kanban" },
  { to: "/mcp", label: "MCP Servers" },
  { to: "/skills", label: "Skills" },
  { to: "/applications", label: "Applications" },
  { to: "/slash-commands", label: "Commands" },
  { to: "/bots", label: "Bots" },
  { to: "/metrics", label: "Observability" },
  { to: "/settings", label: "Settings" },
];

export default function Sidebar() {
  return (
    <aside className="kode-sidebar flex w-48 flex-col p-3">
      <div
        className="mb-6 px-2 text-lg font-semibold"
        style={{ color: "var(--kode-green)", textShadow: "var(--kode-text-glow-sm)", letterSpacing: "0.05em" }}
      >
        Tele AI
      </div>
      <nav className="flex flex-col gap-1">
        {items.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            className={({ isActive }) =>
              `kode-nav-link${isActive ? " kode-nav-link--active" : ""}`
            }
          >
            {it.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
