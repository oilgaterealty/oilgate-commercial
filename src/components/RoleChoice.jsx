import { REQUEST_ROLES } from '../lib/requestRoles.js';

export default function RoleChoice({ value, onChange, disabled }) {
  return (
    <div role="radiogroup" aria-label="Your role" className="grid grid-cols-3 gap-2">
      {REQUEST_ROLES.map(([k, label]) => {
        const on = value === k;
        return (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onChange(k)}
            className={`min-h-[44px] rounded-xl border px-3 py-2 text-sm font-medium transition ${on ? 'border-ink bg-ink text-white' : 'border-line bg-white text-ink hover:border-ink'}`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
