import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MANAGEMENT_API_ORIGIN = 'https://api.supabase.com';
const CANONICAL_INSERT_COLUMNS = [
  { name: 'version', valueSql: ({ version }) => sqlLiteral(version) },
  { name: 'name', valueSql: ({ name }) => sqlLiteral(name) },
  { name: 'statements', valueSql: () => 'array[]::text[]' },
];

/**
 * Redacts known secret values from text so tokens never reach stdout/stderr.
 */
export function redactSecrets(text, secrets = []) {
  let out = String(text ?? '');
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length > 0) {
      out = out.split(secret).join('[REDACTED]');
    }
  }
  return out;
}

/**
 * Escapes a JS string as a PostgreSQL single-quoted literal.
 */
export function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * Formats a Date in UTC as yyyyMMddHHmmss (14 digits).
 */
export function formatUtcVersion(date) {
  const pad2 = (n) => String(n).padStart(2, '0');
  return (
    String(date.getUTCFullYear()).padStart(4, '0') +
    pad2(date.getUTCMonth() + 1) +
    pad2(date.getUTCDate()) +
    pad2(date.getUTCHours()) +
    pad2(date.getUTCMinutes()) +
    pad2(date.getUTCSeconds())
  );
}

/**
 * Generates strictly monotonic UTC yyyyMMddHHmmss versions so multiple
 * migrations applied within the same wall-clock second never collide on PK.
 */
export function nextUniqueVersion(nowMs, lastUsedSec = -1) {
  const sec = Math.max(Math.floor(nowMs / 1000), lastUsedSec + 1);
  return { version: formatUtcVersion(new Date(sec * 1000)), sec };
}

/**
 * Strips a matched outer `begin; ... commit;` wrapper from a migration file
 * (preserving comments and body) so the tracking insert executes in the same
 * atomic transaction as the migration SQL.
 */
export function stripOuterTransaction(sql) {
  const normalized = String(sql ?? '').replace(/\r\n/g, '\n').trim();
  const lines = normalized.split('\n');

  let beginIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === '' || trimmed.startsWith('--')) continue;
    if (/^begin\s*;$/i.test(trimmed)) beginIdx = i;
    break;
  }

  let commitIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (trimmed === '' || trimmed.startsWith('--')) continue;
    if (/^commit\s*;$/i.test(trimmed)) commitIdx = i;
    break;
  }

  if (beginIdx === -1 || commitIdx === -1 || commitIdx <= beginIdx) {
    return normalized;
  }

  // Only unwrap if there are no intermediate standalone commit statements.
  for (let i = beginIdx + 1; i < commitIdx; i++) {
    if (/^commit\s*;$/i.test(lines[i].trim())) {
      return normalized;
    }
  }

  const unwrapped = [
    ...lines.slice(0, beginIdx),
    ...lines.slice(beginIdx + 1, commitIdx),
    ...lines.slice(commitIdx + 1),
  ];
  return unwrapped.join('\n').trim();
}

/**
 * Lists regular *.sql files in migrationsDir sorted lexicographically by filename.
 */
export function listMigrationFiles(migrationsDir) {
  const entries = readdirSync(migrationsDir);
  const files = entries
    .filter((filename) => filename.endsWith('.sql'))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((filename) => {
      const filePath = join(migrationsDir, filename);
      return {
        filename,
        name: filename.slice(0, -4),
        filePath,
      };
    })
    .filter((entry) => statSync(entry.filePath).isFile());
  return files;
}

/**
 * Parses the leading integer prefix of a migration filename (e.g. `0029_x.sql` -> 29).
 * Returns null if the filename does not begin with a digit sequence.
 */
export function parseMigrationNumber(filename) {
  const match = /^(\d+)/.exec(String(filename ?? ''));
  if (!match) return null;
  const num = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(num) ? num : null;
}

/**
 * Reads and validates the migrations baseline JSON file (`{"baseline": <non-negative integer>}`).
 * Throws an Error so callers fail closed when missing, unreadable, or invalid.
 */
