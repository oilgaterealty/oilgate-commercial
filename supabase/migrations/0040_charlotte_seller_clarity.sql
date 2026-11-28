-- 2026-11-28 Charlotte Seller Page Clarity:
-- 1. Move Unit 3 removal ($2,750 eviction budget) into Week 1 (week1 stepBudget) without double-counting total or Weeks 2-3.
-- 2. Add plan_paperwork_items(slug) and pass paperworkItems through get_seller_offer & get_lead_guide.
-- 3. Add Week 1 Unit 3 & Unit 10 items + clean Paperwork & permits label on charlotte execution_steps.
-- 4. Rebuild Charlotte lead offer seller_summary with 6 even offer tiles, real $/mo building bills, merged coverage overlay, and plain wording.
begin;

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

  v_week1 := v_security + v_near_ready + v_laundry + v_paperwork + v_eviction;
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

create or replace function commercial_access_private.plan_paperwork_items(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_raw text;
  v_plan jsonb;
  v_item jsonb;
  v_group text;
  v_label text;
  v_cost numeric;
  v_source text;
  v_out jsonb := '[]'::jsonb;
begin
  if p_slug is null or btrim(p_slug) = '' then
    return '[]'::jsonb;
  end if;
  select s.value into v_raw
  from public.commercial_settings s
  where s.key = 'deal_plan:' || btrim(p_slug)
  limit 1;
  if v_raw is null or btrim(v_raw) = '' then
    return '[]'::jsonb;
  end if;
  begin
    v_plan := v_raw::jsonb;
  exception when others then
    return '[]'::jsonb;
  end;
  if jsonb_typeof(v_plan) <> 'object' or jsonb_typeof(v_plan->'costs') <> 'array' then
    return '[]'::jsonb;
  end if;

  for v_item in select value from jsonb_array_elements(v_plan->'costs') loop
    v_cost := greatest(0, coalesce((v_item->>'cost')::numeric, 0));
    if v_cost <= 0 then
      continue;
    end if;
    v_group := lower(btrim(coalesce(v_item->>'group', '')));
    v_label := coalesce(v_item->>'label', '');
    if v_group = 'security' or v_label ~* '(secur|lock|camera)' then
      continue;
    elsif v_group = 'laundry' or v_label ~* '(laundry|washer|dryer)' then
      continue;
    elsif v_group = 'eviction' or v_label ~* '(evict|writ|court)' then
      continue;
    elsif v_group in ('lease-up', 'leaseup', 'leasing') or v_label ~* '(lease[- ]?up|leasing|tenant placement|screening)' then
      continue;
    elsif v_group in ('diligence', 'permits', 'gas', 'safety') or v_label ~* '(gas|furnace|diligence|permit|zoning|registrat|title|code|violation)' then
      v_source := nullif(btrim(coalesce(v_item->>'source', '')), '');
      v_out := v_out || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'label', v_label,
        'cost', v_cost,
        'source', v_source
      )));
    end if;
  end loop;

  return v_out;
end
$$;

revoke all on function commercial_access_private.plan_paperwork_items(text) from public, anon, authenticated;

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
  v_laundry_items jsonb;
  v_paperwork_items jsonb;
begin
  if r is null or r not in ('seller', 'realtor', 'owner') then
    return;
  end if;
  select d.slug into v_slug from public.commercial_deals d where d.id = p_deal;
  v_budgets := commercial_access_private.plan_step_budgets(v_slug);
  v_laundry_items := commercial_access_private.plan_laundry_items(v_slug);
  v_paperwork_items := commercial_access_private.plan_paperwork_items(v_slug);
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
          'laundryItems', case
            when jsonb_typeof(v_laundry_items) = 'array' and jsonb_array_length(v_laundry_items) > 0 then v_laundry_items
            else o.seller_summary->'laundryItems'
          end,
          'paperworkItems', case
            when jsonb_typeof(v_paperwork_items) = 'array' and jsonb_array_length(v_paperwork_items) > 0 then v_paperwork_items
            else o.seller_summary->'paperworkItems'
          end,
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

