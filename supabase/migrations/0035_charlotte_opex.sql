-- Charlotte single-source opex block in commercial_settings ('deal_plan:charlotte'),
-- live opex derivation in commercial_access_private.get_lead_guide, and model/guide sync.
-- Additive and idempotent. Scoped strictly to public.commercial_* and commercial_access_private.*.
begin;

-- 1. Money formatting + PV/PMT helpers inside commercial_access_private.
create or replace function commercial_access_private.fmt_money(p_val numeric)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_val is null then '—'
    when p_val < 0 then '−$' || to_char(round(abs(p_val)), 'FM999,999,999')
    else '$' || to_char(round(abs(p_val)), 'FM999,999,999')
  end
$$;

create or replace function commercial_access_private.pv_cap(p_rate numeric, p_years numeric, p_payment numeric)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_r numeric := coalesce(p_rate, 0) / 100.0 / 12.0;
  v_n numeric := coalesce(p_years, 0) * 12.0;
begin
  if coalesce(p_payment, 0) <= 0 or v_n <= 0 then
    return 0;
  end if;
  if v_r = 0 then
    return p_payment * v_n;
  end if;
  return (p_payment * (1.0 - power(1.0 + v_r, -v_n))) / v_r;
end
$$;

revoke all on function commercial_access_private.fmt_money(numeric) from public, anon, authenticated;
revoke all on function commercial_access_private.pv_cap(numeric, numeric, numeric) from public, anon, authenticated;

-- 2. Read opex block from deal_plan:<slug>.
create or replace function commercial_access_private.plan_opex(p_slug text)
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
  if jsonb_typeof(v_plan) <> 'object' or jsonb_typeof(v_plan->'opex') <> 'object' then
    return null;
  end if;
  return v_plan->'opex';
end
$$;

revoke all on function commercial_access_private.plan_opex(text) from public, anon, authenticated;

-- 3. Pure opex view computation matching src/lib/opex.js computeOpex().
create or replace function commercial_access_private.compute_opex_view(
  p_opex jsonb,
  p_units numeric,
  p_rented numeric,
  p_gross_mo numeric,
  p_apply_vacancy boolean,
  p_cap_rate numeric
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
  v_mgmt_pct numeric := greatest(0, coalesce((p_opex->>'mgmtHelpPct')::numeric, 0));
  v_mgmt_yr numeric := v_gross_yr * (v_mgmt_pct / 100.0);
  v_wifi numeric := greatest(0, coalesce((p_opex->>'wifiAnnual')::numeric, 0));
  v_cam numeric := greatest(0, coalesce((p_opex->>'camerasAnnual')::numeric, 0));
  v_reg_unit numeric := greatest(0, coalesce((p_opex->>'rentalRegPerUnitAnnual')::numeric, 0));
  v_reg_yr numeric := v_units * v_reg_unit;
  v_snow numeric := greatest(0, coalesce((p_opex->>'snowLawnAnnual')::numeric, 0));

  v_costs_yr numeric := v_taxes + v_ins + v_water + v_heat + v_res_yr + v_rm_yr + v_mgmt_yr + v_wifi + v_cam + v_reg_yr + v_snow;
  v_costs_mo numeric := v_costs_yr / 12.0;
  v_noi_yr numeric := v_eff_yr - v_costs_yr;
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
    v_overlay := v_overlay || jsonb_build_array('Management help (' || v_mgmt_pct || '%): ' || commercial_access_private.fmt_money(v_mgmt_yr / 12.0) || '/mo (' || commercial_access_private.fmt_money(v_mgmt_yr) || '/yr)' || coalesce(' — ' || v_s, ''));
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
    'netYr', v_noi_yr,
    'noiMo', v_noi_mo,
    'value', v_val,
    'vacancyPct', v_vac_pct,
    'costsOverlay', v_overlay,
    'vacancyOverlayLine', v_vac_line
  );
end
$$;

revoke all on function commercial_access_private.compute_opex_view(jsonb, numeric, numeric, numeric, boolean, numeric) from public, anon, authenticated;

