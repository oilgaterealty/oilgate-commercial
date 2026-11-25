import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { STAGES, stageMove, unitCount, v5Access, canChangeLead, suggestionDiff } from '../lib/leaseUp.js';
import { roleLabel } from '../lib/format.js';
import { Button, Card, CardTitle, Empty, Field } from '../components/Shell.jsx';
import { DictatedField } from '../components/Dictation.jsx';
import StrategyIdeas from './StrategyIdeas.jsx';

const BLANK = { name: '', phone: '', email: '', notes: '' };
const range = (n) => Array.from({ length: n }, (_, i) => i + 1);

function LeadForm({ initial = BLANK, disabled, onSave, onCancel }) {
  const [f, setF] = useState(initial);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <form
      className="space-y-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!f.name.trim()) return;
        onSave({
          name: f.name.trim(),
          phone: f.phone.trim(),
          email: f.email.trim(),
          notes: f.notes.trim(),
        });
      }}
    >
      <div className="grid gap-2.5 sm:grid-cols-3">
        <label className="text-xs text-ink-soft">
          Name
          <Field required disabled={disabled} aria-label="Lead name" placeholder="Full name" maxLength={140} value={f.name} onChange={set('name')} className="mt-1" />
        </label>
        <label className="text-xs text-ink-soft">
          Phone
          <Field type="tel" disabled={disabled} aria-label="Lead phone" placeholder="Phone number" maxLength={60} value={f.phone} onChange={set('phone')} className="mt-1" />
        </label>
        <label className="text-xs text-ink-soft">
          Email
          <Field type="email" disabled={disabled} aria-label="Lead email" placeholder="Email address" maxLength={200} value={f.email} onChange={set('email')} className="mt-1" />
        </label>
      </div>
      <label className="block text-xs text-ink-soft">
        Notes
        <DictatedField
          as="textarea"
          rows={2}
          disabled={disabled}
          aria-label="Lead notes"
          placeholder="Notes about this applicant…"
          maxLength={4000}
          value={f.notes}
          onChange={set('notes')}
          className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-ink"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={disabled || !f.name.trim()}>{initial.id ? 'Save lead' : 'Add lead'}</Button>
        {onCancel && <Button type="button" kind="secondary" onClick={onCancel}>Cancel</Button>}
      </div>
    </form>
  );
}

const FIELD_LABEL = { name: 'Name', phone: 'Phone', email: 'Email', notes: 'Notes', stage: 'Stage' };
const stageName = (k) => STAGES.find(([id]) => id === k)?.[1] || k;
const shown = (k, v) => (k === 'stage' ? stageName(v) : v || '(blank)');

