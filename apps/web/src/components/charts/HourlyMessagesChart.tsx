interface Bucket {
  hour: string;
  in: number;
  out: number;
}

interface Props {
  data: Bucket[];
}

const W = 480;
const H = 80;
const PAD_TOP = 5;
const PAD_BOTTOM = 12;
const CHART_H = H - PAD_TOP - PAD_BOTTOM;

function buildPath(values: number[], max: number): string {
  if (values.length < 2) return "";
  const step = W / (values.length - 1);
  return values
    .map((v, i) => {
      const x = i * step;
      const y = max > 0 ? PAD_TOP + (1 - v / max) * CHART_H : PAD_TOP + CHART_H;
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

function fmtHour(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours().toString().padStart(2, "0");
  return `${h}:00`;
}

export default function HourlyMessagesChart({ data }: Props) {
  if (!data || data.length === 0) {
    return <div className="text-xs text-slate-500">No data</div>;
  }
  const insVals = data.map((d) => d.in);
  const outsVals = data.map((d) => d.out);
  const max = Math.max(1, ...insVals, ...outsVals);
  const inPath = buildPath(insVals, max);
  const outPath = buildPath(outsVals, max);

  const labelIdxs = [0, Math.floor(data.length / 2), data.length - 1];

  return (
    <div className="w-full">
      <div className="mb-1 flex items-center gap-3 text-xs text-slate-400">
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full" style={{ background: "#60a5fa" }} />in</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full" style={{ background: "#94a3b8" }} />out</span>
        <span className="ml-auto">max {max}</span>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-20 w-full">
        <line x1={0} y1={PAD_TOP + CHART_H} x2={W} y2={PAD_TOP + CHART_H} stroke="#334155" strokeWidth={0.5} />
        <line x1={0} y1={PAD_TOP + CHART_H / 2} x2={W} y2={PAD_TOP + CHART_H / 2} stroke="#334155" strokeWidth={0.3} strokeDasharray="2 2" />
        <path d={outPath} fill="none" stroke="#94a3b8" strokeWidth={1.2} />
        <path d={inPath} fill="none" stroke="#60a5fa" strokeWidth={1.2} />
        {labelIdxs.map((i) => {
          const bucket = data[i];
          if (!bucket) return null;
          const step = data.length > 1 ? W / (data.length - 1) : 0;
          const x = i * step;
          const anchor = i === 0 ? "start" : i === data.length - 1 ? "end" : "middle";
          return (
            <text key={i} x={x} y={H - 2} textAnchor={anchor} fontSize={8} fill="#64748b">
              {fmtHour(bucket.hour)}
            </text>
          );
        })}
      </svg>
    </div>
  );
}
