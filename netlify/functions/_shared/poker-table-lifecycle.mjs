const SAFE_ALIAS_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

const normalizeAlias = (tableAlias) => {
  const alias = typeof tableAlias === "string" ? tableAlias.trim() : "";
  if (!alias) return "t";
  return SAFE_ALIAS_RE.test(alias) ? alias : "t";
};

export const tableIdleCutoffExprSql = ({ tableAlias } = {}) => {
  const alias = normalizeAlias(tableAlias);
  return `coalesce(${alias}.last_activity_at, ${alias}.created_at)`;
};

export const hasActiveHumanGuardSql = ({ tableAlias } = {}) => {
  const alias = normalizeAlias(tableAlias);
  return `not exists (\n      select 1\n      from public.poker_seats hs\n      where hs.table_id = ${alias}.id\n        and hs.status = 'ACTIVE'\n        and coalesce(hs.is_bot, false) = false\n    )`;
};

export const shouldSeedBotsOnJoin = ({ humanCount } = {}) => Number(humanCount) === 1;
