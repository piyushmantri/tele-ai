import { Link } from "react-router-dom";
import md from "../../../../docs/building-applications.md?raw";

export default function Docs() {
  return (
    <div className="h-full overflow-y-auto p-6">
      <Link
        to="/applications"
        className="mb-4 inline-block text-xs"
        style={{ color: "var(--kode-info)" }}
      >
        ← Back to Applications
      </Link>
      <pre
        style={{
          whiteSpace: "pre-wrap",
          fontFamily: "var(--kode-font-mono)",
          fontSize: "13px",
          color: "var(--kode-text-secondary)",
        }}
      >
        {md}
      </pre>
    </div>
  );
}
