import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

const data = [
  { month: "Jan", chatgpt: 42, perplexity: 28, gemini: 18, claude: 12 },
  { month: "Feb", chatgpt: 48, perplexity: 32, gemini: 22, claude: 15 },
  { month: "Mar", chatgpt: 55, perplexity: 38, gemini: 28, claude: 20 },
  { month: "Apr", chatgpt: 52, perplexity: 42, gemini: 32, claude: 24 },
  { month: "May", chatgpt: 64, perplexity: 48, gemini: 38, claude: 30 },
  { month: "Jun", chatgpt: 72, perplexity: 55, gemini: 44, claude: 36 },
  { month: "Jul", chatgpt: 78, perplexity: 60, gemini: 50, claude: 42 },
  { month: "Aug", chatgpt: 85, perplexity: 68, gemini: 56, claude: 48 },
  { month: "Sep", chatgpt: 82, perplexity: 72, gemini: 62, claude: 54 },
  { month: "Oct", chatgpt: 90, perplexity: 78, gemini: 68, claude: 60 },
  { month: "Nov", chatgpt: 95, perplexity: 84, gemini: 74, claude: 66 },
  { month: "Dec", chatgpt: 100, perplexity: 90, gemini: 80, claude: 72 },
];

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-lg">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="mt-1 space-y-1">
        {payload.map((entry) => (
          <div key={entry.name} className="flex items-center gap-2">
            <div
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: entry.color }}
            />
            <span className="text-xs text-card-foreground capitalize">
              {entry.name}:
            </span>
            <span className="text-xs font-medium text-card-foreground">
              {entry.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function VisibilityChart() {
  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-card-foreground">
            Visibility Trend
          </h3>
          <p className="text-sm text-muted-foreground">
            Brand mentions across AI platforms over time
          </p>
        </div>
        <div className="flex gap-4">
          <LegendItem color="#6366f1" label="ChatGPT" />
          <LegendItem color="#2dd4a8" label="Perplexity" />
          <LegendItem color="#f0d78c" label="Gemini" />
          <LegendItem color="#e85d3a" label="Claude" />
        </div>
      </div>
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="chatgpt" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="perplexity" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#2dd4a8" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#2dd4a8" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gemini" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f0d78c" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#f0d78c" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="claude" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#e85d3a" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#e85d3a" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" opacity={0.3} />
            <XAxis
              dataKey="month"
              tick={{ fontSize: 12, fill: "var(--color-muted-foreground)" }}
              axisLine={{ stroke: "var(--color-border)" }}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 12, fill: "var(--color-muted-foreground)" }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip content={<CustomTooltip />} />
            <Area
              type="monotone"
              dataKey="chatgpt"
              stroke="#6366f1"
              strokeWidth={2}
              fill="url(#chatgpt)"
            />
            <Area
              type="monotone"
              dataKey="perplexity"
              stroke="#2dd4a8"
              strokeWidth={2}
              fill="url(#perplexity)"
            />
            <Area
              type="monotone"
              dataKey="gemini"
              stroke="#f0d78c"
              strokeWidth={2}
              fill="url(#gemini)"
            />
            <Area
              type="monotone"
              dataKey="claude"
              stroke="#e85d3a"
              strokeWidth={2}
              fill="url(#claude)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}
