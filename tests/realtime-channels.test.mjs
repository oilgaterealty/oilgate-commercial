import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// One page per role mounts the same component more than once. Supabase reuses a
// channel by name, so every realtime channel needs a per-instance name or the
// second mount throws "cannot add postgres_changes callbacks after subscribe()".
for (const f of ['src/components/Files.jsx', 'src/components/Messages.jsx', 'src/components/Activity.jsx']) {
  test(`${f} gives each realtime channel a per-instance name`, () => {
    const src = readFileSync(f, 'utf8');
    const calls = src.match(/supabase\.channel\(`[^`]*`\)/g) || [];
    assert.ok(calls.length > 0);
    for (const c of calls) assert.match(c, /Math\.random\(\)/);
  });
}
