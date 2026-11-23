import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { WALK_SPACES, spaceLabel, roomsFor, roomFits } from '../lib/leaseUp.js';

// Sticky bar at the bottom of the phone screen while picking photos and videos to move.
export default function MoveBar({ count, total, fromUnit, fromRoom, busy, onSelectAll, onClear, onCancel, onMove }) {
  const [unit, setUnit] = useState(fromUnit);
  const [room, setRoom] = useState(fromRoom);
  useEffect(() => {
    if (!roomFits(unit, room)) setRoom(roomsFor(unit)[0][0]);
  }, [unit, room]);
  const same = unit === fromUnit && room === fromRoom;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white/95 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2.5 shadow-[0_-6px_20px_rgba(0,0,0,0.12)] backdrop-blur">
      <div className="mx-auto max-w-3xl space-y-2">
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="font-semibold">{count} selected</span>
          <div className="flex gap-1.5">
            <button type="button" onClick={count === total ? onClear : onSelectAll} className="min-h-[40px] rounded-lg border border-line px-3 text-xs font-medium">
              {count === total ? 'Clear' : `Select all ${total}`}
            </button>
            <button type="button" onClick={onCancel} className="min-h-[40px] rounded-lg border border-line px-3 text-xs font-medium">
              Cancel
            </button>
          </div>
        </div>
        <MoveTarget unit={unit} room={room} setUnit={setUnit} setRoom={setRoom} idPrefix="move"
          disabled={busy || count === 0 || same} busy={busy} onMove={() => onMove(unit, room)} />
      </div>
    </div>
  );
}

// The space + room picker and Move button, shared by the batch bar and the single-photo dialog.
function MoveTarget({ unit, room, setUnit, setRoom, idPrefix, disabled, busy, onMove }) {
  return (
    <div className="flex items-center gap-2">
      <label className="sr-only" htmlFor={`${idPrefix}-space`}>Move to space</label>
      <select id={`${idPrefix}-space`} value={unit} onChange={(e) => setUnit(Number(e.target.value))} className="min-h-[44px] min-w-0 flex-1 rounded-xl border border-line bg-white px-2 text-sm font-medium">
        {WALK_SPACES.map((u) => (
          <option key={u} value={u}>{spaceLabel(u)}</option>
        ))}
      </select>
      <label className="sr-only" htmlFor={`${idPrefix}-room`}>Move to room</label>
      <select id={`${idPrefix}-room`} value={room} onChange={(e) => setRoom(e.target.value)} disabled={roomsFor(unit).length < 2} className="min-h-[44px] min-w-0 flex-1 rounded-xl border border-line bg-white px-2 text-sm font-medium disabled:opacity-60">
        {roomsFor(unit).map(([k, label]) => (
          <option key={k} value={k}>{label}</option>
        ))}
      </select>
      <button
        type="button"
        disabled={disabled}
        onClick={onMove}
        className="min-h-[44px] shrink-0 rounded-xl bg-ink px-4 text-sm font-semibold text-white disabled:opacity-40"
      >
        {busy ? 'Moving…' : 'Move'}
      </button>
    </div>
  );
}

// "Move to…" for one photo, from its thumbnail overlay or the photo viewer. Sits above the viewer (z-[110]).
export function MoveOneDialog({ fromUnit, fromRoom, busy, onMove, onCancel }) {
  const [unit, setUnit] = useState(fromUnit);
  const [room, setRoom] = useState(fromRoom);
  useEffect(() => {
    if (!roomFits(unit, room)) setRoom(roomsFor(unit)[0][0]);
  }, [unit, room]);
  const same = unit === fromUnit && room === fromRoom;
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Move photo to" onClick={onCancel}
      className="fixed inset-0 z-[110] flex items-end justify-center bg-black/50 p-3 sm:items-center">
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md space-y-3 rounded-2xl bg-white p-4 shadow-xl">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold">Move this photo to…</p>
          <button type="button" onClick={onCancel} className="min-h-[40px] rounded-lg border border-line px-3 text-xs font-medium">Cancel</button>
        </div>
        <MoveTarget unit={unit} room={room} setUnit={setUnit} setRoom={setRoom} idPrefix="move-one"
          disabled={busy || same} busy={busy} onMove={() => onMove(unit, room)} />
      </div>
    </div>,
    document.body,
  );
}
