import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const dir = join(fileURLToPath(new URL("..", import.meta.url)), "db", "migrations");

// The advisory lock is session-level: `url` must be unpooled, or lock and unlock can hit different connections.
export async function migrate(url: string): Promise<string[]> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  const applied: string[] = [];
  try {
    await sql`select pg_advisory_lock(727001)`;
    await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
    const done = new Set((await sql<{ name: string }[]>`select name from schema_migrations`).map((r) => r.name));
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      if (done.has(file)) continue;
      const body = readFileSync(join(dir, file), "utf8");
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`insert into schema_migrations (name) values (${file})`;
      });
      applied.push(file);
    }
    await sql`select pg_advisory_unlock(727001)`;
  } finally {
    await sql.end();
  }
  return applied;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // .env.local is optional
  }
  const url = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!url) {
    console.error("Set MIGRATE_DATABASE_URL (owner role, unpooled).");
    process.exit(1);
  }
  migrate(url).then(
    (applied) => console.log(applied.length ? `applied: ${applied.join(", ")}` : "up to date"),
    (err) => {
      console.error(err);
      process.exit(1);
    },
  );
}
