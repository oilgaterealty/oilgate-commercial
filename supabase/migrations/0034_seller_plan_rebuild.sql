-- Charlotte seller page "The plan" rebuild + single-source live plan budgets ($145,850).
-- Additive and idempotent. Scoped strictly to public.commercial_* and commercial_access_private.*.
begin;

-- 1. Live step-budget derivation from commercial_settings ('deal_plan:' || slug).
create or replace function commercial_access_private.plan_step_budgets(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_raw text;
  v_plan jsonb;
  v_elem jsonb;
  v_id text;
  v_rehab numeric;
  v_units numeric := 0;
  v_near_ready numeric := 0;
  v_bigger_units numeric := 0;
  v_cost numeric;
  v_group text;
  v_label text;
  v_security numeric := 0;
  v_laundry numeric := 0;
  v_paperwork numeric := 0;
  v_eviction numeric := 0;
  v_building numeric := 0;
  v_lease_up numeric := 0;
  v_contingency numeric := 0;
  v_week1 numeric := 0;
  v_week2_onward numeric := 0;
  v_total numeric := 0;
begin
  if p_slug is null or btrim(p_slug) = '' then
    return null;
  end if;

  select s.value into v_raw
  from public.commercial_settings s
  where s.key = 'deal_plan:' || btrim(p_slug)
  limit 1;

  if v_raw is null or btrim(v_raw) = '' then
    return null;
  end if;

  begin
    v_plan := v_raw::jsonb;
  exception when others then
    return null;
  end;

  if jsonb_typeof(v_plan) <> 'object' then
    return null;
  end if;

  for v_elem in
    select value
    from jsonb_array_elements(
      case when jsonb_typeof(v_plan->'units') = 'array' then v_plan->'units' else '[]'::jsonb end
    )
  loop
    v_rehab := case
      when coalesce(v_elem->>'rehab', '') ~ '^-?\d+(\.\d+)?$' then greatest(0, (v_elem->>'rehab')::numeric)
      else 0
    end;
    v_units := v_units + v_rehab;
    v_id := btrim(coalesce(v_elem->>'id', ''));
    if v_id in ('5', '8', '1', '2') then
      v_near_ready := v_near_ready + v_rehab;
    end if;
  end loop;
  v_bigger_units := greatest(0, v_units - v_near_ready);

  for v_elem in
    select value
    from jsonb_array_elements(
      case when jsonb_typeof(v_plan->'costs') = 'array' then v_plan->'costs' else '[]'::jsonb end
    )
  loop
    v_cost := case
      when coalesce(v_elem->>'cost', '') ~ '^-?\d+(\.\d+)?$' then greatest(0, (v_elem->>'cost')::numeric)
      else 0
    end;
    if v_cost <= 0 then
      continue;
    end if;
    v_group := lower(btrim(coalesce(v_elem->>'group', '')));
    v_label := coalesce(v_elem->>'label', '');
    if v_group = 'security' or v_label ~* '(secur|lock|camera)' then
      v_security := v_security + v_cost;
    elsif v_group = 'laundry' or v_label ~* '(laundry|washer|dryer)' then
      v_laundry := v_laundry + v_cost;
    elsif v_group = 'eviction' or v_label ~* '(evict|writ|court)' then
      v_eviction := v_eviction + v_cost;
    elsif v_group in ('lease-up', 'leaseup', 'leasing') or v_label ~* '(lease[- ]?up|leasing|tenant placement|screening)' then
      v_lease_up := v_lease_up + v_cost;
    elsif v_group in ('diligence', 'permits', 'gas', 'safety') or v_label ~* '(gas|furnace|diligence|permit|zoning|registrat|title|code|violation)' then
      v_paperwork := v_paperwork + v_cost;
    else
      v_building := v_building + v_cost;
    end if;
  end loop;

  v_contingency := case
    when coalesce(v_plan->>'contingency', '') ~ '^-?\d+(\.\d+)?$' then greatest(0, (v_plan->>'contingency')::numeric)
    else 0
  end;

  v_week1 := v_security + v_near_ready + v_laundry + v_paperwork;
  v_week2_onward := v_bigger_units + v_building;
  v_total := v_units + v_security + v_laundry + v_paperwork + v_eviction + v_building + v_lease_up + v_contingency;

  return jsonb_build_object(
    'units', v_units,
    'nearReadyUnits', v_near_ready,
    'biggerUnits', v_bigger_units,
    'security', v_security,
    'laundry', v_laundry,
    'paperwork', v_paperwork,
    'safetyRecords', v_paperwork,
    'eviction', v_eviction,
    'building', v_building,
    'leaseUp', v_lease_up,
    'week1', v_week1,
    'week2Onward', v_week2_onward,
    'contingency', v_contingency,
    'total', v_total
  );
end
$$;

revoke all on function commercial_access_private.plan_step_budgets(text) from public, anon, authenticated;

-- 2. Pass live stepBudgets through get_seller_offer without leaking buyer/lender/refi fields.
create or replace function commercial_access_private.get_seller_offer(p_deal uuid)
 returns table(id uuid, name text, structure text, seller_summary jsonb, updated_at timestamp with time zone)
 language plpgsql
 stable security definer
 set search_path = ''
as $function$
declare
  r text := public.commercial_member_role(p_deal);
  v_slug text;
  v_budgets jsonb;
begin
  if r is null or r not in ('seller', 'realtor', 'owner') then
    return;
  end if;
  select d.slug into v_slug from public.commercial_deals d where d.id = p_deal;
  v_budgets := commercial_access_private.plan_step_budgets(v_slug);
  return query
    select o.id, o.name, o.structure,
      case when o.seller_summary is null then null else
        jsonb_strip_nulls(jsonb_build_object(
          'version', o.seller_summary->'version',
          'locked', o.seller_summary->'locked',
          'title', o.seller_summary->'title',
          'intro', o.seller_summary->'intro',
          'billsFromRent', case when jsonb_typeof(o.seller_summary->'billsFromRent') = 'boolean' then o.seller_summary->'billsFromRent' end,
          'renoFromSeller', case when jsonb_typeof(o.seller_summary->'renoFromSeller') = 'boolean' then o.seller_summary->'renoFromSeller' end,
          'sellerCoveredAt', o.seller_summary->'sellerCoveredAt',
          'refiLine', o.seller_summary->'refiLine',
          'terms', o.seller_summary->'terms',
          'steps', o.seller_summary->'steps',
          'stepBudgets', coalesce(v_budgets, o.seller_summary->'stepBudgets'),
          'sellerTable', (
            select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('units', t->'units', 'rentIn', t->'rentIn', 'note', t->'note', 'noteWaits', t->'noteWaits', 'bills', t->'bills', 'billsLines', t->'billsLines', 'covered', t->'covered')) order by ord)
            from jsonb_array_elements(case when jsonb_typeof(o.seller_summary->'sellerTable') = 'array' then o.seller_summary->'sellerTable' else '[]'::jsonb end) with ordinality as x(t, ord)
          )
        ))
      end,
      o.updated_at
    from public.commercial_offers o
    where o.deal_id = p_deal and o.is_lead = true
    order by o.sort, o.updated_at desc
    limit 1;
