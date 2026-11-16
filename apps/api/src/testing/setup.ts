import { SQL } from "bun";

/**
 * Test environment, loaded before any test file imports `config`.
 *
 * `config` is built once at import time from `process.env`, so this pins the
 * driver and the database before anything reads it. The database is dropped and
 * re-created here, not per test file, because every file in a run shares one
 * process and the API applies migrations when it boots.
 */
process.env.SPACES_DRIVER = "mock";
process.env.SPACES_DATABASE_URL =
  process.env.SPACES_TEST_DATABASE_URL ?? "postgres://localhost:5432/spaces_test";
process.env.SPACES_API_KEY = "test_key";
process.env.SPACES_PREPUBLISH_PORTS = "";
process.env.SPACES_BOOTSTRAP = "";
process.env.SPACES_NET = "public";
process.env.SPACES_NET_RULES = "";

const sql = new SQL(process.env.SPACES_DATABASE_URL);

await sql.unsafe("drop schema public cascade");
await sql.unsafe("drop schema if exists drizzle cascade");
await sql.unsafe("create schema public");
await sql.end();
