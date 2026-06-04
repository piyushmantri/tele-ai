import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { marked } from "marked";
import md from "../../../../docs/building-applications.md?raw";

interface Section {
  id: string;
  title: string;
  level: number;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function parseSections(raw: string): Section[] {
  const sections: Section[] = [];
  for (const line of raw.split("\n")) {
    const m = line.match(/^(#{1,3})\s+(.+)/);
    if (m) {
      const level = (m[1] ?? "#").length;
      const title = (m[2] ?? "").replace(/\*\*/g, "").trim();
      sections.push({ id: slugify(title), title, level });
    }
  }
  return sections;
}

// Configure marked to add id attributes to headings for anchor nav.
const renderer = new marked.Renderer();
renderer.heading = ({ text, depth }: { text: string; depth: number }) => {
  const id = slugify(text.replace(/<[^>]+>/g, ""));
  return `<h${depth} id="${id}">${text}</h${depth}>`;
};;
marked.use({ renderer });

const html = marked.parse(md) as string;
const sections = parseSections(md);

export default function Docs() {
  const [activeId, setActiveId] = useState<string>("");
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const headings = Array.from(content.querySelectorAll("h1,h2,h3"));
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setActiveId(e.target.id);
            break;
          }
        }
      },
      { root: content.parentElement, rootMargin: "0px 0px -70% 0px", threshold: 0 },
    );
    headings.forEach((h) => obs.observe(h));
    return () => obs.disconnect();
  }, []);

  function scrollTo(id: string) {
    const el = contentRef.current?.querySelector(`#${id}`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="flex h-full" style={{ overflow: "hidden" }}>
      {/* Sidebar */}
      <aside
        className="shrink-0 overflow-y-auto p-4"
        style={{
          width: 220,
          borderRight: "1px solid var(--kode-border)",
          background: "var(--kode-bg-dark)",
        }}
      >
        <Link
          to="/applications"
          className="mb-4 inline-block text-xs"
          style={{ color: "var(--kode-info)" }}
        >
          ← Applications
        </Link>
        <nav className="mt-2 flex flex-col gap-0.5">
          {sections.map((s) => (
            <button
              key={s.id}
              onClick={() => scrollTo(s.id)}
              className="text-left text-xs"
              style={{
                paddingLeft: s.level === 1 ? 0 : s.level === 2 ? 8 : 16,
                paddingTop: 4,
                paddingBottom: 4,
                paddingRight: 4,
                borderRadius: 4,
                background: activeId === s.id ? "var(--kode-bg-selected, rgba(255,255,255,0.07))" : "transparent",
                color: activeId === s.id ? "var(--kode-text-primary)" : "var(--kode-text-muted)",
                fontWeight: s.level === 1 ? 600 : s.level === 2 ? 500 : 400,
                cursor: "pointer",
                border: "none",
                width: "100%",
              }}
            >
              {s.title}
            </button>
          ))}
        </nav>
      </aside>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-8" ref={contentRef}>
        <div
          className="prose-docs max-w-3xl"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>

      <style>{`
        .prose-docs { color: var(--kode-text-primary); font-size: 14px; line-height: 1.7; }
        .prose-docs h1 { font-size: 1.6rem; font-weight: 700; margin: 0 0 0.5rem; color: var(--kode-text-primary); }
        .prose-docs h2 { font-size: 1.2rem; font-weight: 600; margin: 2rem 0 0.5rem; color: var(--kode-text-primary); border-bottom: 1px solid var(--kode-border); padding-bottom: 0.3rem; }
        .prose-docs h3 { font-size: 1rem; font-weight: 600; margin: 1.5rem 0 0.4rem; color: var(--kode-text-secondary); }
        .prose-docs p { margin: 0.6rem 0; }
        .prose-docs ul, .prose-docs ol { margin: 0.5rem 0 0.5rem 1.4rem; }
        .prose-docs li { margin: 0.25rem 0; }
        .prose-docs code { font-family: var(--kode-font-mono); font-size: 12px; background: var(--kode-bg-dark); padding: 1px 5px; border-radius: 3px; border: 1px solid var(--kode-border); }
        .prose-docs pre { background: var(--kode-bg-dark); border: 1px solid var(--kode-border); border-radius: 6px; padding: 1rem; overflow-x: auto; margin: 0.8rem 0; }
        .prose-docs pre code { background: none; border: none; padding: 0; font-size: 12px; }
        .prose-docs blockquote { border-left: 3px solid var(--kode-border); margin: 0.8rem 0; padding: 0.2rem 1rem; color: var(--kode-text-muted); }
        .prose-docs hr { border: none; border-top: 1px solid var(--kode-border); margin: 1.5rem 0; }
        .prose-docs table { border-collapse: collapse; width: 100%; margin: 0.8rem 0; font-size: 13px; }
        .prose-docs th, .prose-docs td { border: 1px solid var(--kode-border); padding: 6px 10px; text-align: left; }
        .prose-docs th { background: var(--kode-bg-dark); font-weight: 600; }
        .prose-docs strong { font-weight: 600; }
        .prose-docs a { color: var(--kode-info); text-decoration: none; }
        .prose-docs a:hover { text-decoration: underline; }
      `}</style>
    </div>
  );
}
