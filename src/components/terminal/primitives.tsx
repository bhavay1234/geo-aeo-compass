import type { QueryState, SourceTagKind } from "./derive";

export function BrandMark({ label }: { label: string }) {
  return <span className="tm-mark">{label}</span>;
}

export function StatePill({ state }: { state: QueryState }) {
  if (state === "absent")
    return <span className="tm-badge tm-b-inv">Invisible</span>;
  if (state === "weak") return <span className="tm-badge tm-b-weak">Weak</span>;
  return <span className="tm-badge tm-b-held">Held</span>;
}

const SRC_LABEL: Record<SourceTagKind, string> = {
  you: "You",
  comp: "Comp",
  agg: "Agg",
  ed: "Ed",
};
const SRC_CLASS: Record<SourceTagKind, string> = {
  you: "tm-tg-you",
  comp: "tm-tg-comp",
  agg: "tm-tg-agg",
  ed: "tm-tg-ed",
};
export function SourceTag({ kind }: { kind: SourceTagKind }) {
  return <span className={`tm-tag ${SRC_CLASS[kind]}`}>{SRC_LABEL[kind]}</span>;
}

const STATE_VAR: Record<QueryState, string> = {
  absent: "var(--hot)",
  weak: "var(--warn)",
  held: "var(--pos)",
};

/** Decorative lost-demand intensity bars, colored by state, opacity ramp. */
export function BleedBar({ state, seed = 0 }: { state: QueryState; seed?: number }) {
  const color = STATE_VAR[state];
  // Descending heights, nudged by seed so rows don't look identical.
  const base = state === "absent" ? 92 : state === "weak" ? 52 : 34;
  const heights = Array.from({ length: 7 }, (_, i) =>
    Math.max(14, base - i * 6 + ((seed + i) % 3) * 3)
  );
  return (
    <div className="tm-bleed">
      {heights.map((h, i) => (
        <span
          key={i}
          className="cell"
          style={{ height: `${h}%`, background: color, opacity: 0.28 + i * 0.1 }}
        />
      ))}
    </div>
  );
}

/** 5-dot rank indicator; the brand's position dot lit in --you. */
export function PositionDots({ position }: { position: number | null }) {
  return (
    <span className="tm-dots">
      {Array.from({ length: 5 }, (_, i) => (
        <i key={i} className={position && position === i + 1 ? "on" : ""} />
      ))}
    </span>
  );
}

/** Effort/impact meter (filled dots out of 5). */
export function Meter({ value, max = 5 }: { value: number; max?: number }) {
  return (
    <span className="tm-meter">
      {Array.from({ length: max }, (_, i) => (
        <i key={i} className={i < value ? "on" : ""} />
      ))}
    </span>
  );
}

/** Minimal sparkline with a glow underlay; draws values left→right. */
export function Sparkline({
  values,
  width = 120,
  height = 48,
  color = "var(--pos)",
}: {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
}) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 4;
  const pts = values
    .map((v, i) => {
      const x = pad + (i / (values.length - 1)) * (width - pad * 2);
      const y = height - pad - ((v - min) / span) * (height - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const last = pts.split(" ").at(-1)!.split(",").map(Number);
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
    >
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth={6}
        strokeOpacity={0.12}
        strokeLinecap="round"
      />
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={last[0]} cy={last[1]} r={3} fill={color} />
    </svg>
  );
}
