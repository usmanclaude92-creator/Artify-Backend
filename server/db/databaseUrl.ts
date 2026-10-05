/**
 * Serverless-safe tuning of the Postgres connection URL. Explicit values in
 * DATABASE_URL always win; only missing parameters are filled in, and only for
 * a transaction-mode pooler (port 6543, e.g. Supabase/pgbouncer) — direct
 * connections are returned untouched. Nothing here ever logs the URL itself.
 */
export function tuneDatabaseUrl(raw: string, opts: { serverless: boolean }): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }
  if (url.port !== "6543") return raw;
  const p = url.searchParams;
  if (!p.has("pgbouncer")) p.set("pgbouncer", "true"); // transaction pooling cannot use prepared statements
  if (!p.has("connection_limit")) p.set("connection_limit", opts.serverless ? "3" : "10");
  if (!p.has("pool_timeout")) p.set("pool_timeout", "20");
  if (!p.has("connect_timeout")) p.set("connect_timeout", "15");
  return url.toString();
}
