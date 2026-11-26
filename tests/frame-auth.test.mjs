import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FRAME_SESSION_MSG_TYPE,
  deliverPopupSession,
  isAllowedFrameParent,
  isValidSessionMessage,
  parseAllowedOrigin,
} from '../src/lib/frameAuth.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8');

test('parseAllowedOrigin accepts valid https origins only', () => {
  assert.equal(parseAllowedOrigin('https://lab.example.com/path'), 'https://lab.example.com');
  assert.equal(parseAllowedOrigin('http://lab.example.com'), null);
  assert.equal(parseAllowedOrigin('https://user:pass@lab.example.com'), null);
  assert.equal(parseAllowedOrigin(''), null);
  assert.equal(parseAllowedOrigin('not a url'), null);
});

test('isAllowedFrameParent enforces owner-only and exact origin checks', () => {
  const parent = 'https://super-lab.example.com';
  // Not framed: always allowed regardless of siteKind or env.
  assert.equal(isAllowedFrameParent({ siteKind: 'public', allowedParent: '', framed: false }), true);
  assert.equal(isAllowedFrameParent({ siteKind: 'seller', allowedParent: '', framed: false }), true);
  assert.equal(isAllowedFrameParent({ siteKind: 'owner', allowedParent: '', framed: false }), true);

  // Non-owner builds never allow framing even if VITE_FRAME_PARENT is passed.
  assert.equal(isAllowedFrameParent({ siteKind: 'public', allowedParent: parent, framed: true, ancestorOrigins: [parent] }), false);
  assert.equal(isAllowedFrameParent({ siteKind: 'seller', allowedParent: parent, framed: true, ancestorOrigins: [parent] }), false);
  assert.equal(isAllowedFrameParent({ siteKind: '', allowedParent: parent, framed: true, ancestorOrigins: [parent] }), false);

  // Owner build with ancestorOrigins: every ancestor must match.
  assert.equal(isAllowedFrameParent({ siteKind: 'owner', allowedParent: parent, framed: true, ancestorOrigins: [parent] }), true);
  assert.equal(isAllowedFrameParent({ siteKind: 'owner', allowedParent: parent, framed: true, ancestorOrigins: [parent, 'https://evil.example'] }), false);
  assert.equal(isAllowedFrameParent({ siteKind: 'owner', allowedParent: parent, framed: true, ancestorOrigins: ['https://evil.example'] }), false);

  // Fallback to document.referrer when ancestorOrigins is unavailable.
  assert.equal(isAllowedFrameParent({ siteKind: 'owner', allowedParent: parent, framed: true, ancestorOrigins: undefined, referrer: `${parent}/#/realty/deal-charlotte` }), true);
  assert.equal(isAllowedFrameParent({ siteKind: 'owner', allowedParent: parent, framed: true, ancestorOrigins: undefined, referrer: 'https://evil.example/' }), false);
  assert.equal(isAllowedFrameParent({ siteKind: 'owner', allowedParent: parent, framed: true, ancestorOrigins: undefined, referrer: '' }), false);
  assert.equal(isAllowedFrameParent({ siteKind: 'owner', allowedParent: '', framed: true, ancestorOrigins: [parent] }), false);
});

test('isValidSessionMessage requires exact origin, expected popup source, and tokens', () => {
  const popup = { name: 'popup' };
  const origin = 'https://owner.example.com';
  const valid = {
    origin,
    source: popup,
    data: { type: FRAME_SESSION_MSG_TYPE, access_token: 'at_123', refresh_token: 'rt_456' },
  };
  assert.equal(isValidSessionMessage(valid, origin, popup), true);
  assert.equal(isValidSessionMessage({ ...valid, origin: 'https://other.example.com' }, origin, popup), false);
  assert.equal(isValidSessionMessage({ ...valid, source: {} }, origin, popup), false);
  assert.equal(isValidSessionMessage(valid, origin, null), false);
  assert.equal(isValidSessionMessage({ ...valid, data: { type: 'other', access_token: 'a', refresh_token: 'b' } }, origin, popup), false);
  assert.equal(isValidSessionMessage({ ...valid, data: { type: FRAME_SESSION_MSG_TYPE, access_token: '', refresh_token: 'b' } }, origin, popup), false);
});

test('deliverPopupSession posts session to opener with same origin and closes', () => {
  const sent = [];
  let closed = false;
  const win = {
    location: { origin: 'https://owner.example.com' },
    opener: { postMessage: (msg, target) => sent.push({ msg, target }) },
    close: () => { closed = true; },
  };
  assert.equal(deliverPopupSession({ access_token: 'at', refresh_token: 'rt' }, win), true);
  assert.deepEqual(sent, [{
    msg: { type: 'og-session', access_token: 'at', refresh_token: 'rt' },
    target: 'https://owner.example.com',
  }]);
  assert.equal(closed, true);

  // Without opener, does nothing.
  assert.equal(deliverPopupSession({ access_token: 'at', refresh_token: 'rt' }, { location: { origin: 'https://owner.example.com' } }), false);
});

test('main.jsx and App.jsx keep framed owner sign-in minimal with no hardcoded hostnames', () => {
  const main = read('src/main.jsx');
  const app = read('src/App.jsx');
  assert.match(main, /VITE_FRAME_PARENT/);
  assert.match(main, /window\.top !== window\.self/);
  assert.match(app, /if \(framedOwner\)[\s\S]*<Button onClick=\{openPopup\}>Sign in<\/Button>/);
  assert.doesNotMatch(app + main + read('src/lib/frameAuth.js'), /chatgpt\.site|oilgate-super-lab/i);
});
