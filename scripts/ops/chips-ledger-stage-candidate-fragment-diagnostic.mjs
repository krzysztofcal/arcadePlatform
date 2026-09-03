import crypto from "node:crypto";
import postgres from "postgres";

import {
  BOT_ONLY_CANDIDATE_SQL,
  BOT_ONLY_RETENTION_DAYS,
} from "./chips-ledger-archive-export.mjs";
import {
  STAGE_MAX_BATCH_SIZE,
  STAGE_SYSTEM_IDENTIFIER,
  validateStageEnvironment,
} from "./chips-ledger-stage-automation.mjs";

const REPLAY_STATEMENT_TIMEOUT_MS = 120000;
const SQLSTATE_RE = /^[0-9A-Z]{5}$/;

function sqlState(error) {
  const value = String(error?.code || error?.sqlState || error?.sqlstate || "").toUpperCase();
  return SQLSTATE_RE.test(value) ? value : null;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function splitTopLevelCtes(body) {
  const defs = [];
  let start = 0;
  let depth = 0;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    else if (ch === "," && depth === 0) {
      defs.push(body.slice(start, i).trim());
      start = i + 1;
    }
  }
  const tail = body.slice(start).trim();
  if (tail) defs.push(tail);
  return defs.filter(Boolean);
}

function cteName(def) {
  return def.slice(0, def.indexOf(" as ")).trim();
}

function maxParameterIndex(sql) {
  let max = 0;
  const re = /\$(\d+)/g;
  let match;
  while ((match = re.exec(sql)) !== null) {
    max = Math.max(max, Number(match[1]));
  }
  return max;
}

function buildFragmentSql(allDefs, targetName) {
  const defs = [];
  for (const def of allDefs) {
    defs.push(def);
    if (cteName(def) === targetName) break;
  }
  if (!defs.length || cteName(defs[defs.length - 1]) !== targetName) {
    throw new Error(`target CTE not found: ${targetName}`);
  }
  return `with ${defs.join(",\n")} select count(*)::bigint as fragment_count from ${targetName}`;
}

async function readOnlyFragment(sql, fragment) {
  const startedAt = process.hrtime.bigint();
  try {
    const rows = await sql.begin(async (tx) => {
      await tx.unsafe("set transaction isolation level repeatable read, read only;");
      await tx.unsafe(`set local statement_timeout = '${REPLAY_STATEMENT_TIMEOUT_MS}ms';`);
      const parameters = fragment.parameters.length ? fragment.parameters : undefined;
      return tx.unsafe(fragment.sql, parameters);
    });
    return {
      fragment: fragment.name,
      sql_sha256: sha256(fragment.sql),
      elapsed_ms: Number(process.hrtime.bigint() - startedAt) / 1e6,
      sqlstate: "00000",
      read_only: true,
      row_count: Number(rows[0]?.fragment_count || 0),
      statement_timeout_ms: REPLAY_STATEMENT_TIMEOUT_MS,
    };
  } catch (error) {
    return {
      fragment: fragment.name,
      sql_sha256: sha256(fragment.sql),
      elapsed_ms: Number(process.hrtime.bigint() - startedAt) / 1e6,
      sqlstate: sqlState(error),
      read_only: true,
      row_count: null,
      statement_timeout_ms: REPLAY_STATEMENT_TIMEOUT_MS,
    };
  }
}

