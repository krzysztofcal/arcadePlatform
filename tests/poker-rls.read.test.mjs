import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

const dbUrl = process.env.POKER_RLS_TEST_DB_URL;

if (!dbUrl) {
  process.stdout.write("Skipping poker RLS read tests: POKER_RLS_TEST_DB_URL not set.\n");
  process.exit(0);
}

const migrationsDir = path.join(process.cwd(), "supabase", "migrations");
const migrationFiles = fs.readdirSync(migrationsDir);

function findMigration(label, match) {
  const matches = migrationFiles.filter((file) => file.includes(match));
  assert.equal(
    matches.length,
    1,
    `${label} expected exactly 1 migration matching "${match}", got ${matches.length}: ${matches.join(", ")}`
  );
  return path.join(migrationsDir, matches[0]);
}

const pokerTablesMigration = findMigration("poker_tables", "poker_tables");
const pokerPhase1Migration = findMigration("poker_phase1", "poker_phase1_authoritative_seats");
const pokerRlsMigration = findMigration("poker_rls", "enable_poker_rls");

const sql = postgres(dbUrl, { max: 1 });

const runMigration = async (file) => {
  const content = fs.readFileSync(file, "utf8");
  await sql.unsafe(content);
};

const ensureRole = async (role) => {
  await sql.unsafe(`DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
    CREATE ROLE ${role};
  END IF;
END $$;`);
};

try {
  await sql.unsafe("DROP SCHEMA IF EXISTS public CASCADE;");
  await sql.unsafe("CREATE SCHEMA public;");
  await sql.unsafe("CREATE EXTENSION IF NOT EXISTS \"pgcrypto\";");
  await sql.unsafe("CREATE SCHEMA IF NOT EXISTS auth;");
  await sql.unsafe(`
    CREATE OR REPLACE FUNCTION auth.uid()
    RETURNS uuid
    LANGUAGE sql
    STABLE
    AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
  `);
  await ensureRole("anon");
  await ensureRole("authenticated");
  await sql.unsafe("GRANT USAGE ON SCHEMA public TO anon, authenticated;");
  await sql.unsafe("GRANT USAGE ON SCHEMA auth TO anon, authenticated;");
  await sql.unsafe("GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;");

  await runMigration(pokerTablesMigration);
  await runMigration(pokerPhase1Migration);
  await runMigration(pokerRlsMigration);

  await sql.unsafe(
    "GRANT SELECT ON TABLE public.poker_tables, public.poker_seats, public.poker_actions, public.poker_requests TO anon, authenticated;"
  );

  const tableA = "11111111-1111-1111-1111-111111111111";
  const tableB = "22222222-2222-2222-2222-222222222222";
  const userWithSeat = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const otherUser = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const userWithoutSeat = "cccccccc-cccc-cccc-cccc-cccccccccccc";

  await sql`
    insert into public.poker_tables (id, stakes, max_players, status, created_by)
    values (${tableA}, '{}'::jsonb, 6, 'OPEN', ${userWithSeat}),
           (${tableB}, '{}'::jsonb, 6, 'OPEN', ${otherUser});
  `;

  await sql`
    insert into public.poker_seats (table_id, user_id, seat_no, status)
    values (${tableA}, ${userWithSeat}, 1, 'ACTIVE'),
           (${tableB}, ${otherUser}, 1, 'ACTIVE');
  `;

  await sql.unsafe("SET ROLE authenticated;");
  await sql.unsafe(`SELECT set_config('request.jwt.claim.sub', '${userWithSeat}', true);`);
  const seatedRows = await sql`select id from public.poker_tables order by id;`;
  assert.deepEqual(
    seatedRows.map((row) => row.id),
    [tableA],
    "authenticated user with seat should only read their table"
  );

  await sql.unsafe(`SELECT set_config('request.jwt.claim.sub', '${userWithoutSeat}', true);`);
  const noSeatRows = await sql`select id from public.poker_tables;`;
  assert.equal(noSeatRows.length, 0, "authenticated user without seat should not read tables");

  await sql.unsafe("RESET ROLE;");
  await sql.unsafe("SET ROLE anon;");
  await sql.unsafe("SELECT set_config('request.jwt.claim.sub', '', true);");
  const anonRows = await sql`select id from public.poker_tables;`;
  assert.equal(anonRows.length, 0, "anon users should not read tables");
} finally {
  await sql.unsafe("RESET ROLE;");
  await sql.end({ timeout: 5 });
}
