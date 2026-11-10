import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Every figure on the write-up comes from these files. Nothing is typed into the page.
const root = process.cwd();
const reportsDir = join(root, "loadtest", "reports");

interface TrendStats {
  avg?: number;
  med?: number;
  max?: number;
  "p(95)"?: number;
  "p(99)"?: number;
}

// Tagged endpoint:post_transactions in loadtest/post.js, which keeps setup and teardown GETs out.
interface K6Summary {
  metrics: {
    "http_req_duration{endpoint:post_transactions}"?: TrendStats;
    "http_req_failed{endpoint:post_transactions}"?: { value?: number };
    "http_reqs{endpoint:post_transactions}"?: { count?: number; rate?: number };
    dropped_iterations?: { count?: number };
  };
}

export interface Run {
  env: "local" | "live";
  date: string;
  targetRps: number;
  path: string;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  max: number | null;
  errorRate: number | null;
  requests: number | null;
  achievedRps: number | null;
  // k6 only emits this metric when an iteration was dropped, so absence means none.
  dropped: number;
}

export function loadRuns(env: "local" | "live"): Run[] {
  if (!existsSync(reportsDir)) return [];
  const pattern = new RegExp(`^${env}-(\\d{4}-\\d{2}-\\d{2})-(\\d+)\\.json$`);
  const runs: Run[] = [];
  for (const file of readdirSync(reportsDir)) {
    const m = pattern.exec(file);
    if (!m) continue;
    const summary = JSON.parse(readFileSync(join(reportsDir, file), "utf8")) as K6Summary;
    const d = summary.metrics["http_req_duration{endpoint:post_transactions}"];
    runs.push({
      env,
      date: m[1]!,
      targetRps: Number(m[2]),
      path: `loadtest/reports/${file}`,
      p50: d?.med ?? null,
      p95: d?.["p(95)"] ?? null,
      p99: d?.["p(99)"] ?? null,
      max: d?.max ?? null,
      errorRate: summary.metrics["http_req_failed{endpoint:post_transactions}"]?.value ?? null,
      requests: summary.metrics["http_reqs{endpoint:post_transactions}"]?.count ?? null,
      achievedRps: summary.metrics["http_reqs{endpoint:post_transactions}"]?.rate ?? null,
      dropped: summary.metrics.dropped_iterations?.count ?? 0,
    });
  }
  return runs.sort((a, b) => a.targetRps - b.targetRps);
}

export const hasEnvironmentNote = () => existsSync(join(reportsDir, "environment.md"));

// The schema figure quotes the migration itself, so it cannot drift from the database.
export function schemaExcerpt(): string {
  const file = join(root, "db", "migrations", "0001_init.sql");
  if (!existsSync(file)) return "";
  const sql = readFileSync(file, "utf8");
  const tables = sql.match(/create table [a-z_]+ \([\s\S]*?\n\);/g) ?? [];
  return tables.join("\n\n");
}