async function main() {
  const config = validateStageEnvironment(process.env, { requireCommitSha: true });
  const sql = postgres(config.dbUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 0,
  });
  try {
    const identity = await sql`select system_identifier::text as system_identifier from pg_catalog.pg_control_system();`;
    if (identity[0]?.system_identifier !== STAGE_SYSTEM_IDENTIFIER) {
      throw new Error("database is not canonical Stage");
    }

    const query = BOT_ONLY_CANDIDATE_SQL;
    const finalSelectCandidates = [
      "\nselect eligible.id::text",
      "\nselect transactions.id::text",
    ];
    let finalSelectAt = -1;
    for (const needle of finalSelectCandidates) {
      finalSelectAt = query.indexOf(needle);
      if (finalSelectAt >= 0) break;
    }
    if (finalSelectAt < 0) throw new Error("cannot locate final candidate select");
    const cteBody = query.slice(query.indexOf("with ") + 5, finalSelectAt).trim();
    const allDefs = splitTopLevelCtes(cteBody);
    const names = allDefs.map(cteName);
    const fragments = [
      { name: "registry_table_completeness", target: "table_rows" },
      { name: "metadata_key_reference_normalization", target: "table_transactions" },
      { name: "unknown_identity_reconstruction", target: "unknown_target_identity" },
      { name: "entry_shape_aggregation", target: "candidate_entry_shapes" },
      { name: "final_candidate_assembly", target: "selected_table_evidence" },
    ];
    const now = new Date();
    const cutoff = new Date(now.getTime() - BOT_ONLY_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const baseParameters = [cutoff, STAGE_MAX_BATCH_SIZE, null, null];

    const measured = [];
    for (const fragment of fragments) {
      if (!names.includes(fragment.target)) {
        measured.push({
          fragment: fragment.name,
          error_class: "target_cte_not_found",
          available_ctes: names,
        });
        continue;
      }
      const fragmentSql = buildFragmentSql(allDefs, fragment.target);
      const parameters = baseParameters.slice(0, maxParameterIndex(fragmentSql));
      measured.push(await readOnlyFragment(sql, { name: fragment.name, sql: fragmentSql, parameters }));
    }

    const finalJoinNoEvidenceSql = `with ${allDefs.join(",\n")}
      select count(*)::bigint as fragment_count
        from eligible_transactions eligible
        join selected_table on selected_table.key_table_id = eligible.key_table_id`;
    measured.push(await readOnlyFragment(sql, {
      name: "final_output_join_no_evidence",
      sql: finalJoinNoEvidenceSql,
      parameters: baseParameters.slice(0, maxParameterIndex(finalJoinNoEvidenceSql)),
    }));

    const finalJoinSql = `with ${allDefs.join(",\n")}
      select count(*)::bigint as fragment_count
        from eligible_transactions eligible
        join selected_table on selected_table.key_table_id = eligible.key_table_id
        join selected_table_evidence evidence on evidence.key_table_id = eligible.key_table_id`;
    measured.push(await readOnlyFragment(sql, {
      name: "final_output_join",
      sql: finalJoinSql,
      parameters: baseParameters.slice(0, maxParameterIndex(finalJoinSql)),
    }));

    const finalOrderedSql = `with ${allDefs.join(",\n")}
      select count(*)::bigint as fragment_count
        from (
          select eligible.id
            from eligible_transactions eligible
            join selected_table on selected_table.key_table_id = eligible.key_table_id
            join selected_table_evidence evidence on evidence.key_table_id = eligible.key_table_id
           order by eligible.created_at asc, eligible.id asc
           limit $2::int
        ) limited`;
    measured.push(await readOnlyFragment(sql, {
      name: "final_output_ordered_limit",
      sql: finalOrderedSql,
      parameters: baseParameters.slice(0, maxParameterIndex(finalOrderedSql)),
    }));

    const fullStartedAt = process.hrtime.bigint();
    let full;
    try {
      await sql.begin(async (tx) => {
        await tx.unsafe("set transaction isolation level repeatable read, read only;");
        await tx.unsafe(`set local statement_timeout = '${REPLAY_STATEMENT_TIMEOUT_MS}ms';`);
        await tx.unsafe(query, [cutoff, STAGE_MAX_BATCH_SIZE, null, null]);
      });
      full = {
        fragment: "full_bot_only_candidate_selector",
        elapsed_ms: Number(process.hrtime.bigint() - fullStartedAt) / 1e6,
        sqlstate: "00000",
        read_only: true,
        statement_timeout_ms: REPLAY_STATEMENT_TIMEOUT_MS,
      };
    } catch (error) {
      full = {
        fragment: "full_bot_only_candidate_selector",
        elapsed_ms: Number(process.hrtime.bigint() - fullStartedAt) / 1e6,
        sqlstate: sqlState(error),
        read_only: true,
        statement_timeout_ms: REPLAY_STATEMENT_TIMEOUT_MS,
      };
    }

    process.stdout.write(`${JSON.stringify({
      event: "chips_ledger_candidate_fragment_diagnostic",
      target: "stage",
      deployed_commit_sha: config.deployedCommitSha,
      cutoff,
      statement_timeout_ms: REPLAY_STATEMENT_TIMEOUT_MS,
      fragments: measured,
      full_selector: full,
    }, null, 2)}\n`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  process.stderr.write(`candidate fragment diagnostic failed: ${error?.stack || error}\n`);
  process.exitCode = 1;
});