end
$function$;

-- 3. Keep get_lead_guide synced to live deal_plan total for Lender and Reviewer views.
create or replace function commercial_access_private.get_lead_guide(p_deal uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path = ''
as $function$
declare
  r text := public.commercial_member_role(p_deal);
  g jsonb;
  v_slug text;
  v_budgets jsonb;
  v_total numeric;
  v_cont numeric;
  v_rehab_sub numeric;
  v_units_amt numeric;
  v_bldg_amt numeric;
  v_setup_amt numeric;
  v_heading text;
  v_old_total numeric;
  v_lines jsonb;
  v_cs jsonb;
begin
  if r is null or r not in ('owner','lender','reviewer') then return null; end if;
  select o.seller_summary->'guide' into g from public.commercial_offers o
   where o.deal_id = p_deal and o.is_lead = true
     and (r = 'owner' or (r = 'reviewer' and o.share_reviewer) or (r = 'lender' and o.share_lender))
   order by o.sort, o.updated_at desc limit 1;
  if g is null then return null; end if;

  select d.slug into v_slug from public.commercial_deals d where d.id = p_deal;
  v_budgets := commercial_access_private.plan_step_budgets(v_slug);
  if v_budgets is not null and coalesce(v_budgets->>'total', '') ~ '^-?\d+(\.\d+)?$' then
    v_total := (v_budgets->>'total')::numeric;
    if v_total > 0 then
      v_cont := (v_budgets->>'contingency')::numeric;
      v_rehab_sub := greatest(0, v_total - v_cont);
      v_units_amt := (v_budgets->>'units')::numeric;
      v_bldg_amt := (v_budgets->>'building')::numeric;
      v_setup_amt := greatest(0, v_rehab_sub - v_units_amt - v_bldg_amt);
      v_heading := 'Repair budget $' || to_char(round(v_total), 'FM999,999,999');
      v_old_total := case
        when coalesce(g->'costSummary'->>'total', '') ~ '^-?\d+(\.\d+)?$' then (g->'costSummary'->>'total')::numeric
        else null
      end;

      v_cs := coalesce(g->'costSummary', '{}'::jsonb) || jsonb_build_object(
        'total', v_total,
        'rehabTotal', v_rehab_sub,
        'contingency', v_cont,
        'heading', v_heading,
        'stepBudgets', v_budgets
      );

      if v_old_total is distinct from v_total then
        v_lines := '[]'::jsonb;
        if v_units_amt > 0 then
          v_lines := v_lines || jsonb_build_array(jsonb_build_object('key', 'units', 'label', 'Units $' || to_char(round(v_units_amt), 'FM999,999,999'), 'detail', '', 'overlay', jsonb_build_array('Total units: $' || to_char(round(v_units_amt), 'FM999,999,999') || '.')));
        end if;
        if v_bldg_amt > 0 then
          v_lines := v_lines || jsonb_build_array(jsonb_build_object('key', 'building', 'label', 'Building $' || to_char(round(v_bldg_amt), 'FM999,999,999'), 'detail', '', 'overlay', jsonb_build_array('Total building: $' || to_char(round(v_bldg_amt), 'FM999,999,999') || '.')));
        end if;
        if v_setup_amt > 0 then
          v_lines := v_lines || jsonb_build_array(jsonb_build_object('key', 'setup', 'label', 'Setup $' || to_char(round(v_setup_amt), 'FM999,999,999'), 'detail', '', 'overlay', jsonb_build_array('Total setup: $' || to_char(round(v_setup_amt), 'FM999,999,999') || '.')));
        end if;
        if v_cont > 0 then
          v_lines := v_lines || jsonb_build_array(jsonb_build_object('key', 'contingency', 'label', 'Contingency $' || to_char(round(v_cont), 'FM999,999,999'), 'detail', '', 'overlay', jsonb_build_array('Repair contingency: $' || to_char(round(v_cont), 'FM999,999,999') || '.')));
        end if;
        v_cs := v_cs || jsonb_build_object('lines', v_lines);
        g := jsonb_set(g, '{cost}', v_lines, true);
      end if;

      g := jsonb_set(g, '{costSummary}', v_cs, true);
      g := jsonb_set(g, '{costHeading}', to_jsonb(v_heading), true);
      if jsonb_typeof(g->'bridge') = 'object' then
        g := jsonb_set(g, '{bridge,repairs}', to_jsonb(v_total), true);
      end if;
      if jsonb_typeof(g->'rentValue') = 'object' then
        g := jsonb_set(g, '{rentValue,repairs}', to_jsonb(v_total), true);
      end if;
    end if;
  end if;

  if r = 'reviewer' and g is not null then g := g #- '{rentValue,marketRange}'; end if;
  return g;
end
$function$;

-- 4. Seed Charlotte owner-approved 7-step plan and sync commercial_models / commercial_offers.
do $$
declare
  v_deal_id uuid;
  v_steps jsonb;
  v_budgets jsonb;
  v_total numeric;
  v_cont numeric;
  v_rehab_sub numeric;
  v_heading text;
  v_exec jsonb;
  v_clean_exec jsonb := '{}'::jsonb;
  v_k text;
  v_v text;
begin
  select d.id, d.seller_content->'execution'
  into v_deal_id, v_exec
  from public.commercial_deals d
  where d.slug = 'charlotte';

  if v_deal_id is null then
    return;
  end if;

  v_steps := jsonb_build_array(
    jsonb_build_object(
      'key', 'week1_secure_and_start',
      'week', 'Week 1',
      'title', 'Secure the building first',
      'budgetKey', 'week1',
      'items', jsonb_build_array(
        jsonb_build_object('text', 'Doors, locks, cameras', 'budgetKey', 'security'),
        jsonb_build_object('text', 'Same week: start the near-ready units 5, 8, 1, 2', 'budgetKey', 'nearReadyUnits'),
        jsonb_build_object('text', 'Get laundry running: at least one stacked set taking coins, tap/card and bills', 'budgetKey', 'laundry'),
        jsonb_build_object('text', 'Paperwork runs alongside, never blocks work: gas check and furnace service, code violation, title, rental registration, $50 zoning letter', 'budgetKey', 'paperwork')
      )
    ),
    jsonb_build_object(
      'key', 'week2_first_tenant',
      'week', 'Week 2',
      'title', 'First tenant moves in',
      'detail', 'Week 3 is the hard deadline. Start the bigger units.'
    ),
    jsonb_build_object(
      'key', 'weeks2_3_empty_units',
      'week', 'Weeks 2-3',
      'title', 'Units 3 and 9 empty',
      'detail', 'Unit 9 moves out; Unit 3 handled the legal way after closing (we handle it, not the seller), done by week 3.',
      'budgetKey', 'eviction'
    ),
    jsonb_build_object(
      'key', 'weeks2_onward_bigger_units',
      'week', 'Weeks 2 onward',
      'title', 'Bigger units, then building systems',
      'budgetKey', 'week2Onward',
      'items', jsonb_build_array(
        jsonb_build_object('text', 'Bigger units 7, 6, 3, 10, then 4 (full gut)', 'budgetKey', 'biggerUnits'),
        jsonb_build_object('text', 'Plumbing, heat, electric and exterior', 'budgetKey', 'building')
      )
    ),
    jsonb_build_object(
      'key', 'as_each_unit_finishes',
      'week', 'As each unit finishes',
      'title', 'Inspect, lease and collect rent',
      'detail', 'Inspected, leased to screened long-term tenants, rent collected.',
      'budgetKey', 'leaseUp'
    ),
    jsonb_build_object(
      'key', 'within_1_year_payoff',
      'week', 'Within the 1-year renovation loan',
      'title', 'Your renovation loan is paid off in full.'
    ),
    jsonb_build_object(
      'key', 'updates_on_this_page',
      'week', 'Along the way',
      'title', 'Updates on this page',
      'detail', 'Rents, leases, repair photos.'
    )
  );

  if jsonb_typeof(v_exec) = 'object' then
    for v_k, v_v in select key, value from jsonb_each_text(v_exec)
    loop
      if v_v !~* '(weeks?\s*0\s*(to|-|–)\s*3|weeks?\s*4\s*(to|-|–)\s*20|safety first|refinanc)' then
        v_clean_exec := v_clean_exec || jsonb_build_object(v_k, v_v);
      end if;
    end loop;
  end if;

  update public.commercial_deals
  set seller_content = jsonb_set(
    jsonb_set(coalesce(seller_content, '{}'::jsonb), '{execution_steps}', v_steps, true),
    '{execution}',
    v_clean_exec,
    true
  )
  where id = v_deal_id;

  v_budgets := commercial_access_private.plan_step_budgets('charlotte');
  if v_budgets is not null and coalesce(v_budgets->>'total', '') ~ '^-?\d+(\.\d+)?$' then
    v_total := (v_budgets->>'total')::numeric;
    if v_total > 0 then
      v_cont := (v_budgets->>'contingency')::numeric;
      v_rehab_sub := greatest(0, v_total - v_cont);
      v_heading := 'Repair budget $' || to_char(round(v_total), 'FM999,999,999');

      update public.commercial_models
      set base = (coalesce(base, '{}'::jsonb) - 'bridgeRepairs') || jsonb_build_object('rehab', v_total),
          updated_at = now()
      where deal_id = v_deal_id;

      declare
        v_units_amt numeric := (v_budgets->>'units')::numeric;
        v_bldg_amt numeric := (v_budgets->>'building')::numeric;
        v_setup_amt numeric := greatest(0, v_rehab_sub - v_units_amt - v_bldg_amt);
        v_lines jsonb := '[]'::jsonb;
      begin
        if v_units_amt > 0 then
          v_lines := v_lines || jsonb_build_array(jsonb_build_object('key', 'units', 'label', 'Units $' || to_char(round(v_units_amt), 'FM999,999,999'), 'detail', '', 'overlay', jsonb_build_array('Total units: $' || to_char(round(v_units_amt), 'FM999,999,999') || '.')));
        end if;
        if v_bldg_amt > 0 then
          v_lines := v_lines || jsonb_build_array(jsonb_build_object('key', 'building', 'label', 'Building $' || to_char(round(v_bldg_amt), 'FM999,999,999'), 'detail', '', 'overlay', jsonb_build_array('Total building: $' || to_char(round(v_bldg_amt), 'FM999,999,999') || '.')));
        end if;
        if v_setup_amt > 0 then
          v_lines := v_lines || jsonb_build_array(jsonb_build_object('key', 'setup', 'label', 'Setup $' || to_char(round(v_setup_amt), 'FM999,999,999'), 'detail', '', 'overlay', jsonb_build_array('Total setup: $' || to_char(round(v_setup_amt), 'FM999,999,999') || '.')));
        end if;
        if v_cont > 0 then
          v_lines := v_lines || jsonb_build_array(jsonb_build_object('key', 'contingency', 'label', 'Contingency $' || to_char(round(v_cont), 'FM999,999,999'), 'detail', '', 'overlay', jsonb_build_array('Repair contingency: $' || to_char(round(v_cont), 'FM999,999,999') || '.')));
        end if;

        update public.commercial_offers
        set seller_summary = jsonb_set(
          jsonb_set(
            jsonb_set(
              case
                when jsonb_typeof(seller_summary->'guide') = 'object' then
                  jsonb_set(
                    jsonb_set(
                      jsonb_set(
                        jsonb_set(
                          case
                            when jsonb_typeof(seller_summary->'guide'->'rentValue') = 'object' then
                              jsonb_set(seller_summary, '{guide,rentValue,repairs}', to_jsonb(v_total), true)
                            else seller_summary
                          end,
                          '{guide,costSummary}',
                          coalesce(seller_summary->'guide'->'costSummary', '{}'::jsonb) || jsonb_build_object(
                            'total', v_total,
                            'rehabTotal', v_rehab_sub,
                            'contingency', v_cont,
                            'heading', v_heading,
                            'lines', v_lines,
                            'stepBudgets', v_budgets
                          ),
                          true
                        ),
                        '{guide,cost}',
                        v_lines,
                        true
                      ),
                      '{guide,costHeading}',
                      to_jsonb(v_heading),
                      true
                    ),
                    '{guide,bridge,repairs}',
                    to_jsonb(v_total),
                    true
                  )
                else seller_summary
              end,
              '{stepBudgets}',
              v_budgets,
              true
            ),
            '{intro}',
            to_jsonb(regexp_replace(coalesce(seller_summary->>'intro', ''), '\yrefinance\y', 'payoff', 'gi')),
            true
          ),
          '{refiLine}',
          to_jsonb(regexp_replace(coalesce(seller_summary->>'refiLine', ''), '\yrefinances?\y', 'pays off in full', 'gi')),
          true
        ),
        updated_at = now()
        where deal_id = v_deal_id
          and is_lead = true
          and seller_summary is not null;
      end;
    end if;
  end if;
end
$$;

notify pgrst, 'reload schema';
commit;
