import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; payload: { color: string } }>;
}) {
  if (!active || !payload || !payload.length) return null;
  const entry = payload[0];
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-lg">
      <div className="flex items-center gap-2">
        <div
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: entry.payload.color }}
        />
        <span className="text-xs font-medium text-card-foreground">
          {entry.name}: {entry.value}
        </span>
      </div>
    </div>
  );
}

/**
 * ChatGPT visibility donut: cited vs not-cited across the audit's queries.
 * Single platform (ChatGPT) — every number traces to poll_results.
 */
export function PlatformBreakdown({
  cited,
  total,
}: {
  cited: number;
  total: number;
}) {
  const notCited = Math.max(0, total - cited);
  const chartData = [
    { name: "Cited", value: cited, color: "#2dd4a8" },
    { name: "Not cited", value: notCited, color: "#e85d3a" },
  ];
  const rate = total > 0 ? Math.round((cited / total) * 100) : 0;

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <h3 className="text-lg font-semibold text-card-foreground">
        ChatGPT Visibility
      </h3>
      <p className="text-sm text-muted-foreground">
        Share of buyer queries where your brand was cited
      </p>

      <div className="relative mt-4 h-52 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius={55}
              outerRadius={85}
              paddingAngle={3}
              dataKey="value"
              strokeWidth={0}
            >
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold text-card-foreground">{rate}%</span>
          <span className="text-xs text-muted-foreground">cited</span>
        </div>
      </div>

      <div className="mt-2 space-y-3">
        {chartData.map((item) => (
          <div key={item.name} className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: item.color }}
              />
              <span className="text-sm text-card-foreground">{item.name}</span>
            </div>
            <span className="text-sm font-medium text-card-foreground">
              {item.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
