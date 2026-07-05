import { useState, type ReactNode } from "react";
import type { LlmSource } from "@/lib/db/types";
import { normalizeDomain } from "@/lib/audit/source-classifier";
import type { QueryState, SourceTagKind } from "./derive";

export function BrandMark({ label }: { label: string }) {
  return <span className="tm-mark">{label}</span>;
}

/* ── Vector icon set ──────────────────────────────────────────────────────
   Clean 1.7px line icons on a 24-grid, currentColor. Used in the sidebar and
   as section-head marks so nothing relies on unicode glyphs. */
export type IconName =
  | "overview" | "queries" | "citations" | "competitors" | "actions" | "analytics"
  | "trend" | "target" | "bars" | "globe" | "layers" | "link" | "spark"
  | "bolt" | "list" | "pie" | "external" | "plus" | "sun" | "moon" | "arrow"
  | "gauge" | "flag" | "search" | "shield" | "up" | "down";

const P: Record<IconName, ReactPaths> = {
  overview: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /></>,
  queries: <><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></>,
  citations: <><path d="M10 8H6a3 3 0 0 0-3 3v0a3 3 0 0 0 3 3h1v3" /><path d="M20 8h-4a3 3 0 0 0-3 3v0a3 3 0 0 0 3 3h1v3" /></>,
  competitors: <><circle cx="9" cy="8" r="3.2" /><path d="M3.5 20a5.5 5.5 0 0 1 11 0" /><path d="M16 6.2a3 3 0 0 1 0 5.6" /><path d="M17 14.5a5.5 5.5 0 0 1 3.5 5.1" /></>,
  actions: <><path d="M13 2L4.5 13.5H11l-1 8L19.5 10H13z" /></>,
  bolt: <><path d="M13 2L4.5 13.5H11l-1 8L19.5 10H13z" /></>,
  analytics: <><path d="M4 20V10" /><path d="M10 20V4" /><path d="M16 20v-7" /><path d="M22 20H2" /></>,
  bars: <><path d="M4 20V10" /><path d="M10 20V4" /><path d="M16 20v-7" /><path d="M22 20H2" /></>,
  trend: <><path d="M3 16l5-5 4 4 8-8" /><path d="M15 7h5v5" /></>,
  up: <><path d="M3 16l5-5 4 4 8-8" /><path d="M15 7h5v5" /></>,
  down: <><path d="M3 8l5 5 4-4 8 8" /><path d="M15 17h5v-5" /></>,
  target: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="0.6" fill="currentColor" /></>,
  gauge: <><path d="M4 15a8 8 0 1 1 16 0" /><path d="M12 15l4-3" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3c2.6 2.5 4 5.7 4 9s-1.4 6.5-4 9c-2.6-2.5-4-5.7-4-9s1.4-6.5 4-9z" /></>,
  layers: <><path d="M12 3l9 5-9 5-9-5 9-5z" /><path d="M3 13l9 5 9-5" /></>,
  link: <><path d="M9.5 14.5l5-5" /><path d="M8 11L6 13a3.5 3.5 0 0 0 5 5l2-2" /><path d="M16 13l2-2a3.5 3.5 0 0 0-5-5l-2 2" /></>,
  spark: <><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" /></>,
  flag: <><path d="M5 21V4" /><path d="M5 4h11l-2 3 2 3H5" /></>,
  list: <><path d="M8 6h13" /><path d="M8 12h13" /><path d="M8 18h13" /><circle cx="3.5" cy="6" r="1" fill="currentColor" stroke="none" /><circle cx="3.5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="3.5" cy="18" r="1" fill="currentColor" stroke="none" /></>,
  pie: <><path d="M12 3a9 9 0 1 0 9 9h-9z" /><path d="M12 3v9h9a9 9 0 0 0-9-9z" /></>,
  shield: <><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z" /></>,
  external: <><path d="M14 4h6v6" /><path d="M20 4l-9 9" /><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" /></>,
  arrow: <><path d="M5 12h14" /><path d="M13 6l6 6-6 6" /></>,
  plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <><path d="M20 14.5A8 8 0 0 1 9.5 4a7 7 0 1 0 10.5 10.5z" /></>,
};

type ReactPaths = ReactNode;

export function Icon({
  name,
  size = 18,
  strokeWidth = 1.7,
}: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ flexShrink: 0, display: "block" }}
    >
      {P[name]}
    </svg>
  );
}

const SCORE_BANDS: { min: number; label: string; color: string }[] = [
  { min: 67, label: "Strong", color: "var(--pos)" },
  { min: 34, label: "Medium", color: "var(--warn)" },
  { min: 0, label: "Weak", color: "var(--hot)" },
];
export function scoreBand(v: number) {
  return SCORE_BANDS.find((b) => v >= b.min) ?? SCORE_BANDS[2];
}

/**
 * Semicircular gauge (Semrush-style) - a 0..max score with a big centered
 * number, a /max suffix, and a qualitative band label. Colored by band.
 */
