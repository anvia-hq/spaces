export function parseEnv(text: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const line of text.split("\n")) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);

    if (match) values[match[1]!] = match[2]!;
  }

  return values;
}

export function setEnv(text: string, values: Record<string, string>): string {
  const pending = new Map(Object.entries(values));
  const lines = text.split("\n").map((line) => {
    const key = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(line)?.[1];

    if (key === undefined || !pending.has(key)) return line;

    const value = pending.get(key)!;
    pending.delete(key);

    return `${key}=${value}`;
  });

  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  for (const [key, value] of pending) lines.push(`${key}=${value}`);

  return `${lines.join("\n")}\n`;
}
