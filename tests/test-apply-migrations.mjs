import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyMigrations,
  buildInsertStatement,
  buildMigrationQuery,
  findPendingMigrations,
  listMigrationFiles,
  parseMigrationNumber,
  readBaseline,
  stripOuterTransaction,
} from '../scripts/apply-migrations.mjs';

const tempDirs = [];

function makeTempMigrations(files, { baseline = 0 } = {}) {
  const rootDir = mkdtempSync(join(tmpdir(), 'oilgate-mig-test-'));
  tempDirs.push(rootDir);
  const dir = join(rootDir, 'migrations');
  mkdirSync(dir);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, 'utf8');
  }
  if (baseline !== null) {
    const baselineContent =
      typeof baseline === 'string' ? baseline : JSON.stringify({ baseline });
    writeFileSync(join(rootDir, 'migrations-baseline.json'), baselineContent, 'utf8');
  }
  return dir;
}

function makeBufferStream() {
  let buf = '';
  return {
    stream: {
      write(chunk) {
        buf += String(chunk);
      },
    },
    read() {
      return buf;
    },
  };
}

function mockJsonResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return typeof data === 'string' ? data : JSON.stringify(data);
    },
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

test('listMigrationFiles sorts *.sql by filename and ignores non-sql files and directories', () => {
  const dir = makeTempMigrations({
    '0010_second.sql': 'select 2;',
    '0002_first.sql': 'select 1;',
    '0001_init.sql': 'select 0;',
    'README.txt': 'ignore me',
  });
  mkdirSync(join(dir, 'nested.sql'));

  const files = listMigrationFiles(dir);
  assert.deepEqual(
    files.map((f) => f.name),
    ['0001_init', '0002_first', '0010_second'],
  );
  assert.deepEqual(
    findPendingMigrations(files, new Set(['0001_init']), { baseline: 0 }).map((f) => f.name),
    ['0002_first', '0010_second'],
  );
});

test('applyMigrations detects pending migrations, orders by filename, introspects columns, and sends Management API queries', async () => {
  const dir = makeTempMigrations({
    '0029_third.sql': '-- comment\nbegin;\nselect 3;\ncommit;\n',
    '0010_second.sql': 'select 2;',
    '0002_first.sql': 'select 1;',
    '0001_applied.sql': 'select 0;',
  });

  const calls = [];
  const mockFetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, method: init.method, headers: init.headers, query: body.query });

    if (body.query.startsWith('select name from supabase_migrations.schema_migrations')) {
      return mockJsonResponse([{ name: '0001_applied' }, { name: null }]);
    }
    if (body.query.startsWith('select column_name from information_schema.columns')) {
      return mockJsonResponse([
        { column_name: 'version' },
        { column_name: 'statements' },
        { column_name: 'name' },
      ]);
    }
    return mockJsonResponse([]);
  };

  const stdout = makeBufferStream();
  const stderr = makeBufferStream();
  const fixedNow = Date.UTC(2026, 10, 27, 15, 4, 5); // 2026-11-27T15:04:05Z

  const result = await applyMigrations({
    token: 'mock-access-token-value',
    projectRef: 'testref123',
    migrationsDir: dir,
    fetchImpl: mockFetch,
    now: () => fixedNow,
    stdout: stdout.stream,
    stderr: stderr.stream,
  });

  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.pending, ['0002_first', '0010_second', '0029_third']);
  assert.deepEqual(result.applied, ['0002_first', '0010_second', '0029_third']);
  assert.equal(stderr.read(), '');

  // 1 applied query + 1 column introspection + 3 migration executions
  assert.equal(calls.length, 5);
  for (const call of calls) {
    assert.equal(call.url, 'https://api.supabase.com/v1/projects/testref123/database/query');
    assert.equal(call.method, 'POST');
    assert.equal(call.headers.Authorization, 'Bearer mock-access-token-value');
    assert.equal(call.headers['Content-Type'], 'application/json');
  }

  const migrationQueries = calls.slice(2).map((c) => c.query);

  // Ordered 0002 -> 0010 -> 0029 with strictly monotonic UTC yyyyMMddHHmmss versions
  assert.match(
    migrationQueries[0],
    /^begin;\nselect 1;\ninsert into supabase_migrations\.schema_migrations\(version, name, statements\) values \('20261127150405', '0002_first', array\[\]::text\[\]\);\ncommit;$/,
  );
  assert.match(
    migrationQueries[1],
    /^begin;\nselect 2;\ninsert into supabase_migrations\.schema_migrations\(version, name, statements\) values \('20261127150406', '0010_second', array\[\]::text\[\]\);\ncommit;$/,
  );
  assert.match(
    migrationQueries[2],
    /^begin;\n-- comment\nselect 3;\ninsert into supabase_migrations\.schema_migrations\(version, name, statements\) values \('20261127150407', '0029_third', array\[\]::text\[\]\);\ncommit;$/,
  );
  assert.match(stdout.read(), /Applied 0002_first \(20261127150405\)/);
  assert.match(stdout.read(), /Applied 0029_third \(20261127150407\)/);
});