export function readBaseline(baselinePath) {
  if (!baselinePath || typeof baselinePath !== 'string') {
    throw new Error('Missing migrations baseline file path');
  }

  let raw;
  try {
    raw = readFileSync(baselinePath, 'utf8');
  } catch (err) {
    throw new Error(`Missing or unreadable migrations baseline file (${baselinePath}): ${err.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON in migrations baseline file (${baselinePath}): ${err.message}`);
  }

  const value = parsed?.baseline;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid "baseline" value in ${baselinePath}: expected a non-negative integer`);
  }

  return value;
}

/**
 * Returns sorted migration entries whose leading number is greater than `baseline`
 * and whose name is not yet in appliedNames. Files without a leading number are
 * ignored with a warning.
 */
export function findPendingMigrations(
  files,
  appliedNames,
  { baseline, warn = (msg) => process.stderr.write(`${msg}\n`) } = {},
) {
  if (typeof baseline !== 'number' || !Number.isInteger(baseline) || baseline < 0) {
    throw new Error('baseline must be a non-negative integer');
  }

  const applied = appliedNames instanceof Set ? appliedNames : new Set(appliedNames);
  const pending = [];

  for (const file of files) {
    const num = parseMigrationNumber(file.filename);
    if (num === null) {
      if (typeof warn === 'function') {
        warn(`Warning: ignoring migration file without leading number: ${file.filename}`);
      }
      continue;
    }
    if (num <= baseline) {
      continue;
    }
    if (!applied.has(file.name)) {
      pending.push(file);
    }
  }

  return pending;
}

/**
 * Builds an INSERT statement against supabase_migrations.schema_migrations
 * including only columns that exist on the target table.
 */
export function buildInsertStatement(columns, { version, name }) {
  const colSet = new Set(
    Array.from(columns, (col) => String(col).toLowerCase()),
  );
  if (!colSet.has('name')) {
    throw new Error('supabase_migrations.schema_migrations is missing required "name" column');
  }

  const chosen = CANONICAL_INSERT_COLUMNS.filter((spec) => colSet.has(spec.name));
  if (chosen.length === 0) {
    throw new Error('No matching columns found on supabase_migrations.schema_migrations');
  }

  const colNames = chosen.map((spec) => spec.name).join(', ');
  const values = chosen.map((spec) => spec.valueSql({ version, name })).join(', ');
  return `insert into supabase_migrations.schema_migrations(${colNames}) values (${values});`;
}

/**
 * Wraps migration SQL and the schema_migrations insert in a single transaction.
 */
export function buildMigrationQuery(fileSql, columns, { version, name }) {
  const body = stripOuterTransaction(fileSql);
  const insertStmt = buildInsertStatement(columns, { version, name });
  return `begin;\n${body}\n${insertStmt}\ncommit;`;
}

/**
 * Executes a SQL query via the Supabase Management API.
 * Throws on non-2xx responses with secrets redacted from the error body.
 */
export async function runQuery({ projectRef, token, query, fetchImpl = globalThis.fetch }) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('Global fetch is not available in this Node runtime');
  }

  const url = `${MANAGEMENT_API_ORIGIN}/v1/projects/${encodeURIComponent(projectRef)}/database/query`;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });

  const rawText = await res.text();
  if (!res.ok) {
    const safeBody = redactSecrets(rawText, [token]);
    const err = new Error(safeBody || `HTTP ${res.status}`);
    err.status = res.status;
    err.body = safeBody;
    throw err;
  }

  if (!rawText.trim()) return [];
  return JSON.parse(rawText);
}

/**
 * Detects and applies pending Supabase migrations in filename order.
 */
export async function applyMigrations({
  token,
  projectRef,
  migrationsDir,
  baselinePath,
  dryRun = false,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  stdout = process.stdout,
  stderr = process.stderr,
}) {
  if (!token || typeof token !== 'string' || !token.trim()) {
    stderr.write('Missing SUPABASE_ACCESS_TOKEN\n');
    return { exitCode: 1, pending: [], applied: [] };
  }
  if (!projectRef || typeof projectRef !== 'string' || !projectRef.trim()) {
    stderr.write('Missing SUPABASE_PROJECT_REF\n');
    return { exitCode: 1, pending: [], applied: [] };
  }

  const cleanToken = token.trim();
  const cleanRef = projectRef.trim();
  const secrets = [cleanToken, token];

  const resolvedBaselinePath =
    baselinePath !== undefined
      ? baselinePath
      : migrationsDir
        ? resolve(migrationsDir, '../migrations-baseline.json')
        : '';

  let baseline;
  try {
    baseline = readBaseline(resolvedBaselinePath);
  } catch (err) {
    stderr.write(`${redactSecrets(err.message || String(err), secrets)}\n`);
    return { exitCode: 1, pending: [], applied: [] };
  }

  let appliedRows;
  try {
    appliedRows = await runQuery({
      projectRef: cleanRef,
      token: cleanToken,
      query: 'select name from supabase_migrations.schema_migrations;',
      fetchImpl,
    });
  } catch (err) {
    stderr.write(`${redactSecrets(err.body || err.message || String(err), secrets)}\n`);
    return { exitCode: 1, pending: [], applied: [] };
  }

  const appliedNames = new Set(
    (Array.isArray(appliedRows) ? appliedRows : [])
      .map((row) => (row && typeof row.name === 'string' ? row.name.trim() : ''))
      .filter(Boolean),
  );

  const files = listMigrationFiles(migrationsDir);
  const pendingFiles = findPendingMigrations(files, appliedNames, {
    baseline,
    warn: (msg) => stderr.write(`${msg}\n`),
  });
  const pendingNames = pendingFiles.map((file) => file.name);

  if (dryRun) {
    if (pendingNames.length === 0) {
      stdout.write('No pending migrations.\n');
    } else {
      for (const name of pendingNames) {
        stdout.write(`${name}\n`);
      }
    }
    return { exitCode: 0, pending: pendingNames, applied: [] };
  }

  if (pendingFiles.length === 0) {
    stdout.write('No pending migrations.\n');
    return { exitCode: 0, pending: [], applied: [] };
  }

  let columnRows;
  try {
    columnRows = await runQuery({
      projectRef: cleanRef,
      token: cleanToken,
      query:
        "select column_name from information_schema.columns where table_schema = 'supabase_migrations' and table_name = 'schema_migrations' order by ordinal_position;",
      fetchImpl,
    });
  } catch (err) {
    stderr.write(`${redactSecrets(err.body || err.message || String(err), secrets)}\n`);
    return { exitCode: 1, pending: pendingNames, applied: [] };
  }

  const columns = (Array.isArray(columnRows) ? columnRows : [])
    .map((row) => (row && typeof row.column_name === 'string' ? row.column_name.toLowerCase() : ''))
    .filter(Boolean);

  const applied = [];
  let lastUsedSec = -1;

  for (const file of pendingFiles) {
    const next = nextUniqueVersion(now(), lastUsedSec);
    lastUsedSec = next.sec;

    const fileSql = readFileSync(file.filePath, 'utf8');
    let query;
    try {
      query = buildMigrationQuery(fileSql, columns, {
        version: next.version,
        name: file.name,
      });
    } catch (err) {
      stderr.write(`${redactSecrets(err.message || String(err), secrets)}\n`);
      return { exitCode: 1, pending: pendingNames, applied };
    }

    try {
      await runQuery({
        projectRef: cleanRef,
        token: cleanToken,
        query,
        fetchImpl,
      });
    } catch (err) {
      stderr.write(`${redactSecrets(err.body || err.message || String(err), secrets)}\n`);
      return { exitCode: 1, pending: pendingNames, applied };
    }

    stdout.write(`Applied ${file.name} (${next.version})\n`);
    applied.push(file.name);
  }

  return { exitCode: 0, pending: pendingNames, applied };
}

const isMain =
  Boolean(process.argv[1]) &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const migrationsDir = resolve(scriptDir, '../supabase/migrations');
  const baselinePath = resolve(scriptDir, '../supabase/migrations-baseline.json');

  const result = await applyMigrations({
    token: process.env.SUPABASE_ACCESS_TOKEN,
    projectRef: process.env.SUPABASE_PROJECT_REF,
    migrationsDir,
    baselinePath,
    dryRun,
  });
  process.exitCode = result.exitCode;
}
