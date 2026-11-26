import { Database } from "bun:sqlite";

const [source, target] = process.argv.slice(2);

if (!source || !target) {
  console.error("usage: bun run scripts/snapshot-sqlite.ts <source.db> <target.db>");
  process.exit(1);
}

const src = new Database(source, { readonly: true });
src.run(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
src.close();

const copy = new Database(target, { readonly: true });
const tables = copy
  .query("select name from sqlite_master where type = 'table' order by 1")
  .all() as {
  name: string;
}[];

for (const { name } of tables) {
  if (name.startsWith("sqlite_")) continue;

  const row = copy.query(`select count(*) as n from "${name}"`).get() as { n: number };
  console.log(`  ${name.padEnd(20)} ${row.n}`);
}
