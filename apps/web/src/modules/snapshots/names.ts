export function suggestName(sandboxId: string): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 13);
  const base = sandboxId.replace(/^bx_/, "").slice(0, 8);
  return `snap-${base}-${stamp}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");
}