test('buildInsertStatement omits missing columns based on information_schema result', () => {
  const stmt = buildInsertStatement(['version', 'name'], {
    version: '20261127150405',
    name: "0030_o'hare",
  });
  assert.equal(
    stmt,
    "insert into supabase_migrations.schema_migrations(version, name) values ('20261127150405', '0030_o''hare');",
  );

  const query = buildMigrationQuery('begin;\ncreate table x(id int);\ncommit;\n', ['name'], {
    version: '20261127150405',
    name: '0031_name_only',
  });
  assert.equal(
    query,
    "begin;\ncreate table x(id int);\ninsert into supabase_migrations.schema_migrations(name) values ('0031_name_only');\ncommit;",
  );
});

test('stripOuterTransaction preserves body when internal statements are not wrapped or contain multiple commits', () => {
  assert.equal(stripOuterTransaction('begin;\nselect 1;\ncommit;\nbegin;\nselect 2;\ncommit;'), 'begin;\nselect 1;\ncommit;\nbegin;\nselect 2;\ncommit;');
  assert.equal(stripOuterTransaction('select 1;'), 'select 1;');
});

test('dry-run prints pending list in order and exits 0 without querying schema or executing SQL', async () => {
  const dir = makeTempMigrations({
    '0003_gamma.sql': 'select 3;',
    '0002_beta.sql': 'select 2;',
    '0001_alpha.sql': 'select 1;',
  });

  const calls = [];
  const mockFetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body.query);
    return mockJsonResponse([{ name: '0001_alpha' }]);
  };

  const stdout = makeBufferStream();
  const stderr = makeBufferStream();

  const result = await applyMigrations({
    token: 'mock-access-token-value',
    projectRef: 'testref123',
    migrationsDir: dir,
    dryRun: true,
    fetchImpl: mockFetch,
    stdout: stdout.stream,
    stderr: stderr.stream,
  });

  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.pending, ['0002_beta', '0003_gamma']);
  assert.deepEqual(result.applied, []);
  assert.equal(calls.length, 1);
  assert.equal(stdout.read(), '0002_beta\n0003_gamma\n');
  assert.equal(stderr.read(), '');
});

test('stops on first non-2xx error, redacts token from error output, and skips remaining migrations', async () => {
  const dir = makeTempMigrations({
    '0001_one.sql': 'select 1;',
    '0002_two.sql': 'select bad_sql;',
    '0003_three.sql': 'select 3;',
  });

  const secretToken = 'mock-secret-bearer-token-999';
  const queriesSent = [];

  const mockFetch = async (_url, init) => {
    const { query } = JSON.parse(init.body);
    queriesSent.push(query);

    if (query.startsWith('select name from')) {
      return mockJsonResponse([]);
    }
    if (query.startsWith('select column_name from')) {
      return mockJsonResponse([{ column_name: 'version' }, { column_name: 'name' }, { column_name: 'statements' }]);
    }
    if (query.includes('select bad_sql;')) {
      return mockJsonResponse(
        JSON.stringify({ message: `syntax error near bad_sql (debug: ${secretToken})` }),
        400,
      );
    }
    return mockJsonResponse([]);
  };

  const stdout = makeBufferStream();
  const stderr = makeBufferStream();

  const result = await applyMigrations({
    token: secretToken,
    projectRef: 'testref123',
    migrationsDir: dir,
    fetchImpl: mockFetch,
    now: () => Date.UTC(2026, 10, 27, 15, 0, 0),
    stdout: stdout.stream,
    stderr: stderr.stream,
  });

  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.applied, ['0001_one']);
  assert.ok(!queriesSent.some((q) => q.includes('0003_three')), 'must not attempt later migrations');
  assert.match(stderr.read(), /syntax error near bad_sql/);
  assert.match(stderr.read(), /\[REDACTED\]/);
  assert.ok(!stderr.read().includes(secretToken), 'token must never appear in stderr');
  assert.ok(!stdout.read().includes(secretToken), 'token must never appear in stdout');
});

