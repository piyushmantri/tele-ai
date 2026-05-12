import type { HistogramSnapshot } from "@tele/shared";

interface Props {
  snap: HistogramSnapshot;
}

const W = 200;
const H = 16;

export default function PercentileBar({ snap }: Props) {
  if (!snap || snap.count === 0 || snap.max <= 0) {
    return <div className="text-xs text-slate-600">no samples</div>;
  }
  const x = (v: number) => Math.max(0, Math.min(W, (v / snap.max) * W));
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      <rect x={0} y={H / 2 - 2} width={W} height={4} fill="#1e293b" rx={1} />
      <line x1={x(snap.p50)} y1={2} x2={x(snap.p50)} y2={H - 2} stroke="#94a3b8" strokeWidth={1.5} />
      <line x1={x(snap.p95)} y1={2} x2={x(snap.p95)} y2={H - 2} stroke="#f59e0b" strokeWidth={1.5} />
      <line x1={x(snap.p99)} y1={2} x2={x(snap.p99)} y2={H - 2} stroke="#f43f5e" strokeWidth={1.5} />
      <line x1={x(snap.max)} y1={2} x2={x(snap.max)} y2={H - 2} stroke="#f8fafc" strokeWidth={1.5} />
      <circle cx={x(snap.mean)} cy={H / 2} r={2} fill="#818cf8" />
    </svg>
  );
}