do $$
declare
  v_deal_id uuid;
  v_content jsonb;
  v_old_steps jsonb;
  v_step jsonb;
  v_new_steps jsonb := '[]'::jsonb;
  v_budgets jsonb;
  v_laundry_items jsonb;
  v_paperwork_items jsonb;
  v_base jsonb := '{}'::jsonb;
  v_offer record;
  v_inputs jsonb;
  v_ss jsonb;
  v_rf jsonb;
  v_guide jsonb;
  v_cs jsonb;
  v_note_principal numeric;
  v_note_rate numeric;
  v_note_years numeric;
  v_note_pay numeric;
  v_reno_rate numeric;
  v_reno_from_seller boolean;
  v_bills_from_rent boolean;
  v_covered_at int;
  v_total_budget numeric;
  v_cont numeric;
  v_rehab_sub numeric;
  v_closing numeric;
  v_reno_amt numeric;
  v_reno_pay numeric;
  v_full_pay numeric;
  v_deferred numeric;
  v_seller_payoff numeric;
  v_total_payback numeric;
  v_taxes_mo numeric;
  v_ins_mo numeric;
  v_water_mo numeric;
  v_bills_mo numeric;
  v_empty_util_mo numeric;
  v_terms jsonb;
  v_steps jsonb;
  v_pay_lines jsonb;
  v_payoff_lines jsonb;
  v_reno_overlay jsonb;
  v_bills_overlay jsonb;
  v_purchase_terms_line text;
  v_full_at text;
