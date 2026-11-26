import { SQL } from "bun";

process.env.SPACES_DRIVER = "mock";
process.env.SPACES_DATABASE_URL =
  process.env.SPACES_TEST_DATABASE_URL ?? "postgres://localhost:5432/spaces_test";
process.env.SPACES_API_KEY = "test_key";
process.env.SPACES_MAX_SANDBOXES = "512";
process.env.SPACES_PREPUBLISH_PORTS = "";
process.env.SPACES_BOOTSTRAP = "";
process.env.SPACES_NET = "public";
process.env.SPACES_NET_RULES = "";

const sql = new SQL(process.env.SPACES_DATABASE_URL);

await sql.unsafe("drop schema public cascade");
await sql.unsafe("drop schema if exists drizzle cascade");
await sql.unsafe("create schema public");
await sql.end();
