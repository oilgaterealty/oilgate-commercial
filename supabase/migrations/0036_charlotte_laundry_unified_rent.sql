-- Charlotte 2-stack Speed Queen laundry build ($16,390; total budget $142,440),
-- laundry operating income engine, flat $1,200/yr management help, unified $1,000/unit rent,
-- and regenerated lead seller_summary + seller execution step wording.
-- Additive and idempotent. Scoped strictly to public.commercial_* and commercial_access_private.*.
begin;

-- 1. Read laundry config & individual laundry budget items from deal_plan:<slug>.
create or replace function commercial_access_private.plan_laundry(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_raw text;
  v_plan jsonb;
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
  if jsonb_typeof(v_plan) <> 'object' or jsonb_typeof(v_plan->'laundry') <> 'object' then
    return null;
  end if;
  return v_plan->'laundry';
end
$$;

create or replace function commercial_access_private.plan_laundry_items(p_slug text)
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
    v_group := lower(coalesce(v_item->>'group', ''));
    v_label := coalesce(v_item->>'label', '');
    if v_group = 'laundry' or v_label ~* '(laundry|washer|dryer)' then
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

revoke all on function commercial_access_private.plan_laundry(text) from public, anon, authenticated;
revoke all on function commercial_access_private.plan_laundry_items(text) from public, anon, authenticated;

-- 2. Pass live stepBudgets + laundry budget items through get_seller_offer without leaking income/opex/refi fields.
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
begin
  if r is null or r not in ('seller', 'realtor', 'owner') then
    return;
  end if;
  select d.slug into v_slug from public.commercial_deals d where d.id = p_deal;
  v_budgets := commercial_access_private.plan_step_budgets(v_slug);
  v_laundry_items := commercial_access_private.plan_laundry_items(v_slug);
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

-- 3. Replace compute_opex_view to support flat mgmtHelpAnnual and Part B laundry income/costs.
drop function if exists commercial_access_private.compute_opex_view(jsonb, numeric, numeric, numeric, boolean, numeric);

create or replace function commercial_access_private.compute_opex_view(
  p_opex jsonb,
  p_units numeric,
  p_rented numeric,
  p_gross_mo numeric,
  p_apply_vacancy boolean,
  p_cap_rate numeric,
  p_laundry jsonb default null
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_units numeric := greatest(0, coalesce(p_units, 10));
  v_rented numeric := greatest(0, least(greatest(0, coalesce(p_units, 10)), coalesce(p_rented, p_units)));
  v_gross_mo numeric := greatest(0, coalesce(p_gross_mo, 0));
  v_gross_yr numeric := v_gross_mo * 12.0;
  v_vac_pct numeric := greatest(0, coalesce((p_opex->>'vacancyPct')::numeric, 0));
  v_vac_yr numeric := case when coalesce(p_apply_vacancy, true) then v_gross_yr * (v_vac_pct / 100.0) else 0 end;
  v_eff_yr numeric := v_gross_yr - v_vac_yr;
  v_eff_mo numeric := v_eff_yr / 12.0;

  v_taxes numeric := greatest(0, coalesce((p_opex->>'taxesAnnual')::numeric, 0));
  v_ins numeric := greatest(0, coalesce((p_opex->>'insuranceAnnual')::numeric, 0));
  v_water numeric := greatest(0, coalesce((p_opex->>'waterSewerTrashAnnual')::numeric, 0));
  v_heat numeric := greatest(0, coalesce((p_opex->>'heatGasAnnual')::numeric, 0));
  v_res_unit numeric := greatest(0, coalesce((p_opex->>'reservesPerUnitAnnual')::numeric, 0));
  v_res_yr numeric := v_rented * v_res_unit;
  v_rm_pct numeric := greatest(0, coalesce((p_opex->>'repairsMaintPct')::numeric, 0));
  v_rm_yr numeric := v_gross_yr * (v_rm_pct / 100.0);
  v_mgmt_flat numeric := greatest(0, coalesce((p_opex->>'mgmtHelpAnnual')::numeric, 0));
  v_mgmt_pct numeric := greatest(0, coalesce((p_opex->>'mgmtHelpPct')::numeric, 0));
  v_mgmt_yr numeric := case when v_mgmt_flat > 0 then v_mgmt_flat else v_gross_yr * (v_mgmt_pct / 100.0) end;
  v_wifi numeric := greatest(0, coalesce((p_opex->>'wifiAnnual')::numeric, 0));
  v_cam numeric := greatest(0, coalesce((p_opex->>'camerasAnnual')::numeric, 0));
  v_reg_unit numeric := greatest(0, coalesce((p_opex->>'rentalRegPerUnitAnnual')::numeric, 0));
  v_reg_yr numeric := v_units * v_reg_unit;
  v_snow numeric := greatest(0, coalesce((p_opex->>'snowLawnAnnual')::numeric, 0));

  v_costs_yr numeric := v_taxes + v_ins + v_water + v_heat + v_res_yr + v_rm_yr + v_mgmt_yr + v_wifi + v_cam + v_reg_yr + v_snow;
  v_costs_mo numeric := v_costs_yr / 12.0;

  v_l_enabled boolean := (p_laundry is not null and jsonb_typeof(p_laundry) = 'object' and coalesce((p_laundry->>'enabled')::boolean, false));
  v_l_stacks numeric := greatest(0, coalesce((p_laundry->>'stacks')::numeric, 0));
  v_l_price numeric := greatest(0, coalesce((p_laundry->>'pricePerLoad')::numeric, 0));
  v_l_lpw numeric := greatest(0, coalesce((p_laundry->>'loadsPerUnitPerWeek')::numeric, 0));
  v_l_util numeric := greatest(0, coalesce((p_laundry->>'utilityPerLoad')::numeric, 0));
  v_l_cshare numeric := greatest(0, least(100, coalesce((p_laundry->>'cardSharePct')::numeric, 0)));
  v_l_cfee numeric := greatest(0, coalesce((p_laundry->>'cardFeePct')::numeric, 0));
  v_l_rfees numeric := greatest(0, coalesce((p_laundry->>'readerFeesAnnual')::numeric, 0));
  v_l_rep numeric := greatest(0, coalesce((p_laundry->>'repairsPerStackAnnual')::numeric, 0));
  v_l_loads numeric := case when v_l_enabled then v_rented * v_l_lpw * 52.0 else 0 end;
  v_l_gross numeric := v_l_loads * v_l_price;
  v_l_util_yr numeric := case when v_l_enabled then v_l_loads * v_l_util else 0 end;
  v_l_proc_yr numeric := case when v_l_enabled then v_l_gross * (v_l_cshare / 100.0) * (v_l_cfee / 100.0) else 0 end;
  v_l_fees_yr numeric := case when v_l_enabled then v_l_proc_yr + v_l_rfees else 0 end;
  v_l_rep_yr numeric := case when v_l_enabled then v_l_stacks * v_l_rep else 0 end;
  v_l_costs numeric := v_l_util_yr + v_l_fees_yr + v_l_rep_yr;
  v_l_net numeric := v_l_gross - v_l_costs;

  v_noi_yr numeric := v_eff_yr + v_l_net - v_costs_yr;
  v_noi_mo numeric := v_noi_yr / 12.0;
  v_cap numeric := case when coalesce(p_cap_rate, 0) > 0 then p_cap_rate else 9 end;
  v_val numeric := greatest(0, v_noi_yr / (v_cap / 100.0));

  v_src jsonb := coalesce(p_opex->'sources', '{}'::jsonb);
  v_overlay jsonb := '[]'::jsonb;
  v_line text;
  v_s text;
  v_vac_line text := null;
begin
  if p_opex is null or jsonb_typeof(p_opex) <> 'object' then
    return null;
  end if;

  v_s := nullif(btrim(coalesce(v_src->>'taxes', '')), '');
  v_overlay := v_overlay || jsonb_build_array('Property taxes: ' || commercial_access_private.fmt_money(v_taxes / 12.0) || '/mo (' || commercial_access_private.fmt_money(v_taxes) || '/yr)' || coalesce(' — ' || v_s, ''));

  v_s := nullif(btrim(coalesce(v_src->>'insurance', '')), '');
  v_overlay := v_overlay || jsonb_build_array('Insurance: ' || commercial_access_private.fmt_money(v_ins / 12.0) || '/mo (' || commercial_access_private.fmt_money(v_ins) || '/yr)' || coalesce(' — ' || v_s, ''));

  v_s := nullif(btrim(coalesce(v_src->>'waterSewerTrash', '')), '');
  v_overlay := v_overlay || jsonb_build_array('Water, sewer and trash: ' || commercial_access_private.fmt_money(v_water / 12.0) || '/mo (' || commercial_access_private.fmt_money(v_water) || '/yr)' || coalesce(' — ' || v_s, ''));

  v_s := nullif(btrim(coalesce(v_src->>'heatGas', '')), '');
  if v_heat > 0 or v_s is not null then
    v_overlay := v_overlay || jsonb_build_array('Heat / gas: ' || commercial_access_private.fmt_money(v_heat / 12.0) || '/mo (' || commercial_access_private.fmt_money(v_heat) || '/yr)' || coalesce(' — ' || v_s, ''));
  end if;

  v_s := nullif(btrim(coalesce(v_src->>'reserves', '')), '');
  v_line := case when v_rented < v_units then 'Reserves (' || round(v_rented) || ' rented)' else 'Reserves (CapEx)' end;
  v_overlay := v_overlay || jsonb_build_array(v_line || ': ' || commercial_access_private.fmt_money(v_res_yr / 12.0) || '/mo (' || commercial_access_private.fmt_money(v_res_yr) || '/yr)' || coalesce(' — ' || v_s, ''));

  if v_rm_yr > 0 then
    v_s := nullif(btrim(coalesce(v_src->>'repairsMaint', '')), '');
    v_overlay := v_overlay || jsonb_build_array('Repairs & maintenance (' || v_rm_pct || '%): ' || commercial_access_private.fmt_money(v_rm_yr / 12.0) || '/mo (' || commercial_access_private.fmt_money(v_rm_yr) || '/yr)' || coalesce(' — ' || v_s, ''));
  end if;

  if v_mgmt_yr > 0 then
    v_s := nullif(btrim(coalesce(v_src->>'mgmtHelp', '')), '');
    v_line := case when v_mgmt_flat > 0 then 'Management help' else 'Management help (' || v_mgmt_pct || '%)' end;
    v_overlay := v_overlay || jsonb_build_array(v_line || ': ' || commercial_access_private.fmt_money(v_mgmt_yr / 12.0) || '/mo (' || commercial_access_private.fmt_money(v_mgmt_yr) || '/yr)' || coalesce(' — ' || v_s, ''));
  end if;

  if v_wifi > 0 then
    v_s := nullif(btrim(coalesce(v_src->>'wifi', '')), '');
    v_overlay := v_overlay || jsonb_build_array('Wi-Fi (smart locks): ' || commercial_access_private.fmt_money(v_wifi / 12.0) || '/mo (' || commercial_access_private.fmt_money(v_wifi) || '/yr)' || coalesce(' — ' || v_s, ''));
  end if;

  if v_cam > 0 then
    v_s := nullif(btrim(coalesce(v_src->>'cameras', '')), '');
    v_overlay := v_overlay || jsonb_build_array('Cameras: ' || commercial_access_private.fmt_money(v_cam / 12.0) || '/mo (' || commercial_access_private.fmt_money(v_cam) || '/yr)' || coalesce(' — ' || v_s, ''));
  end if;

  if v_reg_yr > 0 then
    v_s := nullif(btrim(coalesce(v_src->>'rentalReg', '')), '');
    v_overlay := v_overlay || jsonb_build_array('Rental registration: ' || commercial_access_private.fmt_money(v_reg_yr / 12.0) || '/mo (' || commercial_access_private.fmt_money(v_reg_yr) || '/yr)' || coalesce(' — ' || v_s, ''));
  end if;

  if v_snow > 0 then
    v_s := nullif(btrim(coalesce(v_src->>'snowLawn', '')), '');
    v_overlay := v_overlay || jsonb_build_array('Snow and lawn: ' || commercial_access_private.fmt_money(v_snow / 12.0) || '/mo (' || commercial_access_private.fmt_money(v_snow) || '/yr)' || coalesce(' — ' || v_s, ''));
  end if;

  v_overlay := v_overlay || jsonb_build_array('Total operating costs: ' || commercial_access_private.fmt_money(v_costs_mo) || '/mo (' || commercial_access_private.fmt_money(v_costs_yr) || '/yr).');

  if coalesce(p_apply_vacancy, true) then
    v_s := nullif(btrim(coalesce(v_src->>'vacancy', '')), '');
    v_vac_line := 'Less ' || v_vac_pct || '% vacancy: ' || commercial_access_private.fmt_money(v_eff_mo) || '/mo' || coalesce(' (' || v_s || ')', '');
  end if;

  return jsonb_build_object(
    'grossMo', v_gross_mo,
    'rentMo', v_eff_mo,
    'costsMo', v_costs_mo,
    'costsYr', v_costs_yr,
    'netYr', v_noi_yr,
    'noiMo', v_noi_mo,
    'value', v_val,
    'vacancyPct', v_vac_pct,
    'laundryNetYr', v_l_net,
    'laundryNetMo', v_l_net / 12.0,
    'laundryGrossYr', v_l_gross,
    'laundryCostsYr', v_l_costs,
    'laundryLoadsYr', v_l_loads,
    'laundry', case when v_l_enabled then jsonb_build_object(
      'enabled', true,
      'loadsYr', v_l_loads,
      'grossYr', v_l_gross,
      'grossMo', v_l_gross / 12.0,
      'utilYr', v_l_util_yr,
      'feesYr', v_l_fees_yr,
      'repairsYr', v_l_rep_yr,
      'costsYr', v_l_costs,
      'costsMo', v_l_costs / 12.0,
      'netYr', v_l_net,
      'netMo', v_l_net / 12.0
    ) else null end,
    'costsOverlay', v_overlay,
    'vacancyOverlayLine', v_vac_line
  );
end
$$;

revoke all on function commercial_access_private.compute_opex_view(jsonb, numeric, numeric, numeric, boolean, numeric, jsonb) from public, anon, authenticated;

-- 4. Update apply_opex_to_guide to pass laundry + defaultRent = ourRent ($1,000) everywhere.
create or replace function commercial_access_private.apply_opex_to_guide(
  p_guide jsonb,
  p_opex jsonb,
  p_plan jsonb,
  p_base jsonb,
  p_repairs numeric
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  g jsonb := p_guide;
  v_units numeric := greatest(1, coalesce((p_base->>'units')::numeric, 10));
  v_our_rent numeric := greatest(0, coalesce((p_base->>'rent')::numeric, (g->'rentValue'->>'ourRent')::numeric, 0));
  v_cap numeric := greatest(0.1, coalesce((p_base->>'valueCapRate')::numeric, (g->'rentValue'->>'capRate')::numeric, 9));
  v_repairs numeric := greatest(0, coalesce(p_repairs, (g->'costSummary'->>'total')::numeric, (p_base->>'rehab')::numeric, 0));
  v_buyout numeric := greatest(0, coalesce(
    nullif((p_base->>'ourOffer')::numeric, 0),
    nullif((p_base->>'purchasePrice')::numeric, 0),
    nullif((g->'rentValue'->>'buyout')::numeric, 0),
    nullif((p_plan->>'sellerLoanBalance')::numeric, 0),
    nullif((g->'refi'->>'sellerNotePrincipal')::numeric, 0),
    0
  ));
  v_all_in numeric := v_buyout + v_repairs;
  v_low numeric := coalesce(
    nullif((p_base->>'marketRentLow')::numeric, 0),
    nullif((p_plan->'marketRent'->>'low')::numeric, 0),
    nullif((g->'rentValue'->'marketRange'->>'low')::numeric, 0)
  );
  v_high numeric := coalesce(
    nullif((p_base->>'marketRentHigh')::numeric, 0),
    nullif((p_plan->'marketRent'->>'high')::numeric, 0),
    nullif((g->'rentValue'->'marketRange'->>'high')::numeric, 0)
  );
  v_laundry jsonb := coalesce(
    case when jsonb_typeof(p_plan->'laundry') = 'object' then p_plan->'laundry' end,
    case when jsonb_typeof(p_base->'laundry') = 'object' then p_base->'laundry' end,
    null
  );
  v_asis_rented numeric := 0;
  v_asis_gross numeric := 0;
  v_market_gross numeric := 0;
  v_unit jsonb;
  v_asis_c jsonb;
  v_after_c jsonb;
  v_mkt_c jsonb;
  v_mkt_rent_overlay jsonb := '[]'::jsonb;
  v_views jsonb;
  v_caps jsonb;
  v_grid jsonb := '[]'::jsonb;
  v_r numeric;
  v_k int;
  v_rents numeric[] := '{}';
  v_max_grid numeric := case when v_high is not null and v_high > 0 then v_high else 9999999 end;
  v_row_c jsonb;
  v_cells jsonb;
  v_c numeric;
  v_c_val numeric;
  v_refi_rate numeric := coalesce((p_base->>'refiRate')::numeric, 7.5);
  v_refi_years numeric := coalesce((p_base->>'refiYears')::numeric, 30);
  v_refi_ltv numeric := coalesce((p_base->>'refiLtv')::numeric, (g->'refi'->>'ltvPct')::numeric, 75);
  v_refi_dscr numeric := coalesce((p_base->>'refiDscr')::numeric, 1.25);
  v_fees_pct numeric := coalesce((p_base->>'refiFeesPct')::numeric, (g->'refi'->>'feesPct')::numeric, 2.5);
  v_fees_flat numeric := coalesce((p_base->>'refiFeesFlat')::numeric, (g->'refi'->>'feesFlat')::numeric, 0);
  v_reserve numeric := coalesce((p_base->>'refiReserve')::numeric, (g->'refi'->>'reserve')::numeric, 0);
  v_est_val numeric;
  v_loan_dscr numeric;
  v_loan_ltv numeric;
  v_loan numeric;
  v_limited_by text;
  v_fees_amt numeric;
  v_in_hand numeric;
  v_seller_payoff numeric;
  v_repair_payoff numeric;
  v_cont numeric;
  v_left numeric;
  v_left_cont numeric;
  v_cell_overlay jsonb;
begin
  if g is null or p_opex is null or jsonb_typeof(p_opex) <> 'object' then
    return g;
  end if;

  g := jsonb_set(g, '{opex}', p_opex, true);
  if v_laundry is not null then
    g := jsonb_set(g, '{laundry}', v_laundry, true);
  end if;

  for v_unit in
    select value from jsonb_array_elements(
      case when jsonb_typeof(g->'rentValue'->'units') = 'array' then g->'rentValue'->'units' else '[]'::jsonb end
    )
  loop
    if coalesce((v_unit->>'rentToday')::numeric, 0) > 0 then
      v_asis_rented := v_asis_rented + 1;
      v_asis_gross := v_asis_gross + (v_unit->>'rentToday')::numeric;
    end if;
    v_market_gross := v_market_gross + coalesce(nullif((v_unit->>'marketRent')::numeric, 0), v_our_rent);
    v_mkt_rent_overlay := v_mkt_rent_overlay || jsonb_build_array(
      'Unit ' || coalesce(v_unit->>'id', '') || ': ' ||
      commercial_access_private.fmt_money(coalesce(nullif((v_unit->>'marketRent')::numeric, 0), v_our_rent)) || '/mo' ||
      case when nullif((v_unit->>'marketRent')::numeric, 0) is null then ' (our rent)' else '' end
    );
  end loop;
  if v_market_gross <= 0 then
    v_market_gross := v_units * v_our_rent;
  end if;

  v_asis_c := commercial_access_private.compute_opex_view(p_opex, v_units, v_asis_rented, v_asis_gross, false, v_cap, v_laundry);
  v_after_c := commercial_access_private.compute_opex_view(p_opex, v_units, v_units, v_units * v_our_rent, true, v_cap, v_laundry);
  v_mkt_c := commercial_access_private.compute_opex_view(p_opex, v_units, v_units, v_market_gross, true, v_cap, v_laundry);

  v_mkt_rent_overlay := v_mkt_rent_overlay || jsonb_build_array(v_mkt_c->>'vacancyOverlayLine');

  v_views := jsonb_build_array(
    jsonb_build_object(
      'key', 'asis',
      'label', 'As is',
      'rented', v_asis_rented,
      'total', v_units,
      'rentMo', (v_asis_c->>'rentMo')::numeric,
      'costsMo', (v_asis_c->>'costsMo')::numeric,
      'laundryNetYr', (v_asis_c->>'laundryNetYr')::numeric,
      'netYr', (v_asis_c->>'netYr')::numeric,
      'value', (v_asis_c->>'value')::numeric,
      'allIn', v_buyout,
      'rentOverlay', jsonb_build_array(round(v_asis_rented) || ' of ' || round(v_units) || ' rented today'),
      'costsOverlay', v_asis_c->'costsOverlay',
      'netOverlay', jsonb_build_array('(' || commercial_access_private.fmt_money((v_asis_c->>'rentMo')::numeric) ||
        case when coalesce((v_asis_c->>'laundryNetYr')::numeric, 0) <> 0 then ' + ' || commercial_access_private.fmt_money((v_asis_c->>'laundryNetMo')::numeric) || ' laundry' else '' end ||
        ' − ' || commercial_access_private.fmt_money((v_asis_c->>'costsMo')::numeric) || ') × 12 = ' || commercial_access_private.fmt_money((v_asis_c->>'netYr')::numeric) || '/yr'),
      'valueOverlay', jsonb_build_array(commercial_access_private.fmt_money((v_asis_c->>'netYr')::numeric) || '/yr ÷ ' || v_cap || '% cap rate = ' || commercial_access_private.fmt_money((v_asis_c->>'value')::numeric)),
      'allInOverlay', jsonb_build_array('Seller’s note ' || commercial_access_private.fmt_money(v_buyout))
    ),
    jsonb_build_object(
      'key', 'after',
      'label', 'After repairs',
      'rented', v_units,
      'total', v_units,
      'rentMo', (v_after_c->>'rentMo')::numeric,
      'costsMo', (v_after_c->>'costsMo')::numeric,
      'laundryNetYr', (v_after_c->>'laundryNetYr')::numeric,
      'netYr', (v_after_c->>'netYr')::numeric,
      'value', (v_after_c->>'value')::numeric,
      'allIn', v_all_in,
      'rentOverlay', jsonb_build_array(round(v_units) || ' × ' || commercial_access_private.fmt_money(v_our_rent) || '/mo = ' || commercial_access_private.fmt_money(v_units * v_our_rent) || '/mo', v_after_c->>'vacancyOverlayLine'),
      'costsOverlay', v_after_c->'costsOverlay',
      'netOverlay', jsonb_build_array('(' || commercial_access_private.fmt_money((v_after_c->>'rentMo')::numeric) ||
        case when coalesce((v_after_c->>'laundryNetYr')::numeric, 0) <> 0 then ' + ' || commercial_access_private.fmt_money((v_after_c->>'laundryNetMo')::numeric) || ' laundry' else '' end ||
        ' − ' || commercial_access_private.fmt_money((v_after_c->>'costsMo')::numeric) || ') × 12 = ' || commercial_access_private.fmt_money((v_after_c->>'netYr')::numeric) || '/yr'),
      'valueOverlay', jsonb_build_array(commercial_access_private.fmt_money((v_after_c->>'netYr')::numeric) || '/yr ÷ ' || v_cap || '% cap rate = ' || commercial_access_private.fmt_money((v_after_c->>'value')::numeric)),
      'allInOverlay', jsonb_build_array('Seller’s note ' || commercial_access_private.fmt_money(v_buyout), 'Repairs ' || commercial_access_private.fmt_money(v_repairs))
    ),
    jsonb_build_object(
      'key', 'market',
      'label', 'Full market rent',
      'rented', v_units,
      'total', v_units,
      'rentMo', (v_mkt_c->>'rentMo')::numeric,
      'costsMo', (v_mkt_c->>'costsMo')::numeric,
      'laundryNetYr', (v_mkt_c->>'laundryNetYr')::numeric,
      'netYr', (v_mkt_c->>'netYr')::numeric,
      'value', (v_mkt_c->>'value')::numeric,
      'allIn', v_all_in,
      'rentOverlay', v_mkt_rent_overlay,
      'costsOverlay', v_mkt_c->'costsOverlay',
      'netOverlay', jsonb_build_array('(' || commercial_access_private.fmt_money((v_mkt_c->>'rentMo')::numeric) ||
        case when coalesce((v_mkt_c->>'laundryNetYr')::numeric, 0) <> 0 then ' + ' || commercial_access_private.fmt_money((v_mkt_c->>'laundryNetMo')::numeric) || ' laundry' else '' end ||
        ' − ' || commercial_access_private.fmt_money((v_mkt_c->>'costsMo')::numeric) || ') × 12 = ' || commercial_access_private.fmt_money((v_mkt_c->>'netYr')::numeric) || '/yr'),
      'valueOverlay', jsonb_build_array(commercial_access_private.fmt_money((v_mkt_c->>'netYr')::numeric) || '/yr ÷ ' || v_cap || '% cap rate = ' || commercial_access_private.fmt_money((v_mkt_c->>'value')::numeric)),
      'allInOverlay', jsonb_build_array('Seller’s note ' || commercial_access_private.fmt_money(v_buyout), 'Repairs ' || commercial_access_private.fmt_money(v_repairs))
    )
  );

  for v_k in -4..1 loop
    v_r := least(v_our_rent + v_k * 100, v_max_grid);
    if v_r > 0 and not (v_r = any(v_rents)) then
      v_rents := array_append(v_rents, v_r);
    end if;
  end loop;
  v_caps := jsonb_build_array(v_cap, v_cap + 1, v_cap + 2, v_cap + 3);
  foreach v_r in array v_rents loop
    v_row_c := commercial_access_private.compute_opex_view(p_opex, v_units, v_units, v_units * v_r, true, v_cap, v_laundry);
    v_cells := '[]'::jsonb;
    for v_k in 0..3 loop
      v_c := v_cap + v_k;
      v_c_val := greatest(0, (v_row_c->>'netYr')::numeric / (v_c / 100.0));
      v_cell_overlay := jsonb_build_array(
        round(v_units) || ' units × ' || commercial_access_private.fmt_money(v_r) || '/mo, less ' || (v_row_c->>'vacancyPct') || '% vacancy: ' || commercial_access_private.fmt_money((v_row_c->>'rentMo')::numeric) || '/mo'
      );
      if coalesce((v_row_c->>'laundryNetYr')::numeric, 0) <> 0 then
        v_cell_overlay := v_cell_overlay || jsonb_build_array('Laundry net: +' || commercial_access_private.fmt_money((v_row_c->>'laundryNetMo')::numeric) || '/mo');
      end if;
      v_cell_overlay := v_cell_overlay || jsonb_build_array(
        'Less costs: ' || commercial_access_private.fmt_money((v_row_c->>'costsMo')::numeric) || '/mo',
        commercial_access_private.fmt_money((v_row_c->>'netYr')::numeric) || '/yr ÷ ' || v_c || '% = ' || commercial_access_private.fmt_money(v_c_val),
        'All in: ' || commercial_access_private.fmt_money(v_all_in)
      );
      v_cells := v_cells || jsonb_build_array(jsonb_build_object(
        'cap', v_c,
        'value', v_c_val,
        'clears', v_c_val >= v_all_in,
        'stabilized', (v_r = v_our_rent and v_c = v_cap),
        'overlay', v_cell_overlay
      ));
    end loop;
    v_grid := v_grid || jsonb_build_array(jsonb_build_object('rent', v_r, 'cells', v_cells));
  end loop;

  if jsonb_typeof(g->'rentValue') = 'object' then
    g := jsonb_set(g, '{rentValue,allIn}', to_jsonb(v_all_in), true);
    g := jsonb_set(g, '{rentValue,buyout}', to_jsonb(v_buyout), true);
    g := jsonb_set(g, '{rentValue,repairs}', to_jsonb(v_repairs), true);
    g := jsonb_set(g, '{rentValue,ourRent}', to_jsonb(v_our_rent), true);
    g := jsonb_set(g, '{rentValue,defaultRent}', to_jsonb(v_our_rent), true);
    g := jsonb_set(g, '{rentValue,views}', v_views, true);
    g := jsonb_set(g, '{rentValue,caps}', v_caps, true);
    g := jsonb_set(g, '{rentValue,grid}', v_grid, true);
    g := g #- '{rentValue,valueRange}';
    if v_low is not null and v_high is not null and v_high >= v_low and v_low > 0 then
      g := jsonb_set(g, '{rentValue,marketRange}', jsonb_strip_nulls(jsonb_build_object(
        'low', v_low,
        'high', v_high,
        'defaultRent', v_our_rent,
        'units', v_units,
        'vacancyPct', (v_after_c->>'vacancyPct')::numeric,
        'costsMo', (v_after_c->>'costsMo')::numeric,
        'capRate', v_cap,
        'allIn', v_all_in,
        'opex', p_opex,
        'laundry', v_laundry
      )), true);
    end if;
  end if;

  if jsonb_typeof(g->'refi') = 'object' then
    v_est_val := (v_after_c->>'value')::numeric;
    v_loan_dscr := case when v_refi_dscr > 0 then commercial_access_private.pv_cap(v_refi_rate, v_refi_years, (v_after_c->>'noiMo')::numeric / v_refi_dscr) else 0 end;
    v_loan_ltv := (v_refi_ltv / 100.0) * v_est_val;
    v_loan := least(v_loan_dscr, v_loan_ltv);
    v_limited_by := case when v_loan_dscr < v_loan_ltv then 'DSCR' else 'LTV' end;
    v_fees_amt := (v_loan * v_fees_pct) / 100.0;
    v_in_hand := v_loan - v_fees_amt - v_fees_flat - v_reserve;
    v_seller_payoff := coalesce((g->'refi'->>'sellerPayoff')::numeric, 0);
    v_repair_payoff := coalesce((g->'refi'->>'repairLoanPayoff')::numeric, 0);
    v_cont := coalesce((g->'costSummary'->>'contingency')::numeric, (p_plan->>'contingency')::numeric, 0);
    v_left := v_in_hand - v_seller_payoff - v_repair_payoff - coalesce((g->'refi'->>'closing')::numeric, 0);
    v_left_cont := v_left - v_cont;

    g := jsonb_set(g, '{refi}', (g->'refi') || jsonb_build_object(
      'dscrNoiMo', (v_after_c->>'noiMo')::numeric,
      'dscrNoiAnnual', (v_after_c->>'netYr')::numeric,
      'estimatedValue', v_est_val,
      'loanByDscr', v_loan_dscr,
      'loanByLtv', v_loan_ltv,
      'loan', v_loan,
      'limitedBy', v_limited_by,
      'ltvShownPct', case when v_est_val > 0 then round((v_loan / v_est_val) * 100.0) else round(v_refi_ltv) end,
      'feesPctAmt', v_fees_amt,
      'inHand', v_in_hand,
      'inHandOverlay', jsonb_strip_nulls(jsonb_build_array(
        'Loan: ' || commercial_access_private.fmt_money(v_loan),
        case when v_fees_amt > 0 then 'Fees (' || v_fees_pct || '%): −' || commercial_access_private.fmt_money(v_fees_amt) end,
        case when v_fees_flat > 0 then 'Flat fees: −' || commercial_access_private.fmt_money(v_fees_flat) end,
        case when v_reserve > 0 then 'Lender holdback: −' || commercial_access_private.fmt_money(v_reserve) end,
        'In hand: ' || commercial_access_private.fmt_money(v_in_hand) || '.'
      )),
      'estimatedValueOverlay', jsonb_build_array(
        'Value by income',
        'Full-occupancy NOI ' || commercial_access_private.fmt_money((v_after_c->>'netYr')::numeric) || '/yr (' || commercial_access_private.fmt_money((v_after_c->>'noiMo')::numeric) || '/mo after operating costs) ÷ ' || v_cap || '% cap rate = ' || commercial_access_private.fmt_money(v_est_val) || '.'
      ),
      'loanOverlay', jsonb_build_array(
        'Lower of ' || v_refi_dscr || 'x DSCR loan (' || commercial_access_private.fmt_money(v_loan_dscr) || ') and ' || v_refi_ltv || '% of value (' || commercial_access_private.fmt_money(v_loan_ltv) || ') at ' || v_refi_rate || '% / ' || round(v_refi_years) || ' yrs.'
      )
    ) || case when v_seller_payoff > 0 and v_repair_payoff > 0 then jsonb_build_object(
      'leftForYou', v_left,
      'leftForYouContUsed', v_left_cont,
      'leftForYouOverlay', jsonb_build_array(
        commercial_access_private.fmt_money(v_in_hand) || ' in hand − ' ||
        commercial_access_private.fmt_money(coalesce((g->'refi'->>'sellerNotePrincipal')::numeric, v_buyout)) || ' seller − ' ||
        commercial_access_private.fmt_money(coalesce((g->'refi'->>'sellerCarriedBills')::numeric, 0)) || ' deferred costs − ' ||
        commercial_access_private.fmt_money(v_repair_payoff) || ' seller renovation note = ' ||
        commercial_access_private.fmt_money(v_left) || '.'
      ),
      'leftForYouContUsedOverlay', jsonb_build_array(
        commercial_access_private.fmt_money(v_in_hand) || ' in hand − ' ||
        commercial_access_private.fmt_money(coalesce((g->'refi'->>'sellerNotePrincipal')::numeric, v_buyout)) || ' seller − ' ||
        commercial_access_private.fmt_money(coalesce((g->'refi'->>'sellerCarriedBills')::numeric, 0)) || ' deferred costs − ' ||
        commercial_access_private.fmt_money(v_repair_payoff + v_cont) || ' seller renovation note = ' ||
        commercial_access_private.fmt_money(v_left_cont) || '.'
      )
    ) else '{}'::jsonb end, true);
  end if;

  return g;
end
$$;

revoke all on function commercial_access_private.apply_opex_to_guide(jsonb, jsonb, jsonb, jsonb, numeric) from public, anon, authenticated;

-- 5. Update get_lead_guide to emit individual laundry budget lines + laundry income sync.
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
  v_laundry_items jsonb;
  v_opex jsonb;
  v_plan_raw text;
  v_plan jsonb := '{}'::jsonb;
  v_base jsonb := '{}'::jsonb;
  v_total numeric := 0;
  v_cont numeric;
  v_rehab_sub numeric;
  v_units_amt numeric;
  v_bldg_amt numeric := 0;
  v_laundry_amt numeric := 0;
  v_setup_amt numeric;
  v_heading text;
  v_one_line text;
  v_lines jsonb;
  v_heading_overlay jsonb;
  v_cs jsonb;
  v_item jsonb;
  v_idx int := 0;
  v_l_label text;
  v_l_cost numeric;
  v_l_src text;
  v_parts text[] := '{}';
begin
  if r is null or r not in ('owner','lender','reviewer') then return null; end if;
  select o.seller_summary->'guide' into g from public.commercial_offers o
   where o.deal_id = p_deal and o.is_lead = true
     and (r = 'owner' or (r = 'reviewer' and o.share_reviewer) or (r = 'lender' and o.share_lender))
   order by o.sort, o.updated_at desc limit 1;
  if g is null then return null; end if;

  select d.slug into v_slug from public.commercial_deals d where d.id = p_deal;
  select s.value into v_plan_raw from public.commercial_settings s where s.key = 'deal_plan:' || btrim(v_slug) limit 1;
  begin
    if v_plan_raw is not null and btrim(v_plan_raw) <> '' then
      v_plan := v_plan_raw::jsonb;
    end if;
  exception when others then
    v_plan := '{}'::jsonb;
  end;

  v_budgets := commercial_access_private.plan_step_budgets(v_slug);
  v_laundry_items := commercial_access_private.plan_laundry_items(v_slug);

  if v_budgets is not null and coalesce(v_budgets->>'total', '') ~ '^-?\d+(\.\d+)?$' then
    v_total := (v_budgets->>'total')::numeric;
    if v_total > 0 then
      v_cont := coalesce((v_budgets->>'contingency')::numeric, 0);
      v_rehab_sub := greatest(0, v_total - v_cont);
      v_units_amt := coalesce((v_budgets->>'units')::numeric, 0);
      v_laundry_amt := coalesce((v_budgets->>'laundry')::numeric, 0);

      if jsonb_typeof(v_plan->'costs') = 'array' then
        for v_item in select value from jsonb_array_elements(v_plan->'costs') loop
          if lower(coalesce(v_item->>'group', '')) = 'systems' and greatest(0, coalesce((v_item->>'cost')::numeric, 0)) > 0 then
            v_bldg_amt := v_bldg_amt + greatest(0, (v_item->>'cost')::numeric);
          end if;
        end loop;
      else
        v_bldg_amt := coalesce((v_budgets->>'building')::numeric, 0);
      end if;
      v_setup_amt := greatest(0, v_rehab_sub - v_units_amt - v_bldg_amt - v_laundry_amt);
      v_heading := 'Repair budget ' || commercial_access_private.fmt_money(v_total);

      v_lines := '[]'::jsonb;
      v_heading_overlay := '[]'::jsonb;
      if v_units_amt > 0 then
        v_lines := v_lines || jsonb_build_array(jsonb_build_object('key', 'units', 'label', 'Units ' || commercial_access_private.fmt_money(v_units_amt), 'detail', '', 'overlay', jsonb_build_array('Total units: ' || commercial_access_private.fmt_money(v_units_amt) || '.')));
        v_heading_overlay := v_heading_overlay || jsonb_build_array('Units: ' || commercial_access_private.fmt_money(v_units_amt));
        v_parts := array_append(v_parts, 'Units ' || commercial_access_private.fmt_money(v_units_amt));
      end if;
      if v_bldg_amt > 0 then
        v_lines := v_lines || jsonb_build_array(jsonb_build_object('key', 'building', 'label', 'Building ' || commercial_access_private.fmt_money(v_bldg_amt), 'detail', '', 'overlay', jsonb_build_array('Total building: ' || commercial_access_private.fmt_money(v_bldg_amt) || '.')));
        v_heading_overlay := v_heading_overlay || jsonb_build_array('Building: ' || commercial_access_private.fmt_money(v_bldg_amt));
        v_parts := array_append(v_parts, 'Building ' || commercial_access_private.fmt_money(v_bldg_amt));
      end if;
      if v_setup_amt > 0 then
        v_lines := v_lines || jsonb_build_array(jsonb_build_object('key', 'setup', 'label', 'Setup ' || commercial_access_private.fmt_money(v_setup_amt), 'detail', '', 'overlay', jsonb_build_array('Total setup: ' || commercial_access_private.fmt_money(v_setup_amt) || '.')));
        v_heading_overlay := v_heading_overlay || jsonb_build_array('Setup: ' || commercial_access_private.fmt_money(v_setup_amt));
        v_parts := array_append(v_parts, 'Setup ' || commercial_access_private.fmt_money(v_setup_amt));
      end if;
      if v_laundry_amt > 0 then
        v_heading_overlay := v_heading_overlay || jsonb_build_array('Laundry: ' || commercial_access_private.fmt_money(v_laundry_amt));
      end if;
      if jsonb_typeof(v_laundry_items) = 'array' and jsonb_array_length(v_laundry_items) > 0 then
        v_idx := 0;
        for v_item in select value from jsonb_array_elements(v_laundry_items) loop
          v_l_label := coalesce(v_item->>'label', '');
          v_l_cost := greatest(0, coalesce((v_item->>'cost')::numeric, 0));
          v_l_src := nullif(btrim(coalesce(v_item->>'source', '')), '');
          v_lines := v_lines || jsonb_build_array(jsonb_build_object(
            'key', 'laundry-' || v_idx,
            'label', v_l_label || ' — ' || commercial_access_private.fmt_money(v_l_cost),
            'title', v_l_label,
            'amount', v_l_cost,
            'detail', '',
            'overlay', case when v_l_src is not null
              then jsonb_build_array(v_l_src, v_l_label || ': ' || commercial_access_private.fmt_money(v_l_cost))
              else jsonb_build_array(v_l_label || ': ' || commercial_access_private.fmt_money(v_l_cost))
            end
          ));
          v_parts := array_append(v_parts, v_l_label || ' — ' || commercial_access_private.fmt_money(v_l_cost));
          v_idx := v_idx + 1;
        end loop;
      end if;
      if v_cont > 0 then
        v_lines := v_lines || jsonb_build_array(jsonb_build_object('key', 'contingency', 'label', 'Contingency ' || commercial_access_private.fmt_money(v_cont), 'detail', '', 'overlay', jsonb_build_array('Repair contingency: ' || commercial_access_private.fmt_money(v_cont) || '.')));
        v_heading_overlay := v_heading_overlay || jsonb_build_array('Rehab subtotal: ' || commercial_access_private.fmt_money(v_rehab_sub), 'Contingency: ' || commercial_access_private.fmt_money(v_cont), 'Total with contingency: ' || commercial_access_private.fmt_money(v_total) || '.');
        v_parts := array_append(v_parts, 'Contingency ' || commercial_access_private.fmt_money(v_cont));
      else
        v_heading_overlay := v_heading_overlay || jsonb_build_array('Total job: ' || commercial_access_private.fmt_money(v_total) || '.');
      end if;

      v_one_line := case when array_length(v_parts, 1) > 0 then v_heading || ' — ' || array_to_string(v_parts, ', ') else v_heading end;

      v_cs := coalesce(g->'costSummary', '{}'::jsonb) || jsonb_build_object(
        'total', v_total,
        'rehabTotal', v_rehab_sub,
        'contingency', v_cont,
        'heading', v_heading,
        'headingOverlay', v_heading_overlay,
        'oneLine', v_one_line,
        'stepBudgets', v_budgets,
        'laundryItems', v_laundry_items,
        'lines', v_lines
      );

      g := jsonb_set(g, '{cost}', v_lines, true);
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

  v_opex := commercial_access_private.plan_opex(v_slug);
  if v_opex is not null then
    select coalesce(m.base, '{}'::jsonb) into v_base from public.commercial_models m where m.deal_id = p_deal limit 1;
    g := commercial_access_private.apply_opex_to_guide(g, v_opex, v_plan, coalesce(v_base, '{}'::jsonb), v_total);
  end if;

  if r = 'reviewer' and g is not null then g := g #- '{rentValue,marketRange}'; end if;
  return g;
end
$function$;

-- 6. Apply Charlotte Part A, B, C, F, G data updates atomically & regenerate saved seller_summary.
do $$
declare
  v_deal_id uuid;
  v_raw text;
  v_plan jsonb := '{}'::jsonb;
  v_new_costs jsonb := '[]'::jsonb;
  v_cost_item jsonb;
  v_has_gas boolean := false;
  v_opex jsonb;
  v_laundry jsonb;
  v_laundry_items jsonb;
  v_budgets jsonb;
  v_total numeric := 142440;
  v_base jsonb := '{}'::jsonb;
  v_rent numeric := 1000;
  v_cap numeric := 9;
  v_calc jsonb;
  v_noi numeric;
  v_val numeric;
  v_steps jsonb;
  v_new_steps jsonb := '[]'::jsonb;
  v_step jsonb;
  v_new_items jsonb;
  v_sitem jsonb;
  v_ss jsonb;
  v_guide jsonb;
  v_cs jsonb;
  v_refi jsonb;
  v_reno_amt numeric := 127940;
  v_reno_mo numeric := 852.9333333333334;
  v_def_bills numeric := 5011;
  v_def_pnote numeric := 5570.459081118044;
  v_def_rnote numeric := 2938.886360372682;
  v_def_total numeric := 13520.345441490726;
  v_seller_payoff numeric := 288520.3454414907;
  v_seller_total numeric := 416460.3454414907;
  v_reg_loan numeric := 151733.33333333334;
  v_reg_pts numeric := 3793.333333333343;
  v_reg_mo numeric := 1390.888888888889;
  v_lines jsonb;
  v_heading_overlay jsonb;
  v_l_idx int := 0;
  v_parts text[];
  v_terms jsonb;
  v_term jsonb;
  v_new_terms jsonb := '[]'::jsonb;
  v_offer_steps jsonb;
  v_ostep jsonb;
  v_new_osteps jsonb := '[]'::jsonb;
begin
  select d.id into v_deal_id from public.commercial_deals d where d.slug = 'charlotte' limit 1;
  if v_deal_id is null then
    return;
  end if;

  select s.value into v_raw from public.commercial_settings s where s.key = 'deal_plan:charlotte' limit 1;
  if v_raw is not null and btrim(v_raw) <> '' then
    begin
      v_plan := v_raw::jsonb;
    exception when others then
      v_plan := '{}'::jsonb;
    end;
  end if;
  if jsonb_typeof(v_plan) <> 'object' then
    v_plan := '{}'::jsonb;
  end if;

  -- Part A: replace old 3-stack laundry cost with the 4 Speed Queen items ($16,390), keep single gas check ($2,000).
  if jsonb_typeof(v_plan->'costs') = 'array' then
    for v_cost_item in select value from jsonb_array_elements(v_plan->'costs') loop
      if lower(coalesce(v_cost_item->>'group', '')) = 'laundry' or coalesce(v_cost_item->>'label', '') ~* '(3 stacked sets|Speed Queen|KioSoft|240V electrical drops|basement laundry room)' then
        continue;
      end if;
      if coalesce(v_cost_item->>'label', '') ~* 'gas check and furnace service' then
        if v_has_gas then
          continue;
        end if;
        v_has_gas := true;
      end if;
      v_new_costs := v_new_costs || jsonb_build_array(v_cost_item);
    end loop;
  end if;
  if not v_has_gas then
    v_new_costs := v_new_costs || jsonb_build_array(
      jsonb_build_object('start', 0, 'end', 1, 'cost', 2000, 'group', 'systems', 'label', 'Gas check and furnace service')
    );
  end if;

  v_new_costs := v_new_costs || jsonb_build_array(
    jsonb_build_object('start', 3, 'end', 8, 'cost', 10154, 'group', 'laundry', 'label', 'Two Speed Queen stacked washer/dryer units (deliver, install, 5-yr parts/labor)', 'source', 'Speed Queen Commercial Laundry proposal'),
    jsonb_build_object('start', 3, 'end', 8, 'cost', 1676, 'group', 'laundry', 'label', 'KioSoft Ultra V2 card readers (2) + Ethernet hub + kiosk setup', 'source', 'KioSoft Commercial Laundry proposal'),
    jsonb_build_object('start', 3, 'end', 8, 'cost', 2560, 'group', 'laundry', 'label', '240V electrical drops, plumbing tie-ins, 4-inch galvanized venting', 'source', 'Allowance; confirm with contractor walk'),
    jsonb_build_object('start', 3, 'end', 8, 'cost', 2000, 'group', 'laundry', 'label', 'Cleanout, epoxy floor, LED light, folding table in basement laundry room', 'source', 'Allowance; confirm with contractor walk')
  );

  -- Part G: flat $1,200/yr ($100/mo) management help instead of 0.5% of rent.
  v_opex := coalesce(v_plan->'opex', '{}'::jsonb) || jsonb_build_object(
    'taxesAnnual', 13544,
    'insuranceAnnual', 6500,
    'waterSewerTrashAnnual', 12000,
    'heatGasAnnual', 0,
    'reservesPerUnitAnnual', 450,
    'vacancyPct', 5,
    'repairsMaintPct', 8,
    'mgmtHelpPct', 0,
    'mgmtHelpAnnual', 1200,
    'wifiAnnual', 840,
    'camerasAnnual', 200,
    'rentalRegPerUnitAnnual', 15,
    'snowLawnAnnual', 3000,
    'sources', coalesce(v_plan->'opex'->'sources', '{}'::jsonb) || jsonb_build_object(
      'taxes', '2025 county bill',
      'waterSewerTrash', 'Trash is billed with water; second dumpster = $0',
      'heatGas', 'Tenants pay their own',
      'reserves', 'CapEx / replacement reserves ($450/unit/yr; no separate 8% CapEx)',
      'vacancy', '5% of rent',
      'repairsMaint', '8% of rent',
      'mgmtHelp', 'Flat $100/mo ($1,200/yr) — owner assumption',
      'wifi', '$70/mo for smart locks',
      'cameras', 'Wyze Cam Unlimited Pro',
      'rentalReg', 'City of Akron ($15/unit/yr)',
      'snowLawn', 'Snow and lawn'
    )
  );

  -- Part B: owner-editable laundry operating engine.
  v_laundry := jsonb_build_object(
    'enabled', true,
    'stacks', 2,
    'pricePerLoad', 4,
    'loadsPerUnitPerWeek', 3,
    'utilityPerLoad', 0.45,
    'cardSharePct', 60,
    'cardFeePct', 4,
    'readerFeesAnnual', 480,
    'repairsPerStackAnnual', 250,
    'sources', jsonb_build_object(
      'revenue', '$4/load × 3 loads/unit/week × 52 wks (owner benchmark)',
      'utilities', '$0.45/load water/gas/electric',
      'fees', '4% card processing on 60% card share + $40/mo KioSoft software',
      'repairs', '$250/stack/yr allowance'
    )
  );

  v_plan := jsonb_set(v_plan, '{costs}', v_new_costs, true);
  v_plan := jsonb_set(v_plan, '{opex}', v_opex, true);
  v_plan := jsonb_set(v_plan, '{laundry}', v_laundry, true);
  insert into public.commercial_settings (key, value)
  values ('deal_plan:charlotte', v_plan::text)
  on conflict (key) do update set value = excluded.value;

  -- Update seller_content Week 1 laundry step wording to 2 stacked sets.
  select d.seller_content->'execution_steps' into v_steps
  from public.commercial_deals d where d.id = v_deal_id;
  if jsonb_typeof(v_steps) = 'array' then
    for v_step in select value from jsonb_array_elements(v_steps) loop
      if coalesce(v_step->>'key', '') = 'week1_secure_and_start' and jsonb_typeof(v_step->'items') = 'array' then
        v_new_items := '[]'::jsonb;
        for v_sitem in select value from jsonb_array_elements(v_step->'items') loop
          if coalesce(v_sitem->>'budgetKey', '') = 'laundry' then
            v_sitem := jsonb_set(v_sitem, '{text}', to_jsonb('Get laundry running: 2 stacked sets taking coins, tap/card and bills'::text), true);
          end if;
          v_new_items := v_new_items || jsonb_build_array(v_sitem);
        end loop;
        v_step := jsonb_set(v_step, '{items}', v_new_items, true);
      end if;
      v_new_steps := v_new_steps || jsonb_build_array(v_step);
    end loop;
    update public.commercial_deals
    set seller_content = jsonb_set(coalesce(seller_content, '{}'::jsonb), '{execution_steps}', v_new_steps, true)
    where id = v_deal_id;
  end if;

  v_budgets := commercial_access_private.plan_step_budgets('charlotte');
  v_laundry_items := commercial_access_private.plan_laundry_items('charlotte');
  if v_budgets is not null and coalesce(v_budgets->>'total', '') ~ '^-?\d+(\.\d+)?$' then
    v_total := (v_budgets->>'total')::numeric;
  end if;

  select coalesce(m.base, '{}'::jsonb) into v_base from public.commercial_models m where m.deal_id = v_deal_id limit 1;
  v_rent := 1000;
  v_cap := greatest(0.1, coalesce((v_base->>'valueCapRate')::numeric, 9));
  v_calc := commercial_access_private.compute_opex_view(v_opex, 10, 10, 10 * v_rent, true, v_cap, v_laundry);
  v_noi := (v_calc->>'netYr')::numeric;
  v_val := round((v_calc->>'value')::numeric);

  v_base := (coalesce(v_base, '{}'::jsonb) - 'bridgeRepairs') || jsonb_build_object(
    'rent', 1000,
    'rehab', v_total,
    'opex', v_opex,
    'laundry', v_laundry,
    'vacancyPct', 5,
    'taxes', 13544,
    'insurance', 6500,
    'waterMo', 1000,
    'utilities', 12000,
    'reservesPerUnit', 450,
    'mgmtPct', 0,
    'valueCapRate', v_cap,
    'marketRentLow', coalesce(nullif((v_plan->'marketRent'->>'low')::numeric, 0), 780),
    'marketRentHigh', coalesce(nullif((v_plan->'marketRent'->>'high')::numeric, 0), 1115),
    'value', v_val,
    'valueSource', 'Value by income from operating costs & laundry: ' || commercial_access_private.fmt_money(v_noi) || '/yr NOI ÷ ' || v_cap || '% cap rate = ' || commercial_access_private.fmt_money(v_val) || '.'
  );

  update public.commercial_models
  set base = v_base,
      updated_at = now()
  where deal_id = v_deal_id;

  -- Regenerate saved lead seller_summary + guide for Charlotte so DB matches $142,440 & $743,047 across every view.
  select seller_summary into v_ss
  from public.commercial_offers
  where deal_id = v_deal_id and is_lead = true and seller_summary is not null
  order by sort, updated_at desc
  limit 1;

  if v_ss is not null then
    v_lines := jsonb_build_array(
      jsonb_build_object('key', 'units', 'label', 'Units $74,000', 'detail', '', 'overlay', jsonb_build_array('Total units: $74,000.')),
      jsonb_build_object('key', 'building', 'label', 'Building $10,000', 'detail', '', 'overlay', jsonb_build_array('Total building: $10,000.')),
      jsonb_build_object('key', 'setup', 'label', 'Setup $22,050', 'detail', '', 'overlay', jsonb_build_array('Total setup: $22,050.'))
    );
    v_heading_overlay := jsonb_build_array('Units: $74,000', 'Building: $10,000', 'Setup: $22,050', 'Laundry: $16,390');
    v_parts := array['Units $74,000', 'Building $10,000', 'Setup $22,050'];
    v_l_idx := 0;
    for v_cost_item in select value from jsonb_array_elements(coalesce(v_laundry_items, '[]'::jsonb)) loop
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'key', 'laundry-' || v_l_idx,
        'label', (v_cost_item->>'label') || ' — ' || commercial_access_private.fmt_money((v_cost_item->>'cost')::numeric),
        'title', v_cost_item->>'label',
        'amount', (v_cost_item->>'cost')::numeric,
        'detail', '',
        'overlay', jsonb_build_array(coalesce(v_cost_item->>'source', ''), (v_cost_item->>'label') || ': ' || commercial_access_private.fmt_money((v_cost_item->>'cost')::numeric))
      ));
      v_parts := array_append(v_parts, (v_cost_item->>'label') || ' — ' || commercial_access_private.fmt_money((v_cost_item->>'cost')::numeric));
      v_l_idx := v_l_idx + 1;
    end loop;
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('key', 'contingency', 'label', 'Contingency $20,000', 'detail', '', 'overlay', jsonb_build_array('Repair contingency: $20,000.'))
    );
    v_parts := array_append(v_parts, 'Contingency $20,000');
    v_heading_overlay := v_heading_overlay || jsonb_build_array('Rehab subtotal: $122,440', 'Contingency: $20,000', 'Total with contingency: $142,440.');

    v_ss := jsonb_set(v_ss, '{stepBudgets}', v_budgets, true);
    v_ss := jsonb_set(v_ss, '{laundryItems}', v_laundry_items, true);
    v_ss := jsonb_set(v_ss, '{refiLine}', to_jsonb('Your payments grow as units are rented, up to $2,710 a month, then you are paid back in full: $416,460.'::text), true);

    if jsonb_typeof(v_ss->'terms') = 'array' then
      v_terms := v_ss->'terms';
      for v_term in select value from jsonb_array_elements(v_terms) loop
        case v_term->>'label'
          when 'Renovation note' then
            v_term := jsonb_build_object('label', 'Renovation note', 'value', '$127,940', 'overlay', jsonb_build_array('Repair budget: $142,440', 'Closing costs: $5,500', 'Contingency: $20,000, added only if used', 'A second seller note. Paid from rent as units are rented, then paid back in full.'));
          when 'Renovation note rate' then
            v_term := jsonb_build_object('label', 'Renovation note rate', 'value', '8% a year', 'overlay', jsonb_build_array('$853/mo when your payments are full.'));
          when 'Your payments' then
            v_term := jsonb_build_object('label', 'Your payments', 'value', 'Up to $2,710/mo', 'overlay', jsonb_build_array('Purchase note: $1,857/mo', 'Renovation note: $853/mo', 'Full payment: $2,710/mo, at 6 units rented.', 'Payments start as units are rented and grow with each one. Rent pays the holding bills first, then you. Any part not paid yet is added to what you are paid back.'));
          when 'Paid back in full' then
            v_term := jsonb_build_object('label', 'Paid back in full', 'value', '$416,460', 'overlay', jsonb_build_array('Purchase note: $275,000', 'Renovation note: $127,940', 'Deferred holding costs: $13,520', 'Total paid back: $416,460, on top of your payments from rent.'));
          else null;
        end case;
        v_new_terms := v_new_terms || jsonb_build_array(v_term);
      end loop;
      v_ss := jsonb_set(v_ss, '{terms}', v_new_terms, true);
    end if;

    if jsonb_typeof(v_ss->'steps') = 'array' then
      v_offer_steps := v_ss->'steps';
      for v_ostep in select value from jsonb_array_elements(v_offer_steps) loop
        case v_ostep->>'title'
          when 'Repairs' then
            v_ostep := jsonb_build_object(
              'title', 'Repairs',
              'detail', 'You fund the repairs with a second seller note, $127,940, at 8% a year, plus a $20,000 contingency only if it''s needed. The buyer runs the work.',
              'overlay', jsonb_build_array(
                'Units $74,000',
                'Building $10,000',
                'Setup $22,050',
                'Two Speed Queen stacked washer/dryer units (deliver, install, 5-yr parts/labor) — $10,154',
                'KioSoft Ultra V2 card readers (2) + Ethernet hub + kiosk setup — $1,676',
                '240V electrical drops, plumbing tie-ins, 4-inch galvanized venting — $2,560',
                'Cleanout, epoxy floor, LED light, folding table in basement laundry room — $2,000',
                'Contingency $20,000',
                '$853/mo when your payments are full.'
              )
            );
          when 'Paid as units are rented' then
            v_ostep := jsonb_build_object(
              'title', 'Paid as units are rented',
              'detail', 'Your payments start as units are rented and grow with each one. Rent pays the property tax, insurance, water and trash first, then you. At 6 units rented you get the full $2,710 a month: $1,857 on the purchase note and $853 on the renovation note. Any part not paid before then is added to what you are paid back.',
              'overlay', jsonb_build_array('Purchase note: $1,857/mo', 'Renovation note: $853/mo', 'Full payment: $2,710/mo, at 6 units rented.', 'Payments start as units are rented and grow with each one. Rent pays the holding bills first, then you. Any part not paid yet is added to what you are paid back.')
            );
          when 'Paid back in full' then
            v_ostep := jsonb_build_object(
              'title', 'Paid back in full',
              'detail', 'You are paid back in full, $416,460, on top of your payments from rent.',
              'overlay', jsonb_build_array('Purchase note: $275,000', 'Renovation note: $127,940', 'Deferred holding costs: $13,520', 'Total paid back: $416,460, on top of your payments from rent.')
            );
          else null;
        end case;
        v_new_osteps := v_new_osteps || jsonb_build_array(v_ostep);
      end loop;
      v_ss := jsonb_set(v_ss, '{steps}', v_new_osteps, true);
    end if;

    v_guide := v_ss->'guide';
    if jsonb_typeof(v_guide) = 'object' then
      v_cs := coalesce(v_guide->'costSummary', '{}'::jsonb) || jsonb_build_object(
        'heading', 'Repair budget $142,440',
        'headingOverlay', v_heading_overlay,
        'oneLine', 'Repair budget $142,440 — ' || array_to_string(v_parts, ', '),
        'total', 142440,
        'rehabTotal', 122440,
        'contingency', 20000,
        'stepBudgets', v_budgets,
        'laundryItems', v_laundry_items,
        'lines', v_lines
      );
      v_guide := jsonb_set(v_guide, '{costSummary}', v_cs, true);
      v_guide := jsonb_set(v_guide, '{cost}', v_lines, true);
      v_guide := jsonb_set(v_guide, '{costHeading}', to_jsonb('Repair budget $142,440'::text), true);
      if jsonb_typeof(v_guide->'bridge') = 'object' then
        v_guide := jsonb_set(v_guide, '{bridge,repairs}', to_jsonb(142440), true);
      end if;

      v_refi := coalesce(v_guide->'refi', '{}'::jsonb) || jsonb_build_object(
        'renoNotePrincipal', v_reno_amt,
        'repairLoanPayoff', v_reno_amt,
        'repairLoanPayoffContUsed', v_reno_amt + 20000,
        'repairLoanOverlay', jsonb_build_array(
          'Repair budget: $142,440',
          'Closing costs: $5,500',
          'Contingency: $20,000, added only if used',
          '8% interest only, no points.',
          'Seller renovation note paid off: $127,940.'
        ),
        'deferred', jsonb_build_object(
          'bills', v_def_bills,
          'purchaseNote', v_def_pnote,
          'renoNote', v_def_rnote,
          'total', v_def_total
        ),
        'sellerCarriedBills', v_def_total,
        'sellerCarriedBillsOverlay', jsonb_build_array(
          'Holding bills rent did not cover yet: $5,011',
          'Purchase note payments that waited: $5,570',
          'Renovation note payments that waited: $2,939',
          'Paid to the seller at the refi: $13,520.'
        ),
        'sellerPayoff', v_seller_payoff,
        'sellerPayoffText', '$288,520',
        'sellerTotalPayoff', v_seller_total,
        'sellerPayoffOverlay', jsonb_build_array('Seller’s note $275,000 paid off at refinance. Plus $13,520 in deferred holding costs.'),
        'renoCompare', jsonb_build_object(
          'sellerRate', 8,
          'sellerAmount', v_reno_amt,
          'sellerMo', v_reno_mo,
          'regularRate', 11,
          'regularPointsPct', 2.5,
          'regularPoints', v_reg_pts,
          'regularLoan', v_reg_loan,
          'regularMo', v_reg_mo
        )
      );
      v_guide := jsonb_set(v_guide, '{refi}', v_refi, true);
      v_guide := commercial_access_private.apply_opex_to_guide(v_guide, v_opex, v_plan, v_base, v_total);
      v_ss := jsonb_set(v_ss, '{guide}', v_guide, true);
    end if;

    update public.commercial_offers
    set seller_summary = v_ss,
        updated_at = now()
    where deal_id = v_deal_id and is_lead = true and seller_summary is not null;
  end if;
end
$$;

notify pgrst, 'reload schema';
commit;