test('exits 0 with message when no migrations are pending', async () => {
  const dir = makeTempMigrations({
    '0001_one.sql': 'select 1;',
  });
  const calls = [];
  const stdout = makeBufferStream();
  const stderr = makeBufferStream();

  const result = await applyMigrations({
    token: 'mock-access-token-value',
    projectRef: 'testref123',
    migrationsDir: dir,
    fetchImpl: async (_url, init) => {
      calls.push(JSON.parse(init.body).query);
      return mockJsonResponse([{ name: '0001_one' }]);
    },
    stdout: stdout.stream,
    stderr: stderr.stream,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(calls.length, 1);
  assert.equal(stdout.read(), 'No pending migrations.\n');
  assert.equal(stderr.read(), '');
});

test('exits 1 when SUPABASE_ACCESS_TOKEN or SUPABASE_PROJECT_REF is missing', async () => {
  const dir = makeTempMigrations({});
  const stdout = makeBufferStream();
  const stderr = makeBufferStream();

  const r1 = await applyMigrations({
    token: '',
    projectRef: 'testref123',
    migrationsDir: dir,
    stdout: stdout.stream,
    stderr: stderr.stream,
  });
  assert.equal(r1.exitCode, 1);
  assert.match(stderr.read(), /SUPABASE_ACCESS_TOKEN/);

  const stderr2 = makeBufferStream();
  const r2 = await applyMigrations({
    token: 'mock-access-token-value',
    projectRef: '',
    migrationsDir: dir,
    stdout: stdout.stream,
    stderr: stderr2.stream,
  });
  assert.equal(r2.exitCode, 1);
  assert.match(stderr2.read(), /SUPABASE_PROJECT_REF/);
});

test('db-migrate workflow triggers on main supabase/migrations/** pushes, serializes runs, runs tests first, and invokes apply-migrations.mjs', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const wf = readFileSync(join(root, '.github/workflows/db-migrate.yml'), 'utf8');

  assert.match(wf, /push:\s*\n\s+branches:\s*\[main\]\s*\n\s+paths:\s*\n\s+-\s*['"]?supabase\/migrations\/\*\*['"]?/);
  assert.match(wf, /\bworkflow_dispatch:/);
  assert.match(wf, /concurrency:\s*\n\s+group:\s*db-migrate\s*\n\s+cancel-in-progress:\s*false/);
  assert.match(wf, /npm ci[\s\S]*npm test[\s\S]*node scripts\/apply-migrations\.mjs/);
  assert.match(wf, /SUPABASE_ACCESS_TOKEN:\s*\$\{\{\s*secrets\.SUPABASE_ACCESS_TOKEN\s*\}\}/);
  assert.match(wf, /SUPABASE_PROJECT_REF:\s*ifaepctdhlmmcpqvnfxp/);
});

test('parseMigrationNumber extracts leading integer prefix or returns null', () => {
  assert.equal(parseMigrationNumber('0029_owner_signin_activity.sql'), 29);
  assert.equal(parseMigrationNumber('0001_commercial.sql'), 1);
  assert.equal(parseMigrationNumber('0000_init.sql'), 0);
  assert.equal(parseMigrationNumber('notes.sql'), null);
  assert.equal(parseMigrationNumber('_0029_bad.sql'), null);
});

test('baseline 28 skips 0001-0028 even when DB schema_migrations names match nothing, leaving only 0029+ pending', async () => {
  const dir = makeTempMigrations(
    {
      '0001_commercial.sql': 'select 1;',
      '0003_commercial_v2.sql': 'select 3;',
      '0020_seller_offer.sql': 'select 20;',
      '0026_realtor_file_audience.sql': 'select 26;',
      '0028_viewer_access_upgrade.sql': 'select 28;',
      '0029_owner_signin_activity.sql': 'select 29;',
      '0030_next.sql': 'select 30;',
    },
    { baseline: 28 },
  );

  const mockFetchUnmatched = async (_url, init) => {
    const { query } = JSON.parse(init.body);
    if (query.startsWith('select name from')) {
      return mockJsonResponse([{ name: 'commercial_v2' }, { name: 'legacy_old' }]);
    }
    if (query.startsWith('select column_name from')) {
      return mockJsonResponse([{ column_name: 'version' }, { column_name: 'name' }]);
    }
    return mockJsonResponse([]);
  };

  const stdout1 = makeBufferStream();
  const stderr1 = makeBufferStream();
  const r1 = await applyMigrations({
    token: 'mock-access-token-value',
    projectRef: 'testref123',
    migrationsDir: dir,
    fetchImpl: mockFetchUnmatched,
    now: () => Date.UTC(2026, 10, 27, 15, 0, 0),
    stdout: stdout1.stream,
    stderr: stderr1.stream,
  });

  assert.equal(r1.exitCode, 0);
  assert.deepEqual(r1.pending, ['0029_owner_signin_activity', '0030_next']);
  assert.deepEqual(r1.applied, ['0029_owner_signin_activity', '0030_next']);
  assert.equal(stderr1.read(), '');

  // When 0029 is already recorded by exact name in schema_migrations, only 0030+ is pending.
  const stdout2 = makeBufferStream();
  const stderr2 = makeBufferStream();
  const r2 = await applyMigrations({
    token: 'mock-access-token-value',
    projectRef: 'testref123',
    migrationsDir: dir,
    dryRun: true,
    fetchImpl: async () =>
      mockJsonResponse([
        { name: 'commercial_v2' },
        { name: '0029_owner_signin_activity' },
      ]),
    stdout: stdout2.stream,
    stderr: stderr2.stream,
  });

  assert.equal(r2.exitCode, 0);
  assert.deepEqual(r2.pending, ['0030_next']);
  assert.equal(stdout2.read(), '0030_next\n');
  assert.equal(stderr2.read(), '');
});

test('repo supabase/migrations-baseline.json is 28 and dry-run against unmatched DB names marks only 0029+ as pending', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const baselinePath = join(root, 'supabase/migrations-baseline.json');
  const migrationsDir = join(root, 'supabase/migrations');

  assert.equal(readBaseline(baselinePath), 28);

  const stdout = makeBufferStream();
  const stderr = makeBufferStream();
  const result = await applyMigrations({
    token: 'mock-access-token-value',
    projectRef: 'testref123',
    migrationsDir,
    baselinePath,
    dryRun: true,
    fetchImpl: async () => mockJsonResponse([{ name: 'commercial_v2' }]),
    stdout: stdout.stream,
    stderr: stderr.stream,
  });

  assert.equal(result.exitCode, 0);
  assert.ok(result.pending.length >= 1);
  for (const name of result.pending) {
    const num = parseMigrationNumber(name);
    assert.ok(num !== null && num > 28, `expected only >28 pending, got ${name}`);
  }
  assert.ok(result.pending.includes('0029_owner_signin_activity'));
  assert.equal(stderr.read(), '');
});

test('files without a leading number are ignored with a warning', async () => {
  const dir = makeTempMigrations(
    {
      'notes.sql': 'select 0;',
      '_0029_bad.sql': 'select 0;',
      '0029_valid.sql': 'select 29;',
    },
    { baseline: 28 },
  );

  const stdout = makeBufferStream();
  const stderr = makeBufferStream();
  const result = await applyMigrations({
    token: 'mock-access-token-value',
    projectRef: 'testref123',
    migrationsDir: dir,
    dryRun: true,
    fetchImpl: async () => mockJsonResponse([]),
    stdout: stdout.stream,
    stderr: stderr.stream,
  });

  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.pending, ['0029_valid']);
  assert.match(stderr.read(), /Warning: ignoring migration file without leading number: _0029_bad\.sql/);
  assert.match(stderr.read(), /Warning: ignoring migration file without leading number: notes\.sql/);
});

test('missing or invalid baseline file fails closed with exit 1 before any DB query', async () => {
  const missingDir = makeTempMigrations({ '0029_valid.sql': 'select 29;' }, { baseline: null });
  let fetchCalls = 0;
  const countingFetch = async () => {
    fetchCalls += 1;
    return mockJsonResponse([]);
  };

  for (const dryRun of [false, true]) {
    const stdout = makeBufferStream();
    const stderr = makeBufferStream();
    const res = await applyMigrations({
      token: 'mock-access-token-value',
      projectRef: 'testref123',
      migrationsDir: missingDir,
      dryRun,
      fetchImpl: countingFetch,
      stdout: stdout.stream,
      stderr: stderr.stream,
    });
    assert.equal(res.exitCode, 1);
    assert.deepEqual(res.pending, []);
    assert.deepEqual(res.applied, []);
    assert.match(stderr.read(), /Missing or unreadable migrations baseline file/);
  }
  assert.equal(fetchCalls, 0);

  for (const badContent of ['{bad', '{}', '{"baseline":"28"}', '{"baseline":-1}']) {
    const badDir = makeTempMigrations({ '0029_valid.sql': 'select 29;' }, { baseline: badContent });
    const stdout = makeBufferStream();
    const stderr = makeBufferStream();
    const res = await applyMigrations({
      token: 'mock-access-token-value',
      projectRef: 'testref123',
      migrationsDir: badDir,
      fetchImpl: countingFetch,
      stdout: stdout.stream,
      stderr: stderr.stream,
    });
    assert.equal(res.exitCode, 1);
    assert.ok(stderr.read().length > 0);
  }
  assert.equal(fetchCalls, 0);
});
