import { useEffect, useState } from 'react';
import { BASE_DEFAULTS, DEFAULT_LAUNDRY, STRUCTURES, evaluate, money, normalizeLaundry, syncOpexOverride, valueSummary } from '../lib/dealmath.js';
import { useDealModel } from '../lib/useDealModel.js';
import { Card, CardTitle, Empty } from './Shell.jsx';

const GROUPS = [
  ['rent-units', 'Rent & units', 'Base rent, vacancy, cap rate, Wi-Fi add'],
  ['operating-costs', 'Operating costs', 'Taxes, insurance, water, reserves, maintenance'],
  ['laundry-extras', 'Laundry & extras', 'Stacked sets, load price, card fees, repairs'],
  ['repair-plan', 'Repair plan budgets', 'Unit rehabs, permits, building costs, contingency'],
  ['seller-note', 'Seller note terms', 'Purchase note, rate, closing, renovation note'],
  ['lender-refi', 'Lender & refinance terms', 'Bridge loan, private lender, refinance terms'],
];

const numVal = (v, fallback = 0) => (v === '' || v === null || v === undefined || Number.isNaN(+v) ? fallback : +v);

function ControlRow({ label, unit = '$', value, step = 100, min = 0, max, onChange }) {
  if (unit === 'bool') {
    const checked = Boolean(value);
    return (
      <label className="flex min-h-[44px] cursor-pointer items-center justify-between gap-3 py-1.5">
        <span className="text-sm text-ink">{label}</span>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="h-5 w-5 rounded border-line accent-ink"
        />
      </label>
    );
  }
  const shown = value === undefined || value === null ? '' : value;
  const bump = (dir) => {
    const next = Math.round((numVal(shown, 0) + dir * step) * 100) / 100;
    onChange(min !== undefined ? Math.max(min, next) : next);
  };
  return (
    <label className="flex min-h-[44px] flex-wrap items-center justify-between gap-2 py-1.5">
      <span className="text-sm text-ink">{label}</span>
      <span className="flex shrink-0 items-center gap-1">
        <button type="button" aria-label={`Decrease ${label}`} onClick={() => bump(-1)} className="h-9 w-9 rounded-lg border border-line text-ink-soft hover:bg-warm-soft">−</button>
        <span className="relative">
          {unit === '$' && <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-ink-soft">$</span>}
          <input
            type="number"
            aria-label={label}
            inputMode={unit === 'n' ? 'numeric' : 'decimal'}
            min={min}
            max={max}
            step={step}
            value={shown}
            onChange={(e) => onChange(e.target.value === '' ? '' : +e.target.value)}
            className={`h-9 w-24 rounded-lg border border-line bg-white text-right text-sm font-medium outline-none focus:border-ink sm:w-28 ${unit === '$' ? 'pl-5 pr-2' : 'px-2'}`}
          />
        </span>
        <span className="w-4 text-xs text-ink-soft">{unit === '%' ? '%' : unit === 'x' ? 'x' : ''}</span>
        <button type="button" aria-label={`Increase ${label}`} onClick={() => bump(1)} className="h-9 w-9 rounded-lg border border-line text-ink-soft hover:bg-warm-soft">+</button>
      </span>
    </label>
  );
}

export default function OwnerNumbersPanel({ deal }) {
  const model = useDealModel(deal, { owner: true });
  const [openGroups, setOpenGroups] = useState({});
  const [selectedOfferId, setSelectedOfferId] = useState(null);

  const { offers, base, setBase, plan, setPlan, patchOffer, saved, error } = model;

  useEffect(() => {
    if (!Array.isArray(offers) || offers.length === 0) return;
    if (!selectedOfferId || !offers.some((o) => o.id === selectedOfferId)) {
      const lead = offers.find((o) => o.is_lead) || offers[0];
      if (lead) setSelectedOfferId(lead.id);
    }
  }, [offers, selectedOfferId]);

  if (offers === null) return <Empty>Loading numbers…</Empty>;

  const effectiveBase = {
    ...BASE_DEFAULTS,
    ...base,
    ...(plan?.opex && !base?.opex ? { opex: plan.opex } : {}),
    ...(plan?.laundry && !base?.laundry ? { laundry: plan.laundry } : {}),
  };
  const opexObj = effectiveBase.opex || {};
  const laundryObj = normalizeLaundry(effectiveBase.laundry || DEFAULT_LAUNDRY);

  const activeRent = Math.max(0, numVal(effectiveBase.rent, 1000));
  const evalCash = evaluate('cash', {}, effectiveBase);
  const o = evalCash.operating;
  const shownValue = effectiveBase.opex
    ? (valueSummary({ base: { ...o.b, ...effectiveBase }, noi: o.noi, units: o.b.units }).income ?? o.b.value)
    : o.b.value;

  const toggleGroup = (key) => setOpenGroups((prev) => ({ ...prev, [key]: !prev[key] }));

  const setRentValue = (nextRent) => {
    const cleanRent = nextRent === '' ? '' : Math.max(0, +nextRent);
    setBase({ ...effectiveBase, rent: cleanRent });
  };

  const setOpexField = (key, value, baseMirror = {}) => {
    const v = value === '' ? '' : +value;
    const prevOpex = effectiveBase.opex || {};
    const nextOpex = syncOpexOverride(prevOpex, key, v === '' ? 0 : v) || { ...prevOpex, [key]: v };
    setBase({
      ...effectiveBase,
      ...baseMirror,
      opex: nextOpex,
    });
  };

  const setLaundryField = (key, value) => {
    const nextLaundry = normalizeLaundry({ ...laundryObj, [key]: value });
    setBase({ ...effectiveBase, laundry: nextLaundry });
  };

  const activeOffer = (offers || []).find((x) => x.id === selectedOfferId)
    || (offers || []).find((x) => x.is_lead)
    || offers?.[0]
    || null;
  const activeStruct = activeOffer ? (STRUCTURES[activeOffer.structure] || STRUCTURES.wrap) : null;

  const setOfferInput = (key, value) => {
    if (!activeOffer) return;
    patchOffer(activeOffer.id, { inputs: { ...activeOffer.inputs, [key]: value } });
  };

  const units = Array.isArray(plan?.units) ? plan.units : [];
  const costs = Array.isArray(plan?.costs) ? plan.costs : [];

  return (
    <div className="space-y-4">
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

      <Card className="!p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-display text-lg font-semibold text-ink">All numbers (live across every view)</h3>
            <p className="text-xs text-ink-soft">Any change here updates Overview, Offers, Plans, Rent &amp; value, and every See as preview right away.</p>
          </div>
          {saved && (
            <span role="status" className={`rounded-full px-3 py-1 text-xs font-medium ${saved === 'Saved' ? 'bg-good/10 text-good' : 'bg-paper text-ink'}`}>
              {saved}
            </span>
          )}
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-xl bg-paper p-2.5">
            <dt className="text-[11px] uppercase tracking-wide text-ink-soft">Rent / unit</dt>
            <dd className="mt-0.5 font-display text-lg font-semibold">{money(activeRent)}</dd>
          </div>
          <div className="rounded-xl bg-paper p-2.5">
            <dt className="text-[11px] uppercase tracking-wide text-ink-soft">Gross / mo</dt>
            <dd className="mt-0.5 font-display text-lg font-semibold">{money(o.gpr / 12)}</dd>
          </div>
          <div className="rounded-xl bg-paper p-2.5">
            <dt className="text-[11px] uppercase tracking-wide text-ink-soft">Value after repairs</dt>
            <dd className="mt-0.5 font-display text-lg font-semibold">{money(shownValue)}</dd>
          </div>
          <div className="rounded-xl bg-paper p-2.5">
            <dt className="text-[11px] uppercase tracking-wide text-ink-soft">Repair budget</dt>
            <dd className="mt-0.5 font-display text-lg font-semibold">{money(o.b.rehab)}</dd>
          </div>
        </dl>
      </Card>

      <div className="divide-y divide-line rounded-2xl border border-line bg-white">
        {GROUPS.map(([key, title, hint]) => {
          const isOpen = Boolean(openGroups[key]);
          return (
            <div key={key} className="px-4 py-1">
              <button
                type="button"
                aria-expanded={isOpen}
                data-numbers-group={key}
                onClick={() => toggleGroup(key)}
                className="flex min-h-[48px] w-full items-center justify-between gap-3 py-2 text-left"
              >
                <div>
                  <span className="flex items-center gap-2 font-display text-base font-semibold text-ink">
                    <span aria-hidden="true" className="text-xs text-ink-soft">{isOpen ? '▴' : '▾'}</span>
                    <span>{title}</span>
                  </span>
                  <span className="block pl-4 text-xs text-ink-soft">{hint}</span>
                </div>
                <span className="shrink-0 text-xs font-medium text-ink-soft">{isOpen ? 'Close' : 'Edit'}</span>
              </button>

              {isOpen && (
                <div className="space-y-3 border-t border-line py-3">
                  {key === 'rent-units' && (
                    <div className="space-y-3">
                      <div className="rounded-xl bg-paper p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <label htmlFor="owner-numbers-rent-slider" className="text-sm font-medium text-ink">
                            Monthly rent per unit: {money(activeRent)}
                          </label>
                          <input
                            type="number"
                            aria-label="Rent per unit ($)"
                            min={400}
                            max={2500}
                            step={25}
                            value={base?.rent ?? ''}
                            onChange={(e) => setRentValue(e.target.value)}
                            className="h-9 w-24 rounded-lg border border-line bg-white px-2 text-right text-sm font-semibold text-ink outline-none focus:border-ink"
                          />
                        </div>
                        <input
                          id="owner-numbers-rent-slider"
                          type="range"
                          min={600}
                          max={1600}
                          step={25}
                          value={Math.min(1600, Math.max(600, activeRent))}
                          onChange={(e) => setRentValue(e.target.value)}
                          className="mt-2 h-2 w-full cursor-pointer accent-ink"
                        />
                      </div>
                      <ControlRow label="Vacancy (%)" unit="%" step={0.5} value={opexObj.vacancyPct ?? effectiveBase.vacancyPct}
                        onChange={(v) => setOpexField('vacancyPct', v, { vacancyPct: v === '' ? 0 : +v })} />
                      <ControlRow label="Value cap rate (%)" unit="%" step={0.25} value={effectiveBase.valueCapRate}
                        onChange={(v) => setBase({ ...effectiveBase, valueCapRate: v })} />
                      <ControlRow label="Wi-Fi included rent add / unit / mo ($)" unit="$" step={5} value={opexObj.wifiRentAddPerUnit ?? 0}
                        onChange={(v) => setOpexField('wifiRentAddPerUnit', v)} />
                    </div>
                  )}

                  {key === 'operating-costs' && (
                    <div className="divide-y divide-line/60">
                      <ControlRow label="Property tax / yr ($)" unit="$" step={250} value={opexObj.taxesAnnual ?? effectiveBase.taxes}
                        onChange={(v) => setOpexField('taxesAnnual', v, { taxes: v === '' ? 0 : +v })} />
                      <ControlRow label="Insurance / yr ($)" unit="$" step={250} value={opexObj.insuranceAnnual ?? effectiveBase.insurance}
                        onChange={(v) => setOpexField('insuranceAnnual', v, { insurance: v === '' ? 0 : +v })} />
                      <ControlRow label="Water, sewer & trash / yr ($)" unit="$" step={300} value={opexObj.waterSewerTrashAnnual ?? numVal(effectiveBase.waterMo, 0) * 12}
                        onChange={(v) => setOpexField('waterSewerTrashAnnual', v, { waterMo: v === '' ? 0 : Math.round(+v / 12) })} />
                      <ControlRow label="Common area utilities / yr ($)" unit="$" step={100} value={opexObj.commonAreaUtilitiesAnnual ?? 0}
                        onChange={(v) => setOpexField('commonAreaUtilitiesAnnual', v)} />
                      <ControlRow label="Repairs & maintenance (% of gross)" unit="%" step={0.5} value={opexObj.repairsMaintPct ?? 0}
                        onChange={(v) => setOpexField('repairsMaintPct', v)} />
                      <ControlRow label="Reserves / unit / yr ($)" unit="$" step={25} value={opexObj.reservesPerUnitAnnual ?? effectiveBase.reservesPerUnit}
                        onChange={(v) => setOpexField('reservesPerUnitAnnual', v, { reservesPerUnit: v === '' ? 0 : +v })} />
                      <ControlRow label="Building internet (Spectrum) / yr ($)" unit="$" step={60} value={opexObj.wifiAnnual ?? 0}
                        onChange={(v) => setOpexField('wifiAnnual', v)} />
                      <ControlRow label="Snow & lawn / yr ($)" unit="$" step={100} value={opexObj.snowLawnAnnual ?? 0}
                        onChange={(v) => setOpexField('snowLawnAnnual', v)} />
                      <ControlRow label="Cameras / yr ($)" unit="$" step={50} value={opexObj.camerasAnnual ?? 0}
                        onChange={(v) => setOpexField('camerasAnnual', v)} />
                      <ControlRow label="Management / admin / yr ($)" unit="$" step={100} value={opexObj.mgmtHelpAnnual ?? 0}
                        onChange={(v) => setOpexField('mgmtHelpAnnual', v)} />
                      <ControlRow label="Empty unit utilities / mo ($)" unit="$" step={5} value={effectiveBase.emptyUnitUtilMo}
                        onChange={(v) => setBase({ ...effectiveBase, emptyUnitUtilMo: v })} />
                    </div>
                  )}

                  {key === 'laundry-extras' && (
                    <div className="divide-y divide-line/60">
                      <ControlRow label="Laundry income enabled" unit="bool" value={laundryObj.enabled}
                        onChange={(v) => setLaundryField('enabled', v)} />
                      <ControlRow label="Speed Queen stacks" unit="n" step={1} value={laundryObj.stacks}
                        onChange={(v) => setLaundryField('stacks', v)} />
                      <ControlRow label="Price per load ($)" unit="$" step={0.5} value={laundryObj.pricePerLoad}
                        onChange={(v) => setLaundryField('pricePerLoad', v)} />
                      <ControlRow label="Loads / unit / week" unit="n" step={0.5} value={laundryObj.loadsPerUnitPerWeek}
                        onChange={(v) => setLaundryField('loadsPerUnitPerWeek', v)} />
                      <ControlRow label="Tap / card share (%)" unit="%" step={5} value={laundryObj.cardSharePct}
                        onChange={(v) => setLaundryField('cardSharePct', v)} />
                      <ControlRow label="Card fee (%)" unit="%" step={0.5} value={laundryObj.cardFeePct}
                        onChange={(v) => setLaundryField('cardFeePct', v)} />
                      <ControlRow label="Utility per load ($)" unit="$" step={0.05} value={laundryObj.utilityPerLoad}
                        onChange={(v) => setLaundryField('utilityPerLoad', v)} />
                      <ControlRow label="Reader fees / yr ($)" unit="$" step={20} value={laundryObj.readerFeesAnnual}
                        onChange={(v) => setLaundryField('readerFeesAnnual', v)} />
                      <ControlRow label="Repairs per stack / yr ($)" unit="$" step={25} value={laundryObj.repairsPerStackAnnual}
                        onChange={(v) => setLaundryField('repairsPerStackAnnual', v)} />
                    </div>
                  )}

                  {key === 'repair-plan' && (
                    plan ? (
                      <div className="space-y-3">
                        {units.length > 0 && (
                          <div>
                            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-soft">Units</p>
                            <div className="grid gap-2 sm:grid-cols-2">
                              {units.map((u, idx) => (
                                <ControlRow
                                  key={u.id || idx}
                                  label={`Unit ${u.id}`}
                                  unit="$"
                                  step={500}
                                  value={u.rehab}
                                  onChange={(v) => {
                                    const val = v === '' ? 0 : +v;
                                    setPlan({
                                      ...plan,
                                      units: units.map((x, j) => (j === idx ? { ...x, rehab: val } : x)),
                                    });
                                  }}
                                />
                              ))}
                            </div>
                          </div>
                        )}
                        {costs.length > 0 && (
                          <div>
                            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-soft">Setup, permits &amp; building work</p>
                            <div className="divide-y divide-line/60">
                              {costs.map((c, idx) => (
                                <ControlRow
                                  key={`${c.label}-${idx}`}
                                  label={c.label}
                                  unit="$"
                                  step={250}
                                  value={c.cost}
                                  onChange={(v) => {
                                    const val = v === '' ? 0 : +v;
                                    setPlan({
                                      ...plan,
                                      costs: costs.map((x, j) => (j === idx ? { ...x, cost: val } : x)),
                                    });
                                  }}
                                />
                              ))}
                            </div>
                          </div>
                        )}
                        <div className="border-t border-line pt-2">
                          <ControlRow
                            label="Repair contingency (only if used)"
                            unit="$"
                            step={1000}
                            value={plan.contingency ?? 0}
                            onChange={(v) => setPlan({ ...plan, contingency: v === '' ? 0 : +v })}
                          />
                        </div>
                      </div>
                    ) : (
                      <ControlRow label="Repair budget ($)" unit="$" step={1000} value={effectiveBase.rehab}
                        onChange={(v) => setBase({ ...effectiveBase, rehab: v })} />
                    )
                  )}

                  {key === 'seller-note' && (
                    activeOffer && activeStruct ? (
                      <div className="space-y-2">
                        {offers.length > 1 && (
                          <label className="flex min-h-[40px] items-center justify-between gap-2 text-sm">
                            <span className="font-medium text-ink">Offer being edited</span>
                            <select
                              aria-label="Offer being edited"
                              value={activeOffer.id}
                              onChange={(e) => setSelectedOfferId(e.target.value)}
                              className="h-9 rounded-lg border border-line bg-white px-2.5 text-sm"
                            >
                              {offers.map((x) => (
                                <option key={x.id} value={x.id}>{x.is_lead ? `★ ${x.name}` : x.name}</option>
                              ))}
                            </select>
                          </label>
                        )}
                        <div className="divide-y divide-line/60">
                          {activeStruct.fields.map(([k, l, u]) => {
                            const d = activeStruct.defaults[k];
                            const v = activeOffer.inputs?.[k];
                            const step = u === '%' ? 0.25 : u === 'n' ? 1 : 500;
                            return (
                              <ControlRow
                                key={k}
                                label={l}
                                unit={u}
                                step={step}
                                value={v ?? d}
                                onChange={(nv) => setOfferInput(k, nv)}
                              />
                            );
                          })}
                          {activeOffer.structure !== 'cash' && !activeStruct.fields.some(([k]) => k === 'shortCarry') && (
                            <ControlRow
                              label="Short months paid by repair loan ($)"
                              unit="$"
                              step={500}
                              value={activeOffer.inputs?.shortCarry ?? 0}
                              onChange={(nv) => setOfferInput('shortCarry', nv)}
                            />
                          )}
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-ink-soft">No offer configured yet.</p>
                    )
                  )}

                  {key === 'lender-refi' && (
                    <div className="divide-y divide-line/60">
                      <ControlRow label="Purchase price ($)" unit="$" step={5000} value={effectiveBase.purchasePrice}
                        onChange={(v) => setBase({ ...effectiveBase, purchasePrice: v })} />
                      <ControlRow label="Bridge closing costs ($)" unit="$" step={500} value={effectiveBase.bridgeClosing}
                        onChange={(v) => setBase({ ...effectiveBase, bridgeClosing: v })} />
                      <ControlRow label="Bridge processing fee ($)" unit="$" step={50} value={effectiveBase.bridgeProcessing}
                        onChange={(v) => setBase({ ...effectiveBase, bridgeProcessing: v })} />
                      <ControlRow label="Bridge points (%)" unit="%" step={0.25} value={effectiveBase.bridgePointsPct ?? plan?.bridgePoints}
                        onChange={(v) => setBase({ ...effectiveBase, bridgePointsPct: v })} />
                      <ControlRow label="Bridge interest rate (%)" unit="%" step={0.25} value={effectiveBase.bridgeRate ?? plan?.bridgeRate}
                        onChange={(v) => setBase({ ...effectiveBase, bridgeRate: v })} />
                      <ControlRow label="Bridge deferred months" unit="n" step={1} value={effectiveBase.bridgeDeferredMonths ?? plan?.bridgeDeferredMonths}
                        onChange={(v) => setBase({ ...effectiveBase, bridgeDeferredMonths: v })} />
                      <ControlRow label="Bridge term (months)" unit="n" step={1} value={effectiveBase.bridgeTermMonths ?? plan?.bridgeTermMonths}
                        onChange={(v) => setBase({ ...effectiveBase, bridgeTermMonths: v })} />
                      <ControlRow label="Private lender rate (%)" unit="%" step={0.25} value={effectiveBase.privateRate ?? plan?.privateRate}
                        onChange={(v) => setBase({ ...effectiveBase, privateRate: v })} />
                      <ControlRow label="Private lender term (months)" unit="n" step={1} value={effectiveBase.privateTermMonths ?? plan?.privateTermMonths}
                        onChange={(v) => setBase({ ...effectiveBase, privateTermMonths: v })} />
                      <ControlRow label="Private lender min participation ($)" unit="$" step={5000} value={effectiveBase.privateMinParticipation ?? plan?.privateMinParticipation}
                        onChange={(v) => setBase({ ...effectiveBase, privateMinParticipation: v })} />
                      <ControlRow label="Refinance rate (%)" unit="%" step={0.25} value={effectiveBase.refiRate}
                        onChange={(v) => setBase({ ...effectiveBase, refiRate: v })} />
                      <ControlRow label="Refinance amortization (years)" unit="n" step={1} value={effectiveBase.refiYears}
                        onChange={(v) => setBase({ ...effectiveBase, refiYears: v })} />
                      <ControlRow label="Refinance max LTV (%)" unit="%" step={5} value={effectiveBase.refiLtv}
                        onChange={(v) => setBase({ ...effectiveBase, refiLtv: v })} />
                      <ControlRow label="Refinance min DSCR" unit="x" step={0.05} value={effectiveBase.refiDscr}
                        onChange={(v) => setBase({ ...effectiveBase, refiDscr: v })} />
                      <ControlRow label="Refinance flat fees ($)" unit="$" step={500} value={effectiveBase.refiFeesFlat}
                        onChange={(v) => setBase({ ...effectiveBase, refiFeesFlat: v })} />
                      <ControlRow label="Refinance percentage fees (%)" unit="%" step={0.1} value={effectiveBase.refiFeesPct}
                        onChange={(v) => setBase({ ...effectiveBase, refiFeesPct: v })} />
                      <ControlRow label="Refinance lender reserve ($)" unit="$" step={500} value={effectiveBase.refiReserve}
                        onChange={(v) => setBase({ ...effectiveBase, refiReserve: v })} />
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