-- 4. Helper to rebuild guide's opex, rentValue views/grid/marketRange, and refi numbers from one opex block.
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
begin
  if g is null or p_opex is null or jsonb_typeof(p_opex) <> 'object' then
    return g;
  end if;

  g := jsonb_set(g, '{opex}', p_opex, true);

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

  v_asis_c := commercial_access_private.compute_opex_view(p_opex, v_units, v_asis_rented, v_asis_gross, false, v_cap);
  v_after_c := commercial_access_private.compute_opex_view(p_opex, v_units, v_units, v_units * v_our_rent, true, v_cap);
  v_mkt_c := commercial_access_private.compute_opex_view(p_opex, v_units, v_units, v_market_gross, true, v_cap);

  v_mkt_rent_overlay := v_mkt_rent_overlay || jsonb_build_array(v_mkt_c->>'vacancyOverlayLine');

  v_views := jsonb_build_array(
    jsonb_build_object(
      'key', 'asis',
      'label', 'As is',
      'rented', v_asis_rented,
      'total', v_units,
      'rentMo', (v_asis_c->>'rentMo')::numeric,
      'costsMo', (v_asis_c->>'costsMo')::numeric,
      'netYr', (v_asis_c->>'netYr')::numeric,
      'value', (v_asis_c->>'value')::numeric,
      'allIn', v_buyout,
      'rentOverlay', jsonb_build_array(round(v_asis_rented) || ' of ' || round(v_units) || ' rented today'),
      'costsOverlay', v_asis_c->'costsOverlay',
      'netOverlay', jsonb_build_array('(' || commercial_access_private.fmt_money((v_asis_c->>'rentMo')::numeric) || ' − ' || commercial_access_private.fmt_money((v_asis_c->>'costsMo')::numeric) || ') × 12 = ' || commercial_access_private.fmt_money((v_asis_c->>'netYr')::numeric) || '/yr'),
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
      'netYr', (v_after_c->>'netYr')::numeric,
      'value', (v_after_c->>'value')::numeric,
      'allIn', v_all_in,
      'rentOverlay', jsonb_build_array(round(v_units) || ' × ' || commercial_access_private.fmt_money(v_our_rent) || '/mo = ' || commercial_access_private.fmt_money(v_units * v_our_rent) || '/mo', v_after_c->>'vacancyOverlayLine'),
      'costsOverlay', v_after_c->'costsOverlay',
      'netOverlay', jsonb_build_array('(' || commercial_access_private.fmt_money((v_after_c->>'rentMo')::numeric) || ' − ' || commercial_access_private.fmt_money((v_after_c->>'costsMo')::numeric) || ') × 12 = ' || commercial_access_private.fmt_money((v_after_c->>'netYr')::numeric) || '/yr'),
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
      'netYr', (v_mkt_c->>'netYr')::numeric,
      'value', (v_mkt_c->>'value')::numeric,
      'allIn', v_all_in,
      'rentOverlay', v_mkt_rent_overlay,
      'costsOverlay', v_mkt_c->'costsOverlay',
      'netOverlay', jsonb_build_array('(' || commercial_access_private.fmt_money((v_mkt_c->>'rentMo')::numeric) || ' − ' || commercial_access_private.fmt_money((v_mkt_c->>'costsMo')::numeric) || ') × 12 = ' || commercial_access_private.fmt_money((v_mkt_c->>'netYr')::numeric) || '/yr'),
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
    v_row_c := commercial_access_private.compute_opex_view(p_opex, v_units, v_units, v_units * v_r, true, v_cap);
    v_cells := '[]'::jsonb;
    for v_k in 0..3 loop
      v_c := v_cap + v_k;
      v_c_val := greatest(0, (v_row_c->>'netYr')::numeric / (v_c / 100.0));
      v_cells := v_cells || jsonb_build_array(jsonb_build_object(
        'cap', v_c,
        'value', v_c_val,
        'clears', v_c_val >= v_all_in,
        'stabilized', (v_r = v_our_rent and v_c = v_cap),
        'overlay', jsonb_build_array(
          round(v_units) || ' units × ' || commercial_access_private.fmt_money(v_r) || '/mo, less ' || (v_row_c->>'vacancyPct') || '% vacancy: ' || commercial_access_private.fmt_money((v_row_c->>'rentMo')::numeric) || '/mo',
          'Less costs: ' || commercial_access_private.fmt_money((v_row_c->>'costsMo')::numeric) || '/mo',
          commercial_access_private.fmt_money((v_row_c->>'netYr')::numeric) || '/yr ÷ ' || v_c || '% = ' || commercial_access_private.fmt_money(v_c_val),
          'All in: ' || commercial_access_private.fmt_money(v_all_in)
        )
      ));
    end loop;
    v_grid := v_grid || jsonb_build_array(jsonb_build_object('rent', v_r, 'cells', v_cells));
  end loop;

  if jsonb_typeof(g->'rentValue') = 'object' then
    g := jsonb_set(g, '{rentValue,allIn}', to_jsonb(v_all_in), true);
    g := jsonb_set(g, '{rentValue,buyout}', to_jsonb(v_buyout), true);
    g := jsonb_set(g, '{rentValue,repairs}', to_jsonb(v_repairs), true);
    g := jsonb_set(g, '{rentValue,views}', v_views, true);
    g := jsonb_set(g, '{rentValue,caps}', v_caps, true);
    g := jsonb_set(g, '{rentValue,grid}', v_grid, true);
    g := g #- '{rentValue,valueRange}';
    if v_low is not null and v_high is not null and v_high >= v_low and v_low > 0 then
      g := jsonb_set(g, '{rentValue,marketRange}', jsonb_build_object(
        'low', v_low,
        'high', v_high,
        'units', v_units,
        'vacancyPct', (v_after_c->>'vacancyPct')::numeric,
        'costsMo', (v_after_c->>'costsMo')::numeric,
        'capRate', v_cap,
        'allIn', v_all_in,
        'opex', p_opex
      ), true);
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
      'estimatedValueOverlay', jsonb_build_array(
        'Value by income',
        'Full-occupancy NOI ' || commercial_access_private.fmt_money((v_after_c->>'netYr')::numeric) || '/yr (' || commercial_access_private.fmt_money((v_after_c->>'noiMo')::numeric) || '/mo after operating costs) ÷ ' || v_cap || '% cap rate = ' || commercial_access_private.fmt_money(v_est_val) || '.'
      ),
      'loanOverlay', jsonb_build_array(
        'Lower of ' || v_refi_dscr || 'x DSCR loan (' || commercial_access_private.fmt_money(v_loan_dscr) || ') and ' || v_refi_ltv || '% of value (' || commercial_access_private.fmt_money(v_loan_ltv) || ') at ' || v_refi_rate || '% / ' || round(v_refi_years) || ' yrs.'
      )
    ), true);
  end if;

  return g;
