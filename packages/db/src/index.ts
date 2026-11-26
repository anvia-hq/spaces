import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";
import { migrate } from "drizzle-orm/bun-sql/migrator";
import * as appSchema from "./schema.ts";
import * as authSchema from "./auth-schema.ts";

export const schema = { ...appSchema, ...authSchema };

export type Db = ReturnType<typeof createDb>["db"];

export const DEFAULT_DATABASE_URL = "postgres://localhost:5432/spaces";

export function databaseUrl(): string {
  return process.env.SPACES_DATABASE_URL ?? DEFAULT_DATABASE_URL;
}

export function createDb(url: string = databaseUrl()) {
  const client = new SQL(url);
  const db = drizzle(client, { schema });

  return {
    db,
    client,
    migrate: () =>
      migrate(db, { migrationsFolder: new URL("../drizzle", import.meta.url).pathname }),
    close: () => client.end(),
  };
}

export * from "./schema.ts";
export { spans as spans_ } from "./schema.ts";
export * from "./auth-schema.ts";
export {
  eq,
  and,
  or,
  desc,
  asc,
  gt,
  gte,
  lt,
  lte,
  like,
  inArray,
  isNull,
  notInArray,
  sql,
} from "drizzle-orm";
export type { SQL } from "drizzle-orm";
