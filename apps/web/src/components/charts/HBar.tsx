interface Segment {
  value: number;
  color: string;
}

interface Item {
  label: string;
  value: number;
  color?: string;
  segments?: Segment[];
}

interface Props {
  items: Item[];
  max?: number;
  height?: number;
  formatValue?: (v: number) => string;
}

const DEFAULT_COLOR = "#60a5fa";

export default function HBar({ items, max, formatValue }: Props) {
  if (items.length === 0) {
    return <div className="text-xs text-slate-500">No data</div>;
  }
  const computedMax = max ?? Math.max(1, ...items.map((it) => it.value));
  return (
    <div className="flex flex-col gap-1">
      {items.map((it, idx) => {
        const pct = computedMax > 0 ? (it.value / computedMax) * 100 : 0;
        return (
          <div key={`${it.label}-${idx}`} className="flex items-center gap-2 text-xs">
            <span className="w-32 shrink-0 truncate text-slate-300" title={it.label}>{it.label}</span>
            <div className="relative h-4 flex-1 overflow-hidden rounded bg-slate-800">
              {it.segments && it.segments.length > 0 ? (
                <div className="flex h-full">
                  {it.segments.map((seg, sIdx) => {
                    const segPct = computedMax > 0 ? (seg.value / computedMax) * 100 : 0;
                    return (
                      <div
                        key={sIdx}
                        style={{ width: `${segPct}%`, background: seg.color }}
                        title={`${seg.value}`}
                      />
                    );
                  })}
                </div>
              ) : (
                <div
                  className="h-full"
                  style={{ width: `${pct}%`, background: it.color ?? DEFAULT_COLOR }}
                />
              )}
            </div>
            <span className="w-16 shrink-0 text-right tabular-nums text-slate-400">
              {formatValue ? formatValue(it.value) : it.value}
            </span>
          </div>
        );
      })}
    </div>
  );
}