export function Gauge({
  value,
  max = 100,
  label,
  color,
  size = 200,
}: {
  value: number;
  max?: number;
  label?: string;
  color?: string;
  size?: number;
}) {
  const w = size;
  const h = size * 0.62;
  const r = size * 0.42;
  const cx = w / 2;
  const cy = h - 6;
  const frac = Math.max(0, Math.min(1, value / max));
  const len = Math.PI * r;
  const band = scoreBand(Math.round((value / max) * 100));
  const stroke = color ?? band.color;
  const track = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block", overflow: "visible" }}>
        <path d={track} fill="none" stroke="var(--grid)" strokeWidth={11} strokeLinecap="round" />
        <path
          d={track}
          fill="none"
          stroke={stroke}
          strokeWidth={11}
          strokeLinecap="round"
          strokeDasharray={len}
          strokeDashoffset={len * (1 - frac)}
          style={{ transition: "stroke-dashoffset .6s ease" }}
        />
        <text x={cx} y={cy - r * 0.32} textAnchor="middle" style={{ fontWeight: 800, fontSize: size * 0.2, fill: "var(--ink)", letterSpacing: "-.02em" }}>
          {value}
          <tspan style={{ fontSize: size * 0.09, fill: "var(--ink-3)", fontWeight: 600 }}>/{max}</tspan>
        </text>
      </svg>
      {label !== undefined ? (
        <span style={{ fontWeight: 700, fontSize: size * 0.1, color: stroke, marginTop: -2 }}>
          {label || band.label}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Donut / pie chart - slices given as {label,pct,color}. Renders a ring via a
 * single circle with a segmented stroke; optional center caption.
 */
export function Donut({
  slices,
  size = 150,
  thickness = 22,
  center,
}: {
  slices: { label: string; pct: number; color: string }[];
  size?: number;
  thickness?: number;
  center?: ReactNode;
}) {
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--grid)" strokeWidth={thickness} />
        {slices.map((s, i) => {
          const dash = (s.pct / 100) * c;
          const off = -(acc / 100) * c;
          acc += s.pct;
          return (
            <circle
              key={i}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={thickness}
              strokeDasharray={`${dash} ${c - dash}`}
              strokeDashoffset={off}
            />
          );
        })}
      </svg>
      {center != null && (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center" }}>
          {center}
        </div>
      )}
    </div>
  );
}

/**
 * Favicon for a domain - rendered in the VIEWER's browser via Google's favicon
 * service. Falls back to a first-letter tile if the icon fails to load. Makes
 * citation/competitor/source rows read as concrete brands, not bare URLs.
 */
export function Favicon({
  domain,
  size = 16,
}: {
  domain: string;
  size?: number;
}) {
  const d = normalizeDomain(domain || "");
  const [ok, setOk] = useState(true);
  if (!d) return null;
  if (!ok) {
    return (
      <span
        aria-hidden
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: size,
          height: size,
          borderRadius: 3,
          background: "var(--panel-2)",
          color: "var(--ink-3)",
          fontSize: size * 0.62,
          fontWeight: 800,
          flexShrink: 0,
          verticalAlign: "middle",
        }}
      >
        {d.charAt(0).toUpperCase()}
      </span>
    );
  }
  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=64`}
      width={size}
      height={size}
      loading="lazy"
      alt=""
      aria-hidden
      onError={() => setOk(false)}
      style={{
        borderRadius: 3,
        flexShrink: 0,
        verticalAlign: "middle",
        background: "var(--panel-2)",
        objectFit: "contain",
      }}
    />
  );
}

/**
 * "ⓘ" info affordance with a hover/click tooltip - for transparency on how each
 * metric is sourced/computed. Keep `text` plain and concise.
 */
export function InfoTip({ text, width = 260 }: { text: string; width?: number }) {
  const [open, setOpen] = useState(false);
  return (
    <span
      style={{ position: "relative", display: "inline-flex", verticalAlign: "middle" }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label="How this is measured"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 14,
          height: 14,
          borderRadius: "50%",
          border: "1px solid var(--ink-3)",
          background: "transparent",
          color: "var(--ink-3)",
          fontSize: 9.5,
          fontWeight: 800,
          fontStyle: "italic",
          fontFamily: "Georgia, serif",
          cursor: "help",
          padding: 0,
          lineHeight: 1,
        }}
      >
        i
      </button>
      {open && (
        <span
          role="tooltip"
          style={{
            position: "absolute",
            top: "150%",
            left: 0,
            zIndex: 60,
            width,
            padding: "8px 10px",
            background: "var(--ink)",
            color: "var(--bg)",
            borderRadius: 6,
            fontSize: 11.5,
            fontWeight: 400,
            lineHeight: 1.5,
            letterSpacing: 0,
            textTransform: "none",
            boxShadow: "0 6px 20px rgba(0,0,0,.28)",
            whiteSpace: "normal",
          }}
        >
          {text}
        </span>
      )}
    </span>
  );
}

/** Brand mark for an LLM, via its site's favicon (OpenAI / Perplexity / Gemini). */
const LLM_DOMAIN: Record<LlmSource, string> = {
  chatgpt: "openai.com",
  perplexity: "perplexity.ai",
  gemini: "gemini.google.com",
};
export function LlmIcon({ llm, size = 14 }: { llm: LlmSource; size?: number }) {
  return <Favicon domain={LLM_DOMAIN[llm]} size={size} />;
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