end
$$;

revoke all on function commercial_access_private.apply_opex_to_guide(jsonb, jsonb, jsonb, jsonb, numeric) from public, anon, authenticated;

-- 5. Keep get_lead_guide synced to both live repair budgets and live opex (never exposed to seller).
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
  v_opex jsonb;
  v_plan_raw text;
  v_plan jsonb := '{}'::jsonb;
  v_base jsonb := '{}'::jsonb;
  v_total numeric := 0;
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

  v_opex := commercial_access_private.plan_opex(v_slug);
  if v_opex is not null then
    select s.value into v_plan_raw from public.commercial_settings s where s.key = 'deal_plan:' || btrim(v_slug) limit 1;
    begin
      if v_plan_raw is not null and btrim(v_plan_raw) <> '' then
        v_plan := v_plan_raw::jsonb;
      end if;
    exception when others then
      v_plan := '{}'::jsonb;
    end;
    select coalesce(m.base, '{}'::jsonb) into v_base from public.commercial_models m where m.deal_id = p_deal limit 1;
    g := commercial_access_private.apply_opex_to_guide(g, v_opex, v_plan, coalesce(v_base, '{}'::jsonb), v_total);
  end if;

  if r = 'reviewer' and g is not null then g := g #- '{rentValue,marketRange}'; end if;
  return g;
end
$function$;

