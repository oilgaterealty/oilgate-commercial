import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8');

test('the in-app photo viewer exists and closes on outside tap, X and Escape', () => {
  assert.ok(existsSync('src/components/PhotoViewer.jsx'));
  const v = read('src/components/PhotoViewer.jsx');
  assert.match(v, /fixed inset-0/);
  assert.match(v, /object-contain/);
  assert.match(v, /onClick=\{close\}/);
  assert.match(v, /'Escape'/);
  assert.match(v, /aria-label="Close"/);
  assert.match(v, /<video[^>]*controls/);
});

test('no photo opens in a new tab', () => {
  const walk = read('src/views/Walkthrough.jsx');
  const photos = read('src/components/Photos.jsx');
  const files = read('src/components/Files.jsx');
  assert.doesNotMatch(walk, /target="_blank"/);
  assert.doesNotMatch(photos, /target="_blank"/);
  for (const f of [walk, photos, files]) assert.match(f, /PhotoViewer/);
  // Files.jsx keeps a new-tab link only for documents (PDF, Word, Excel).
  assert.equal((files.match(/target="_blank"/g) || []).length, 1);
  assert.match(files, /r\.kind === 'photo' && r\.url\s*\?\s*<button[\s\S]*?: <a href=\{r\.url\} target="_blank"/);
});

test('viewer has large Previous and Next buttons that hide at the ends', () => {
  const v = read('src/components/PhotoViewer.jsx');
  assert.match(v, /aria-label=\{d > 0 \? 'Next photo' : 'Previous photo'\}/);
  assert.match(v, /min-h-\[44px\] min-w-\[44px\]/);
  assert.match(v, /top-1\/2/);
  assert.match(v, /const hasPrev = index > 0;/);
  assert.match(v, /const hasNext = index < count - 1;/);
  assert.match(v, /const show = d > 0 \? hasNext : hasPrev;\s*if \(!show\) return null;/);
  // swipe and arrow keys still step
  assert.match(v, /'ArrowRight'\) step\(1\)/);
  assert.match(v, /'ArrowLeft'\) step\(-1\)/);
  assert.match(v, /onTouchEnd=\{onTouchEnd\}/);
  assert.match(v, /\{index \+ 1\} \/ \{count\}/);
});

test('viewer has a bottom action bar fed by the caller, with pressed state', () => {
  const v = read('src/components/PhotoViewer.jsx');
  assert.match(v, /export default function PhotoViewer\(\{ items, index, onIndex, actions \}\)/);
  assert.match(v, /role="toolbar" aria-label="Photo actions"/);
  assert.match(v, /aria-pressed=\{a\.pressed === undefined \? undefined : Boolean\(a\.pressed\)\}/);
  const walk = read('src/views/Walkthrough.jsx');
  assert.match(walk, /actions=\{viewerActions\}/);
  assert.match(walk, /label: 'Move this one'/);
  assert.match(walk, /key: 'select', icon: '✓', label: 'Select', pressed: picked\.has\(k\)/);
  assert.match(walk, /label: 'Share with seller'/);
  assert.match(walk, /label: 'Share with lender'/);
  // Move/Select only for what this role may move; sharing only for the owner outside preview.
  assert.match(walk, /if \(movable\.has\(k\)\) \{/);
  assert.match(walk, /if \(row && role === 'owner' && !preview\) \{/);
  // Single-photo move reuses the batch move and the shared space/room picker, then steps to the next photo.
  assert.match(walk, /await moveSelected\(toUnit, toRoom, \[k\]\);/);
  assert.match(walk, /if \(viewing\) setViewKey\(nextKey\);/);
  assert.match(walk, /<MoveOneDialog/);
  const bar = read('src/components/WalkMoveBar.jsx');
  assert.match(bar, /export function MoveOneDialog/);
  assert.match(bar, /function MoveTarget/);
  const photos = read('src/components/Photos.jsx');
  assert.match(photos, /actions=\{\(_, j\) => \(photos\[j\] \? shareButtons\(photos\[j\]\) : \[\]\)\}/);
});

test('every photo grid has a bottom overlay bar on its thumbnails', () => {
  const v = read('src/components/PhotoViewer.jsx');
  assert.match(v, /export function ThumbOverlay/);
  assert.match(v, /absolute inset-x-0 bottom-0/);
  // hover on desktop, always visible on touch
  assert.match(v, /\[@media\(hover:hover\)\]:opacity-0 \[@media\(hover:hover\)\]:group-hover:opacity-100/);
  // overlay buttons never open the viewer
  assert.match(v, /onClick=\{\(e\) => \{ e\.stopPropagation\(\); e\.preventDefault\(\); b\.onClick\(\); \}\}/);
  const walk = read('src/views/Walkthrough.jsx');
  assert.match(walk, /<ThumbOverlay buttons=\{photoButtons\(`l:\$\{m\.id\}`, null, true\)\} \/>/);
  assert.match(walk, /<ThumbOverlay buttons=\{photoButtons\(`p:\$\{p\.id\}`, p, true\)\} \/>/);
  const photos = read('src/components/Photos.jsx');
  assert.equal((photos.match(/<ThumbOverlay /g) || []).length, 2); // strip + All photos grid
  const files = read('src/components/Files.jsx');
  assert.match(files, /export function PhotoGrid[\s\S]*<ThumbOverlay /);
  assert.match(files, /export function uploadShareButtons/);
});

test('batch select still selects instead of opening the viewer', () => {
  const walk = read('src/views/Walkthrough.jsx');
  assert.match(walk, /selecting && movable\.has\(`p:\$\{p\.id\}`\) \? \(\s*<button[^>]*onClick=\{\(\) => togglePick\(`p:\$\{p\.id\}`\)\}/);
  assert.match(walk, /selecting && movable\.has\(`l:\$\{m\.id\}`\) \? \(\s*<button[^>]*onClick=\{\(\) => togglePick\(`l:\$\{m\.id\}`\)\}/);
});
