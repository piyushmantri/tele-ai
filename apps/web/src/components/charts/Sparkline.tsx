interface Props {
  values: number[];
  width?: number;
  height?: number;
  stroke?: string;
}

export default function Sparkline({
  values,
  width = 120,
  height = 28,
  stroke = "#60a5fa",
}: Props) {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length < 2) {
    return (
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke={stroke} strokeWidth={1} opacity={0.3} />
      </svg>
    );
  }
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const range = max - min;
  if (range === 0) {
    return (
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke={stroke} strokeWidth={1.2} />
      </svg>
    );
  }
  const step = width / (finite.length - 1);
  const points = finite
    .map((v, i) => {
      const x = i * step;
      const y = height - ((v - min) / range) * height;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <polyline points={points} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
