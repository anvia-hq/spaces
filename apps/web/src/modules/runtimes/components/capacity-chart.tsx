import { useId } from "react";
import type { Point } from "../hooks/use-cluster-samples.ts";

const WIDTH = 320;
const HEIGHT = 64;

function path(points: Point[], top: number): { line: string; area: string } | null {
  if (points.length < 2) return null;

  const first = Date.parse(points[0]!.at);
  const last = Date.parse(points.at(-1)!.at);
  const span = Math.max(1, last - first);
  const x = (at: string) => ((Date.parse(at) - first) / span) * WIDTH;
  const y = (value: number) => HEIGHT - (Math.min(top, Math.max(0, value)) / top) * HEIGHT;
  const line = points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"}${x(point.at).toFixed(1)} ${y(point.value).toFixed(1)}`,
    )
    .join(" ");

  return { line, area: `${line} L${WIDTH} ${HEIGHT} L0 ${HEIGHT} Z` };
}

export function CapacityChart({
  label,
  points,
  top,
  unit,
  value,
}: {
  label: string;
  points: Point[];
  top: number;
  unit: string;
  value: string;
}) {
  const id = useId();
  const drawn = path(points, top);

  return (
    <figure className="flex flex-col gap-2 rounded-lg border bg-card p-3">
      <figcaption className="flex items-baseline justify-between gap-2">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="text-sm font-medium tabular-nums text-foreground">
          {value}
          <span className="ml-1 text-xs font-normal text-muted-foreground">{unit}</span>
        </span>
      </figcaption>

      {drawn ? (
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="none"
          className="h-16 w-full overflow-visible"
          role="img"
          aria-label={`${label}: ${value} ${unit}`}
        >
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" className="[stop-color:var(--chart-1)]" stopOpacity="0.28" />
              <stop offset="100%" className="[stop-color:var(--chart-1)]" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={drawn.area} fill={`url(#${id})`} />
          <path
            d={drawn.line}
            fill="none"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
            className="[stroke:var(--chart-1)]"
          />
        </svg>
      ) : (
        <div className="flex h-16 items-center justify-center rounded border border-dashed text-xs text-muted-foreground">
          No samples yet — the first point lands within a minute.
        </div>
      )}
    </figure>
  );
}