-- 6. Seed Charlotte owner-approved opex block in commercial_settings ('deal_plan:charlotte') and sync models/offers guide.
do $$
declare
  v_deal_id uuid;
  v_raw text;
  v_plan jsonb := '{}'::jsonb;
  v_opex jsonb;
  v_budgets jsonb;
  v_total numeric := 0;
  v_base jsonb := '{}'::jsonb;
  v_rent numeric := 1000;
  v_cap numeric := 9;
  v_calc jsonb;
  v_noi numeric;
  v_val numeric;
  v_guide jsonb;
begin
  select d.id into v_deal_id from public.commercial_deals d where d.slug = 'charlotte' limit 1;
  if v_deal_id is null then
    return;
  end if;

  v_opex := jsonb_build_object(
    'taxesAnnual', 13544,
    'insuranceAnnual', 6500,
    'waterSewerTrashAnnual', 12000,
    'heatGasAnnual', 0,
    'reservesPerUnitAnnual', 450,
    'vacancyPct', 5,
    'repairsMaintPct', 8,
    'mgmtHelpPct', 0.5,
    'wifiAnnual', 840,
    'camerasAnnual', 200,
    'rentalRegPerUnitAnnual', 15,
    'snowLawnAnnual', 3000,
    'sources', jsonb_build_object(
      'taxes', '2025 county bill',
      'waterSewerTrash', 'Trash is billed with water; second dumpster = $0',
      'heatGas', 'Tenants pay their own',
      'reserves', 'CapEx / replacement reserves ($450/unit/yr; no separate 8% CapEx)',
      'vacancy', '5% of rent',
      'repairsMaint', '8% of rent',
      'mgmtHelp', '0.5% of rent (no management fee line)',
      'wifi', '$70/mo for smart locks',
      'cameras', 'Wyze Cam Unlimited Pro',
      'rentalReg', 'City of Akron ($15/unit/yr)',
      'snowLawn', 'Snow and lawn'
    )
  );

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

  v_plan := jsonb_set(v_plan, '{opex}', v_opex, true);
  insert into public.commercial_settings (key, value)
  values ('deal_plan:charlotte', v_plan::text)
  on conflict (key) do update set value = excluded.value;

  v_budgets := commercial_access_private.plan_step_budgets('charlotte');
  if v_budgets is not null and coalesce(v_budgets->>'total', '') ~ '^-?\d+(\.\d+)?$' then
    v_total := (v_budgets->>'total')::numeric;
  end if;

  select coalesce(m.base, '{}'::jsonb) into v_base from public.commercial_models m where m.deal_id = v_deal_id limit 1;
  v_rent := greatest(0, coalesce((v_base->>'rent')::numeric, 1000));
  v_cap := greatest(0.1, coalesce((v_base->>'valueCapRate')::numeric, 9));
  v_calc := commercial_access_private.compute_opex_view(v_opex, 10, 10, 10 * v_rent, true, v_cap);
  v_noi := (v_calc->>'netYr')::numeric;
  v_val := round((v_calc->>'value')::numeric);

  v_base := (coalesce(v_base, '{}'::jsonb) - 'bridgeRepairs') || jsonb_build_object(
    'opex', v_opex,
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
    'valueSource', 'Value by income from operating costs: ' || commercial_access_private.fmt_money(v_noi) || '/yr NOI ÷ ' || v_cap || '% cap rate = ' || commercial_access_private.fmt_money(v_val) || '.'
  );
  if v_total > 0 then
    v_base := v_base || jsonb_build_object('rehab', v_total);
  end if;

  update public.commercial_models
  set base = v_base,
      updated_at = now()
  where deal_id = v_deal_id;

  select seller_summary->'guide' into v_guide
  from public.commercial_offers
  where deal_id = v_deal_id and is_lead = true and seller_summary is not null
  order by sort, updated_at desc
  limit 1;

  if v_guide is not null then
    v_guide := commercial_access_private.apply_opex_to_guide(v_guide, v_opex, v_plan, v_base, v_total);
    update public.commercial_offers
    set seller_summary = jsonb_set(seller_summary, '{guide}', v_guide, true),
        updated_at = now()
    where deal_id = v_deal_id and is_lead = true and seller_summary is not null;
  end if;
end
$$;

notify pgrst, 'reload schema';
commit;
