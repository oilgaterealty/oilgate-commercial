import { useEffect, useState } from 'react';
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
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="move-space">Move to space</label>
          <select id="move-space" value={unit} onChange={(e) => setUnit(Number(e.target.value))} className="min-h-[44px] min-w-0 flex-1 rounded-xl border border-line bg-white px-2 text-sm font-medium">
            {WALK_SPACES.map((u) => (
              <option key={u} value={u}>{spaceLabel(u)}</option>
            ))}
          </select>
          <label className="sr-only" htmlFor="move-room">Move to room</label>
          <select id="move-room" value={room} onChange={(e) => setRoom(e.target.value)} disabled={roomsFor(unit).length < 2} className="min-h-[44px] min-w-0 flex-1 rounded-xl border border-line bg-white px-2 text-sm font-medium disabled:opacity-60">
            {roomsFor(unit).map(([k, label]) => (
              <option key={k} value={k}>{label}</option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy || count === 0 || same}
            onClick={() => onMove(unit, room)}
            className="min-h-[44px] shrink-0 rounded-xl bg-ink px-4 text-sm font-semibold text-white disabled:opacity-40"
          >
            {busy ? 'Moving…' : 'Move'}
          </button>
        </div>
      </div>
    </div>
  );
}
