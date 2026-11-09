import { readFileSync } from "node:fs";
import { join } from "node:path";

export type Sql = {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  exec(text: string): Promise<void>;
};

type PgQueryable = {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
  exec?(text: string): Promise<unknown>;
};

const MIGRATION = "0002_shared_albums.sql";

function migrationSql(): string {
  return readFileSync(join(process.cwd(), "migrations", MIGRATION), "utf8");
}

function statements(sql: string): string[] {
  return sql
    .split(/;\s*(?:\n|$)/)
    .map((part) =>
      part
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim(),
    )
    .filter(Boolean);
}

export function wrapQueryable(db: PgQueryable): Sql {
  return {
    async query<T>(text: string, params: unknown[] = []) {
      const result = await db.query(text, params);
      return (result.rows || []) as T[];
    },
    async exec(text: string) {
      if (typeof db.exec === "function") {
        await db.exec(text);
        return;
      }
      for (const statement of statements(text)) {
        await db.query(statement);
      }
    },
  };
}

export async function migrate(db: Sql): Promise<void> {
  await db.exec(
    "create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())",
  );
  const applied = await db.query<{ name: string }>("select name from _migrations where name = $1", [MIGRATION]);
  if (applied.length) return;
  await db.exec(migrationSql());
  await db.query("insert into _migrations (name) values ($1) on conflict (name) do nothing", [MIGRATION]);
}

let singleton: Promise<Sql> | null = null;

export function setDbForTests(db: Sql | null): void {
  singleton = db ? Promise.resolve(db) : null;
}

export function resetDbForTests(): void {
  singleton = null;
}

async function openDb(): Promise<Sql> {
  if (process.env.DATABASE_URL) {
    const pg = await import("pg");
    const Pool = pg.default?.Pool ?? pg.Pool;
    const connectionString = process.env.DATABASE_URL;
    const local = /localhost|127\.0\.0\.1/.test(connectionString);
    const pool = new Pool({
      connectionString,
      max: 1,
      ssl: local ? undefined : { rejectUnauthorized: false },
    });
    const db = wrapQueryable(pool);
    await migrate(db);
    return db;
  }
  if (process.env.VERCEL) {
    throw new Error("DATABASE_URL is not set. Pairing and shared albums need Postgres.");
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const dir = process.env.LUSTRE_PGLITE_DIR || join(process.cwd(), ".data", "pglite");
  const pg = new PGlite(dir);
  const db = wrapQueryable(pg);
  await migrate(db);
  return db;
}

export function getDb(): Promise<Sql> {
  if (!singleton) singleton = openDb();
  return singleton;
}

export async function openMemorySql(): Promise<Sql> {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = wrapQueryable(new PGlite());
  await migrate(db);
  return db;
}