// The realtor's proposed edit to one of the owner's leads. Nothing changes until the owner accepts.
function SuggestForm({ lead, disabled, onSend, onCancel }) {
  const [f, setF] = useState({ name: lead.name, phone: lead.phone, email: lead.email, notes: lead.notes, stage: lead.stage === 'moved_in' ? 'approved' : lead.stage });
  const [note, setNote] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const changes = suggestionDiff(lead, f);
  const none = Object.keys(changes).length === 0;
  return (
    <form className="space-y-2 rounded-lg bg-paper p-2" onSubmit={(e) => { e.preventDefault(); if (!none) onSend(changes, note.trim()); }}>
      <p className="text-xs font-medium">Suggest a change. The buyer accepts or turns it down.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field aria-label="Suggested name" maxLength={140} value={f.name} onChange={set('name')} />
        <Field aria-label="Suggested phone" maxLength={60} value={f.phone} onChange={set('phone')} />
        <Field aria-label="Suggested email" maxLength={200} value={f.email} onChange={set('email')} />
        <select aria-label="Suggested stage" value={f.stage} onChange={set('stage')} className="rounded-xl border border-line bg-white px-3 py-2 text-sm">
          {STAGES.filter(([k]) => k !== 'moved_in').map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>
      <DictatedField as="textarea" rows={2} aria-label="Suggested notes" maxLength={4000} value={f.notes} onChange={set('notes')} className="w-full rounded-xl border border-line bg-white px-3 py-2 text-sm" />
      <Field aria-label="Why (optional)" placeholder="Why (optional)" maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={disabled || none} className="!px-2.5 !py-1 !text-xs">Send suggestion</Button>
        <Button type="button" kind="secondary" onClick={onCancel} className="!px-2.5 !py-1 !text-xs">Cancel</Button>
      </div>
    </form>
  );
}

export default function Tenants({ deal, me, role, preview }) {
  const access = v5Access(role);
  const edit = access.editTenants && !preview;
  const [units, setUnits] = useState(10);
  const [leads, setLeads] = useState(null);
  const [loadErr, setLoadErr] = useState('');
  const [status, setStatus] = useState('');
  const [pending, setPending] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [movingId, setMovingId] = useState(null);
  const [pickUnit, setPickUnit] = useState('');
  const [formKey, setFormKey] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [suggestions, setSuggestions] = useState([]);
  const [suggestingId, setSuggestingId] = useState(null);

  useEffect(() => {
    if (!access.tenants) return;
    let live = true;
    Promise.all([
      supabase.from('commercial_models').select('base').eq('deal_id', deal.id).maybeSingle(),
      supabase.from('commercial_tenant_leads').select('*').eq('deal_id', deal.id).order('created_at', { ascending: false }),
      preview ? Promise.resolve({ data: [] }) : supabase.from('commercial_tenant_suggestions').select('*').eq('deal_id', deal.id).eq('status', 'pending').order('created_at'),
    ]).then(([m, l, s]) => {
      if (!live) return;
      setSuggestions(s.data || []);
      setUnits(unitCount(m.data?.base?.units));
      setLeads(l.data || []);
      setLoadErr(l.error ? 'Tenant pipeline could not load. Refresh to try again.' : '');
    });
    return () => { live = false; };
  }, [deal.id, access.tenants, refresh]);

  if (!access.tenants) return null;

  const list = leads || [];
  const occupiedByUnit = Object.fromEntries(
    list.filter((l) => l.stage === 'moved_in' && l.unit_number).map((l) => [l.unit_number, l])
  );
  const filledCount = range(units).filter((u) => occupiedByUnit[u]).length;
  const openCount = units - filledCount;

  const occupiedNumbers = (exceptId) =>
    list.filter((l) => l.id !== exceptId && l.stage === 'moved_in' && l.unit_number).map((l) => l.unit_number);

  const availableUnitsFor = (lead) => range(units).filter((n) => !occupiedNumbers(lead.id).includes(n));

  const saveLead = async (fields, id) => {
    if (!edit || pending) return;
    setPending(true);
    setStatus('');
    try {
      const q = supabase.from('commercial_tenant_leads');
      const res = id
        ? await q.update({ ...fields, updated_at: new Date().toISOString() }).eq('id', id).eq('deal_id', deal.id).select('id').maybeSingle()
        : await q.insert({ ...fields, deal_id: deal.id, author_uid: me.uid, author_role: role }).select('id').maybeSingle();
      if (res.error || !res.data) {
        setStatus(
          res.error?.code === '23505'
            ? 'That unit already has a tenant. Pick another unit.'
            : 'Could not save. Check connection and try again.'
        );
        return;
      }
      setEditingId(null);
      setMovingId(null);
      setPickUnit('');
      if (!id) setFormKey((k) => k + 1);
      setStatus(id ? 'Saved.' : 'Lead added.');
      setRefresh((r) => r + 1);
    } catch {
      setStatus('Could not save. Try again.');
    } finally {
      setPending(false);
    }
  };

  const removeLead = async (lead) => {
    if (!edit || pending || !window.confirm(`Remove ${lead.name}?`)) return;
    setPending(true);
    setStatus('');
    try {
      const { error } = await supabase.from('commercial_tenant_leads').delete().eq('id', lead.id).eq('deal_id', deal.id);
      setStatus(error ? 'Could not remove lead.' : 'Lead removed.');
      setRefresh((r) => r + 1);
    } finally {
      setPending(false);
    }
  };

  const suggest = async (lead, changes, note) => {
    if (!edit || pending) return;
    setPending(true);
    setStatus('');
    try {
      const { error } = await supabase.from('commercial_tenant_suggestions').insert({ deal_id: deal.id, lead_id: lead.id, changes, note, author_uid: me.uid, author_role: 'realtor', author_name: me.name || '' });
      setStatus(error ? 'Suggestion not sent. Try again.' : 'Suggestion sent to the buyer.');
      if (!error) { setSuggestingId(null); setRefresh((r) => r + 1); }
    } finally {
      setPending(false);
    }
  };

  const decide = async (sg, accept) => {
    if (role !== 'owner' || preview || pending) return;
    const lead = list.find((l) => l.id === sg.lead_id);
    setPending(true);
    setStatus('');
    try {
      if (accept && lead) {
        const patch = { ...sg.changes };
        if (patch.stage) Object.assign(patch, stageMove(patch.stage, null, units, []));
        const { error } = await supabase.from('commercial_tenant_leads').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', lead.id).eq('deal_id', deal.id);
        if (error) { setStatus('Could not apply that suggestion.'); return; }
      }
      const { error } = await supabase.from('commercial_tenant_suggestions').update({ status: accept ? 'accepted' : 'rejected', decided_at: new Date().toISOString() }).eq('id', sg.id);
      setStatus(error ? 'Could not save your answer.' : accept ? 'Suggestion accepted.' : 'Suggestion rejected.');
      setRefresh((r) => r + 1);
    } catch (e) {
      setStatus(e.message || 'Could not save your answer.');
    } finally {
      setPending(false);
    }
  };

  const changeStage = (lead, nextStage, chosenUnit) => {
    if (nextStage === 'moved_in' && !chosenUnit) {
      setMovingId(lead.id);
      setPickUnit(lead.unit_number ? String(lead.unit_number) : '');
      return;
    }
    try {
      const patch = stageMove(nextStage, chosenUnit, units, occupiedNumbers(lead.id));
      void saveLead(patch, lead.id);
    } catch (e) {
      setStatus(e.message);
    }
  };

  return (
    <div className="space-y-5">
      <Card className="!p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-xl font-semibold">Units filled vs open</h2>
          <p className="text-sm font-medium">
            <span className="text-good">{filledCount} filled</span> · <span className="text-ink-soft">{openCount} open</span> of {units} units
          </p>
        </div>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
          {range(units).map((u) => {
            const tenant = occupiedByUnit[u];
            return (
              <li
                key={u}
                className={`rounded-xl border px-3 py-2 text-sm ${
                  tenant ? 'border-good/30 bg-good/10 text-ink' : 'border-dashed border-line bg-paper text-ink-soft'
                }`}
              >
                <span className="block text-xs font-semibold">Unit {u}</span>
                <span className="block truncate text-xs">{tenant ? tenant.name : 'Open'}</span>
              </li>
            );
          })}
        </ul>
      </Card>

      {edit && (
        <Card className="!p-4">
          <CardTitle>
            Add a lead
          </CardTitle>
          <LeadForm key={formKey} disabled={pending} onSave={(v) => saveLead(v)} />
        </Card>
      )}

      <Card className="!p-4">
        <CardTitle aside={<span className="text-xs text-ink-soft">{list.length} total</span>}>Tenant pipeline</CardTitle>
        {preview && <p className="mb-3 text-xs text-ink-soft">Preview mode. Editing leads works on a real sign-in.</p>}
        {loadErr && <p role="alert" className="mb-3 text-sm text-red-700">{loadErr}</p>}
        {status && <p role="status" className="mb-3 text-sm text-ink-soft">{status}</p>}

        {leads === null ? (
          <Empty>Loading…</Empty>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {STAGES.map(([stageKey, stageLabel]) => {
              const items = list.filter((l) => l.stage === stageKey);
              return (
                <section key={stageKey} className="rounded-2xl border border-line bg-paper p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-sm font-semibold">{stageLabel}</h3>
                    <span className="rounded-full bg-white px-2 py-0.5 text-xs text-ink-soft">{items.length}</span>
                  </div>
                  {items.length === 0 ? (
                    <p className="text-xs text-ink-soft">None</p>
                  ) : (
                    <ul className="space-y-2.5">
                      {items.map((lead) => (
                        <li key={lead.id} className="space-y-2 rounded-xl border border-line bg-white p-3 text-sm">
                          {editingId === lead.id ? (
                            <LeadForm
                              initial={lead}
                              disabled={pending}
                              onSave={(v) => saveLead(v, lead.id)}
                              onCancel={() => setEditingId(null)}
                            />
                          ) : (
                            <>
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <p className="font-semibold break-words">
                                  {lead.name}
                                  {lead.unit_number ? (
                                    <span className="ml-1.5 rounded-full bg-good/10 px-2 py-0.5 text-xs font-medium text-good">
                                      Unit {lead.unit_number}
                                    </span>
                                  ) : null}
                                </p>
                                <span className="text-[11px] text-ink-soft">{roleLabel[lead.author_role] || lead.author_role}</span>
                              </div>
                              {(lead.phone || lead.email) && (
                                <p className="break-words text-xs text-ink-soft">
                                  {[lead.phone, lead.email].filter(Boolean).join(' · ')}
                                </p>
                              )}
                              {lead.notes && (
                                <p className="whitespace-pre-wrap break-words text-xs text-ink">{lead.notes}</p>
                              )}
                              {suggestions.filter((sg) => sg.lead_id === lead.id).map((sg) => (
                                <div key={sg.id} className="space-y-1 rounded-lg border border-warm/40 bg-warm-soft p-2 text-xs">
                                  <p className="font-medium">{role === 'owner' ? `${sg.author_name || 'Realtor'} suggests:` : 'Suggestion pending'}</p>
                                  <ul>{Object.entries(sg.changes || {}).map(([k, v]) => <li key={k}><span className="text-ink-soft">{FIELD_LABEL[k] || k}:</span> {shown(k, lead[k])} → <strong>{shown(k, v)}</strong></li>)}</ul>
                                  {sg.note && <p className="text-ink-soft">“{sg.note}”</p>}
                                  {role === 'owner' && !preview && (
                                    <div className="flex gap-2 pt-1">
                                      <Button type="button" className="!px-2.5 !py-1 !text-xs" disabled={pending} onClick={() => decide(sg, true)}>Accept</Button>
                                      <Button type="button" kind="secondary" className="!px-2.5 !py-1 !text-xs" disabled={pending} onClick={() => decide(sg, false)}>Reject</Button>
                                    </div>
                                  )}
                                </div>
                              ))}
                              {edit && !canChangeLead(role, lead, me?.uid) && (
                                suggestingId === lead.id
                                  ? <SuggestForm lead={lead} disabled={pending} onSend={(c, n) => suggest(lead, c, n)} onCancel={() => setSuggestingId(null)} />
                                  : <button type="button" className="text-xs underline" onClick={() => setSuggestingId(lead.id)}>Suggest change</button>
                              )}
                              {edit && canChangeLead(role, lead, me?.uid) && (
                                <div className="space-y-2 pt-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <select
                                      aria-label={`Stage for ${lead.name}`}
                                      disabled={pending}
                                      value={movingId === lead.id ? 'moved_in' : lead.stage}
                                      onChange={(e) => {
                                        if (e.target.value !== 'moved_in') setMovingId(null);
                                        changeStage(lead, e.target.value);
                                      }}
                                      className="rounded-lg border border-line bg-white px-2 py-1 text-xs"
                                    >
                                      {STAGES.map(([k, lbl]) => (
                                        <option key={k} value={k}>{lbl}</option>
                                      ))}
                                    </select>
                                    <button type="button" className="text-xs underline" onClick={() => setEditingId(lead.id)}>Edit</button>
                                    <button type="button" className="text-xs text-ink-soft underline hover:text-red-700" onClick={() => removeLead(lead)}>Delete</button>
                                  </div>
                                  {movingId === lead.id && (
                                    <div className="space-y-2 rounded-lg bg-paper p-2">
                                      <label className="block text-xs font-medium">
                                        Assign open unit
                                        <select
                                          aria-label={`Assign unit for ${lead.name}`}
                                          value={pickUnit}
                                          onChange={(e) => setPickUnit(e.target.value)}
                                          className="mt-1 block w-full rounded-lg border border-line bg-white px-2 py-1 text-xs"
                                        >
                                          <option value="">Choose a unit</option>
                                          {availableUnitsFor(lead).map((u) => (
                                            <option key={u} value={u}>Unit {u}</option>
                                          ))}
                                        </select>
                                      </label>
                                      <div className="flex gap-2">
                                        <Button type="button" className="!px-2.5 !py-1 !text-xs" disabled={!pickUnit || pending} onClick={() => changeStage(lead, 'moved_in', pickUnit)}>
                                          Assign & move in
                                        </Button>
                                        <Button type="button" kind="secondary" className="!px-2.5 !py-1 !text-xs" onClick={() => setMovingId(null)}>
                                          Cancel
                                        </Button>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </Card>

      {access.ideas && <StrategyIdeas deal={deal} me={me} role={role} preview={preview} />}
    </div>
  );
}
