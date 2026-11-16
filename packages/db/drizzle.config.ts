import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: ["./src/schema.ts", "./src/auth-schema.ts"],
  out: "./drizzle",
  dbCredentials: {
    url: process.env.SPACES_DATABASE_URL ?? "postgres://localhost:5432/spaces",
  },
  verbose: true,
  strict: true,
});
