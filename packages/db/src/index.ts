import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";
import { migrate } from "drizzle-orm/bun-sql/migrator";
import * as appSchema from "./schema.ts";
import * as authSchema from "./auth-schema.ts";

/** One schema map for the drizzle handle: space tables plus Better Auth's. */
export const schema = { ...appSchema, ...authSchema };

export type Db = ReturnType<typeof createDb>["db"];

/** Every command that touches the database reads this when no URL is given. */
export const DEFAULT_DATABASE_URL = "postgres://localhost:5432/spaces";

export function databaseUrl(): string {
  return process.env.SPACES_DATABASE_URL ?? DEFAULT_DATABASE_URL;
}

/**
 * Open a pool against Postgres. Migrations are applied by the caller (the API at
 * boot, the migration script explicitly) so a long import does not have to race
 * a migrator.
 */
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
