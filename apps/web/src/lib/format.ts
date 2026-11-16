export function fmtBytes(bytes: number | null | undefined): string {
  if (bytes == null || Number.isNaN(bytes)) return "—";

  if (bytes === 0) return "0 B";

  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";

  const then = new Date(iso).getTime();

  if (Number.isNaN(then)) return "—";

  const diff = (Date.now() - then) / 1000;

  if (diff < 0) return "in the future";

  if (diff < 5) return "just now";

  if (diff < 60) return `${Math.floor(diff)}s ago`;

  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;

  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;

  return `${Math.floor(diff / 86400)}d ago`;
}

export function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;

  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;

  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

export function fmtMoney(dollars: number): string {
  if (!Number.isFinite(dollars)) return "—";

  if (dollars === 0) return "$0.00";

  if (Math.abs(dollars) < 0.01) return `$${dollars.toFixed(4)}`;

  return `$${dollars.toFixed(2)}`;
}

export function fmtCount(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";

  return value.toLocaleString("en-US");
}
