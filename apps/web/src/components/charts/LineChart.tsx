interface Point {
  t: number | string;
  v: number;
}

interface Props {
  points: Point[];
  height?: number;
  width?: number;
}

const PAD_TOP = 5;
const PAD_BOTTOM = 12;

function toMs(t: number | string): number {
  return typeof t === "number" ? t : new Date(t).getTime();
}

function fmtTime(ms: number): string {
  const d = new Date(ms);
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  const ss = d.getSeconds().toString().padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export default function LineChart({
  points,
  height = 80,
  width = 480,
}: Props) {
  if (!points || points.length < 2) {
    return (
      <div
        className="text-xs italic"
        style={{ color: "var(--kode-text-muted)" }}
      >
        No samples yet
      </div>
    );
  }
  const chartH = height - PAD_TOP - PAD_BOTTOM;
  const ts = points.map((p) => toMs(p.t));
  const vs = points.map((p) => p.v);
  const tMin = ts[0]!;
  const tMax = ts[ts.length - 1]!;
  const vMax = Math.max(1, ...vs);
  const tRange = Math.max(1, tMax - tMin);

  const pathPoints = points
    .map((p, i) => {
      const x = ((toMs(p.t) - tMin) / tRange) * width;
      const y = PAD_TOP + (1 - p.v / vMax) * chartH;
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  const lastVal = vs[vs.length - 1] ?? 0;

  return (
    <div className="w-full">
      <div
        className="mb-1 flex items-center gap-3 text-xs"
        style={{ color: "var(--kode-text-muted)" }}
      >
        <span>n {points.length}</span>
        <span>max {vMax}</span>
        <span className="ml-auto">last {lastVal}</span>
      </div>
      <svg
        width="100%"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height: `${height}px` }}
      >
        <line
          x1={0}
          y1={PAD_TOP + chartH}
          x2={width}
          y2={PAD_TOP + chartH}
          stroke="#334155"
          strokeWidth={0.5}
        />
        <line
          x1={0}
          y1={PAD_TOP + chartH / 2}
          x2={width}
          y2={PAD_TOP + chartH / 2}
          stroke="#334155"
          strokeWidth={0.3}
          strokeDasharray="2 2"
        />
        <path d={pathPoints} fill="none" stroke="#60a5fa" strokeWidth={1.2} />
        <text x={0} y={height - 2} textAnchor="start" fontSize={8} fill="#64748b">
          {fmtTime(tMin)}
        </text>
        <text x={width} y={height - 2} textAnchor="end" fontSize={8} fill="#64748b">
          {fmtTime(tMax)}
        </text>
      </svg>
    </div>
  );
}