begin
  select d.id, coalesce(d.seller_content, '{}'::jsonb)
  into v_deal_id, v_content
  from public.commercial_deals d
  where d.slug = 'charlotte'
  limit 1;

  if v_deal_id is null then
    return;
  end if;

  v_budgets := commercial_access_private.plan_step_budgets('charlotte');
  v_laundry_items := commercial_access_private.plan_laundry_items('charlotte');
  v_paperwork_items := commercial_access_private.plan_paperwork_items('charlotte');

  v_old_steps := case when jsonb_typeof(v_content->'execution_steps') = 'array' then v_content->'execution_steps' else '[]'::jsonb end;
  for v_step in select value from jsonb_array_elements(v_old_steps) loop
    if coalesce(v_step->>'key', '') = 'week1_secure_and_start' then
      v_step := jsonb_build_object(
        'key', 'week1_secure_and_start',
        'week', 'Week 1',
        'title', coalesce(nullif(v_step->>'title', ''), 'Secure, start near-ready units & launch laundry'),
        'budgetKey', 'week1',
        'items', jsonb_build_array(
          jsonb_build_object('text', 'Doors, locks, cameras', 'budgetKey', 'security'),
          jsonb_build_object('text', 'Start the near-ready units 5, 8, 1, 2', 'budgetKey', 'nearReadyUnits'),
          jsonb_build_object('text', 'Get laundry running: 2 stacked sets taking coins, tap/card and bills', 'budgetKey', 'laundry'),
          jsonb_build_object('text', 'Paperwork & permits', 'budgetKey', 'paperwork'),
          jsonb_build_object('text', 'Unit 3: cash for keys or court removal', 'budgetKey', 'eviction'),
          jsonb_build_object(
            'text', 'Unit 10: confirm the tenant’s status; start removal only if needed.',
            'showZero', true,
            'zeroText', '$0 unless needed',
            'overlay', jsonb_build_array('Occupancy and lease status are verified in Week 1. No eviction cost is incurred unless formal removal is required.')
          )
        )
      );
    elsif coalesce(v_step->>'key', '') in ('weeks2_3_empty_and_first', 'weeks2_3_empty_units') then
      v_step := (v_step - 'budgetKey') || jsonb_build_object(
        'detail', 'First tenant in Week 2 (Week 3 hard deadline). Unit 9 moves out; Unit 3 removal begun in Week 1 wraps up by Week 3.'
      );
    end if;
    v_new_steps := v_new_steps || jsonb_build_array(v_step);
  end loop;

  if jsonb_array_length(v_new_steps) > 0 then
    update public.commercial_deals
    set seller_content = jsonb_set(v_content, '{execution_steps}', v_new_steps, true),
        updated_at = now()
    where id = v_deal_id;
  end if;

  select coalesce(m.base, '{}'::jsonb) into v_base from public.commercial_models m where m.deal_id = v_deal_id limit 1;
  v_taxes_mo := round(coalesce((v_base->>'taxes')::numeric, 13544) / 12.0);
  v_ins_mo := round(coalesce((v_base->>'insurance')::numeric, 6500) / 12.0);
  v_water_mo := round(coalesce((v_base->>'waterMo')::numeric, 1000));
  v_bills_mo := v_taxes_mo + v_ins_mo + v_water_mo;
  v_empty_util_mo := round(coalesce((v_base->>'emptyUnitUtilMo')::numeric, 0));

  for v_offer in
    select o.id, o.inputs, o.seller_summary
    from public.commercial_offers o
    where o.deal_id = v_deal_id and o.is_lead = true
  loop
    v_ss := coalesce(v_offer.seller_summary, '{}'::jsonb);
    v_inputs := coalesce(v_offer.inputs, '{}'::jsonb);
    v_guide := case when jsonb_typeof(v_ss->'guide') = 'object' then v_ss->'guide' else null end;
    v_rf := case when v_guide is not null and jsonb_typeof(v_guide->'refi') = 'object' then v_guide->'refi' else '{}'::jsonb end;

    v_note_principal := coalesce((v_inputs->>'note')::numeric, (v_rf->>'sellerNotePrincipal')::numeric, 275000);
    v_note_rate := coalesce((v_inputs->>'rate')::numeric, 0);
    v_note_years := coalesce((v_inputs->>'amortYears')::numeric, 0);
    v_reno_rate := coalesce((v_inputs->>'renoRate')::numeric, (v_rf->>'renoRate')::numeric, 8);
    v_reno_from_seller := coalesce((v_inputs->>'renoFromSeller')::boolean, (v_ss->>'renoFromSeller')::boolean, true);
    v_bills_from_rent := coalesce((v_inputs->>'billsFromRent')::boolean, (v_ss->>'billsFromRent')::boolean, true);
    v_covered_at := (v_ss->>'sellerCoveredAt')::int;

    v_total_budget := coalesce((v_budgets->>'total')::numeric, 145940);
    v_cont := coalesce((v_budgets->>'contingency')::numeric, 20000);
    v_rehab_sub := greatest(0, v_total_budget - v_cont);
    v_closing := coalesce((v_inputs->>'closing')::numeric, (v_rf->>'closingInLoan')::numeric, 5500);
    v_reno_amt := round(coalesce((v_rf->>'renoNotePrincipal')::numeric, v_rehab_sub + v_closing));
    v_reno_pay := case when v_reno_from_seller then round(v_reno_amt * (v_reno_rate / 100.0) / 12.0) else 0 end;

    if v_note_rate > 0 and v_note_years > 0 then
      v_note_pay := round((v_note_principal * ((v_note_rate / 100.0) / 12.0) * power(1 + ((v_note_rate / 100.0) / 12.0), v_note_years * 12)) / (power(1 + ((v_note_rate / 100.0) / 12.0), v_note_years * 12) - 1));
    elsif v_note_rate > 0 then
      v_note_pay := round(v_note_principal * (v_note_rate / 100.0) / 12.0);
    else
      v_note_pay := greatest(0, round(coalesce((v_ss->'sellerTable'->-1->>'note')::numeric, 1857 + v_reno_pay) - v_reno_pay));
    end if;

    v_full_pay := v_note_pay + v_reno_pay;
    v_deferred := round(coalesce((v_rf->>'sellerCarriedBills')::numeric, 0));
    v_seller_payoff := round(coalesce((v_rf->>'sellerPayoff')::numeric, v_note_principal + v_deferred));
    v_total_payback := v_seller_payoff + case when v_reno_from_seller then v_reno_amt else 0 end;
    v_full_at := case when v_covered_at is not null then 'once ' || v_covered_at || ' units are rented' else 'once enough units are rented' end;

    v_purchase_terms_line := case
      when v_note_rate > 0 and v_note_years > 0 then 'Purchase note: ' || v_note_rate || '% a year, ' || v_note_years || '-year schedule (' || commercial_access_private.fmt_money(v_note_pay) || '/mo).'
      when v_note_rate > 0 then 'Purchase note: ' || v_note_rate || '% a year (' || commercial_access_private.fmt_money(v_note_pay) || '/mo).'
      else null
    end;

    v_reno_overlay := jsonb_strip_nulls(jsonb_build_object(
      'a', case when v_rehab_sub > 0 then 'Planned repairs & permits: ' || commercial_access_private.fmt_money(v_rehab_sub) end,
      'b', case when v_closing > 0 then 'Closing costs rolled into note: ' || commercial_access_private.fmt_money(v_closing) end,
      'c', case when v_cont > 0 then 'Contingency (' || commercial_access_private.fmt_money(v_cont) || ', bringing total repair budget to ' || commercial_access_private.fmt_money(v_total_budget) || '): only added to the renovation note if actually used.' end,
      'd', 'Second seller note funding the work and closing costs. Paid from rent as units fill, then paid back in full.'
    ));
    v_reno_overlay := (select coalesce(jsonb_agg(val), '[]'::jsonb) from jsonb_each_text(v_reno_overlay) as e(k, val));

    v_bills_overlay := jsonb_build_array(
      'Property tax: ' || commercial_access_private.fmt_money(v_taxes_mo) || '/mo',
      'Insurance: ' || commercial_access_private.fmt_money(v_ins_mo) || '/mo',
      'Water & trash: ' || commercial_access_private.fmt_money(v_water_mo) || '/mo'
    );
    if v_empty_util_mo > 0 then
      v_bills_overlay := v_bills_overlay || jsonb_build_array('Plus ' || commercial_access_private.fmt_money(v_empty_util_mo) || '/mo per empty unit for utilities while units fill.');
    end if;
    if v_bills_from_rent then
      v_bills_overlay := v_bills_overlay || jsonb_build_array('Rent pays these building bills before your monthly payment. Any unpaid part while units fill is added to what you are paid back at the end.');
    else
      v_bills_overlay := v_bills_overlay || jsonb_build_array('Paid directly by the buyer, separate from your note payment.');
    end if;

    v_pay_lines := jsonb_build_array(
      case when v_covered_at is not null then 'Covers your full payment once ' || v_covered_at || ' units are rented.' else 'Payments start as units are rented and grow with each unit.' end,
      'Purchase note: ' || commercial_access_private.fmt_money(v_note_pay) || '/mo',
      'Renovation note: ' || commercial_access_private.fmt_money(v_reno_pay) || '/mo',
      'Combined payment when all 10 are rented: ' || commercial_access_private.fmt_money(v_full_pay) || '/mo.',
      case when v_bills_from_rent
        then 'Rent pays the building bills first, then you. Any unpaid part while units fill is added to what you are paid back.'
        else 'Rent pays your notes first. Any unpaid part while units fill is added to what you are paid back.'
      end
    );

    v_payoff_lines := jsonb_build_array(
      'Purchase note: ' || commercial_access_private.fmt_money(v_note_principal),
      'Renovation note: ' || commercial_access_private.fmt_money(v_reno_amt)
    );
    if v_deferred > 0 then
      v_payoff_lines := v_payoff_lines || jsonb_build_array('Unpaid bills & payments while units fill: ' || commercial_access_private.fmt_money(v_deferred));
    end if;
    v_payoff_lines := v_payoff_lines || jsonb_build_array('Total paid back when all 10 units are rented: ' || commercial_access_private.fmt_money(v_total_payback) || ', on top of your payments from rent.');

    if v_reno_from_seller then
      v_terms := jsonb_build_array(
        jsonb_build_object(
          'label', 'Purchase note',
          'value', commercial_access_private.fmt_money(v_note_principal),
          'overlay', jsonb_build_array('Seller financing. You deed the building to the buyer at closing.') ||
            case when v_purchase_terms_line is not null then jsonb_build_array(v_purchase_terms_line) else '[]'::jsonb end ||
            jsonb_build_array('Paid from rent as units are rented, then paid back in full.')
        ),
        jsonb_build_object(
          'label', 'Renovation note',
          'value', commercial_access_private.fmt_money(v_reno_amt),
          'overlay', v_reno_overlay
        ),
        jsonb_build_object(
          'label', 'Rate',
          'value', v_reno_rate || '% a year',
          'overlay', jsonb_build_array('Renovation note: ' || v_reno_rate || '% a year (' || commercial_access_private.fmt_money(v_reno_pay) || '/mo at ' || commercial_access_private.fmt_money(v_reno_amt) || ').') ||
            case when v_purchase_terms_line is not null then jsonb_build_array(v_purchase_terms_line) else '[]'::jsonb end
        ),
        jsonb_build_object(
          'label', 'Your monthly payment',
          'value', commercial_access_private.fmt_money(v_full_pay) || '/mo when all 10 are rented',
          'overlay', v_pay_lines
        ),
        jsonb_build_object(
          'label', case when v_bills_from_rent then 'Building bills paid first' else 'Building bills' end,
          'value', commercial_access_private.fmt_money(v_bills_mo) || '/mo',
          'overlay', v_bills_overlay
        ),
        jsonb_build_object(
          'label', 'Paid back in full',
          'value', commercial_access_private.fmt_money(v_total_payback),
          'overlay', v_payoff_lines
        )
      );

      v_steps := jsonb_build_array(
        jsonb_build_object(
          'title', 'Seller financing',
          'detail', 'At closing you deed the building to the buyer. Your purchase note is ' || commercial_access_private.fmt_money(v_note_principal) || '. You can review or adjust this figure before signing. The buyer takes over the leasing and the repairs.',
          'overlay', '[]'::jsonb
        ),
        jsonb_build_object(
          'title', 'Repairs',
          'detail', 'You fund the repairs with a second seller note, ' || commercial_access_private.fmt_money(v_reno_amt) || ', at ' || v_reno_rate || '% a year' || case when v_cont > 0 then ' (' || commercial_access_private.fmt_money(v_cont) || ' contingency only added if used)' else '' end || '. The buyer manages all work.',
          'overlay', v_reno_overlay
        ),
        jsonb_build_object(
          'title', 'Paid as units are rented',
          'detail', case when v_bills_from_rent
            then 'Your payments start as units are rented and grow with each one. Rent pays property tax, insurance, water and trash first, then you. ' || upper(left(v_full_at, 1)) || substr(v_full_at, 2) || ' you receive the full ' || commercial_access_private.fmt_money(v_full_pay) || ' a month: ' || commercial_access_private.fmt_money(v_note_pay) || ' on the purchase note and ' || commercial_access_private.fmt_money(v_reno_pay) || ' on the renovation note. Any unpaid part before then is added to your payoff.'
            else 'Your payments start as units are rented and grow with each one. ' || upper(left(v_full_at, 1)) || substr(v_full_at, 2) || ' you receive the full ' || commercial_access_private.fmt_money(v_full_pay) || ' a month: ' || commercial_access_private.fmt_money(v_note_pay) || ' on the purchase note and ' || commercial_access_private.fmt_money(v_reno_pay) || ' on the renovation note. Any unpaid part before then is added to your payoff. The buyer pays the taxes, insurance, water and trash.'
          end,
          'overlay', v_pay_lines
        ),
        jsonb_build_object(
          'title', 'Paid back in full',
          'detail', 'You are paid back in full, ' || commercial_access_private.fmt_money(v_total_payback) || ', on top of your monthly payments from rent.',
          'overlay', v_payoff_lines
        )
      );

      v_ss := v_ss || jsonb_build_object(
        'intro', case when v_bills_from_rent
          then 'Seller financing with two seller notes: the purchase note and a renovation note for the repairs. Rent pays the building bills first, then both notes. Any unpaid part while units fill is added to your payoff.'
          else 'Seller financing with two seller notes: the purchase note and a renovation note for the repairs. Rent pays both notes. Any unpaid part while units fill is added to your payoff.'
        end,
        'refiLine', 'Your monthly payments grow as units are rented to ' || commercial_access_private.fmt_money(v_full_pay) || '/mo when all 10 are rented, then you are paid back in full: ' || commercial_access_private.fmt_money(v_total_payback) || '.',
        'terms', v_terms,
        'steps', v_steps,
        'stepBudgets', v_budgets,
        'laundryItems', v_laundry_items,
        'paperworkItems', v_paperwork_items
      );
    else
      v_ss := v_ss || jsonb_build_object(
        'stepBudgets', v_budgets,
        'laundryItems', v_laundry_items,
        'paperworkItems', v_paperwork_items
      );
    end if;

    if v_guide is not null then
      v_cs := coalesce(v_guide->'costSummary', '{}'::jsonb) || jsonb_build_object(
        'stepBudgets', v_budgets,
        'laundryItems', v_laundry_items,
        'paperworkItems', v_paperwork_items
      );
      v_guide := jsonb_set(v_guide, '{costSummary}', v_cs, true);
      v_ss := jsonb_set(v_ss, '{guide}', v_guide, true);
    end if;

    update public.commercial_offers
    set seller_summary = v_ss,
        updated_at = now()
    where id = v_offer.id;
  end loop;
end $$;

commit;
