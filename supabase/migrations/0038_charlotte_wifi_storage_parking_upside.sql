-- Charlotte Wi-Fi (+$30/unit included; Spectrum Business $1,140/yr),
-- one-time budget items (+$1,500 Wi-Fi APs, +$1,500 10 storage cages, +$500 10 parking spots -> $145,940 total),
-- Upside (not counted in NOI/value/DSCR/Seller),
-- consolidated Seller plan (5 steps) & protections (4 bullets) & Private protections (4 bullets),
-- flat $15,000 refi fees and removal of phantom $15,773 lender reserve.
-- Additive and idempotent. Scoped strictly to public.commercial_* and commercial_access_private.*.
begin;

-- 1. Update compute_opex_view to support wifiRentAddPerUnit and custom wifiLabel.
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
  v_base_gross_mo numeric := greatest(0, coalesce(p_gross_mo, 0));
  v_wifi_add_unit numeric := greatest(0, coalesce((p_opex->>'wifiRentAddPerUnit')::numeric, 0));
  v_wifi_add_mo numeric := case when v_base_gross_mo > 0 then v_rented * v_wifi_add_unit else 0 end;
  v_gross_mo numeric := v_base_gross_mo + v_wifi_add_mo;
  v_gross_yr numeric := v_gross_mo * 12.0;
  v_vac_pct numeric := greatest(0, coalesce((p_opex->>'vacancyPct')::numeric, 0));
  v_vac_yr numeric := case when coalesce(p_apply_vacancy, true) then v_gross_yr * (v_vac_pct / 100.0) else 0 end;
  v_eff_yr numeric := v_gross_yr - v_vac_yr;
  v_eff_mo numeric := v_eff_yr / 12.0;

  v_taxes numeric := greatest(0, coalesce((p_opex->>'taxesAnnual')::numeric, 0));
  v_ins numeric := greatest(0, coalesce((p_opex->>'insuranceAnnual')::numeric, 0));
  v_water numeric := greatest(0, coalesce((p_opex->>'waterSewerTrashAnnual')::numeric, 0));
  v_common_util numeric := greatest(0, coalesce((p_opex->>'commonAreaUtilitiesAnnual')::numeric, 0));
  v_res_unit numeric := greatest(0, coalesce((p_opex->>'reservesPerUnitAnnual')::numeric, 0));
  v_res_yr numeric := v_rented * v_res_unit;
  v_rm_pct numeric := greatest(0, coalesce((p_opex->>'repairsMaintPct')::numeric, 0));
  v_rm_yr numeric := v_gross_yr * (v_rm_pct / 100.0);
  v_mgmt_flat numeric := greatest(0, coalesce((p_opex->>'mgmtHelpAnnual')::numeric, 0));
  v_mgmt_pct numeric := greatest(0, coalesce((p_opex->>'mgmtHelpPct')::numeric, 0));
  v_mgmt_yr numeric := case when v_mgmt_flat > 0 then v_mgmt_flat else v_gross_yr * (v_mgmt_pct / 100.0) end;
  v_wifi numeric := greatest(0, coalesce((p_opex->>'wifiAnnual')::numeric, 0));
  v_wifi_label text := coalesce(nullif(btrim(coalesce(p_opex->>'wifiLabel', '')), ''), 'Wi-Fi (smart locks)');
  v_cam numeric := greatest(0, coalesce((p_opex->>'camerasAnnual')::numeric, 0));
  v_reg_unit numeric := greatest(0, coalesce((p_opex->>'rentalRegPerUnitAnnual')::numeric, 0));
  v_reg_yr numeric := v_units * v_reg_unit;
  v_snow numeric := greatest(0, coalesce((p_opex->>'snowLawnAnnual')::numeric, 0));

  v_costs_yr numeric := v_taxes + v_ins + v_water + v_common_util + v_res_yr + v_rm_yr + v_mgmt_yr + v_wifi + v_cam + v_reg_yr + v_snow;
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

  if v_common_util > 0 then
    v_s := nullif(btrim(coalesce(v_src->>'commonAreaUtilities', '')), '');
    v_overlay := v_overlay || jsonb_build_array('Common-area gas & electric: ' || commercial_access_private.fmt_money(v_common_util / 12.0) || '/mo (' || commercial_access_private.fmt_money(v_common_util) || '/yr)' || coalesce(' — ' || v_s, ''));
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
    v_overlay := v_overlay || jsonb_build_array(v_wifi_label || ': ' || commercial_access_private.fmt_money(v_wifi / 12.0) || '/mo (' || commercial_access_private.fmt_money(v_wifi) || '/yr)' || coalesce(' — ' || v_s, ''));
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
    'baseGrossMo', v_base_gross_mo,
    'wifiRentAddPerUnit', v_wifi_add_unit,
    'wifiRentAddMo', v_wifi_add_mo,
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

-- 2. Update apply_opex_to_guide to propagate upside, Wi-Fi rent add, and flat refi fees ($0 reserve).
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
  v_wifi_add numeric := greatest(0, coalesce((p_opex->>'wifiRentAddPerUnit')::numeric, 0));
  v_eff_unit_rent numeric := case when v_our_rent > 0 then v_our_rent + v_wifi_add else 0 end;
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
  v_upside jsonb := coalesce(
    case when jsonb_typeof(p_opex->'upside') = 'object' then p_opex->'upside' end,
    case when jsonb_typeof(p_plan->'upside') = 'object' then p_plan->'upside' end,
    case when jsonb_typeof(p_base->'upside') = 'object' then p_base->'upside' end,
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
  v_after_rent_line text;
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
  v_fees_pct numeric := coalesce((p_base->>'refiFeesPct')::numeric, (g->'refi'->>'feesPct')::numeric, 0);
  v_fees_flat numeric := coalesce((p_base->>'refiFeesFlat')::numeric, (g->'refi'->>'feesFlat')::numeric, 15000);
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
  v_row_rent_line text;
begin
  if g is null or p_opex is null or jsonb_typeof(p_opex) <> 'object' then
    return g;
  end if;

  g := jsonb_set(g, '{opex}', p_opex, true);
  if v_laundry is not null then
    g := jsonb_set(g, '{laundry}', v_laundry, true);
  end if;
  if v_upside is not null then
    g := jsonb_set(g, '{upside}', v_upside, true);
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
  v_after_rent_line := case
    when v_wifi_add > 0 then round(v_units) || ' × (' || commercial_access_private.fmt_money(v_our_rent) || ' + ' || commercial_access_private.fmt_money(v_wifi_add) || ' Wi-Fi)/mo = ' || commercial_access_private.fmt_money((v_after_c->>'grossMo')::numeric) || '/mo'
    else round(v_units) || ' × ' || commercial_access_private.fmt_money(v_our_rent) || '/mo = ' || commercial_access_private.fmt_money(v_units * v_our_rent) || '/mo'
  end;

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
      'rentOverlay', jsonb_build_array(v_after_rent_line, v_after_c->>'vacancyOverlayLine'),
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
    v_row_rent_line := case
      when v_wifi_add > 0 then round(v_units) || ' units × (' || commercial_access_private.fmt_money(v_r) || ' + ' || commercial_access_private.fmt_money(v_wifi_add) || ' Wi-Fi)/mo, less ' || (v_row_c->>'vacancyPct') || '% vacancy: ' || commercial_access_private.fmt_money((v_row_c->>'rentMo')::numeric) || '/mo'
      else round(v_units) || ' units × ' || commercial_access_private.fmt_money(v_r) || '/mo, less ' || (v_row_c->>'vacancyPct') || '% vacancy: ' || commercial_access_private.fmt_money((v_row_c->>'rentMo')::numeric) || '/mo'
    end;
    for v_k in 0..3 loop
      v_c := v_cap + v_k;
      v_c_val := greatest(0, (v_row_c->>'netYr')::numeric / (v_c / 100.0));
      v_cell_overlay := jsonb_build_array(v_row_rent_line);
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
    g := jsonb_set(g, '{rentValue,effectiveOurRent}', to_jsonb(v_eff_unit_rent), true);
    g := jsonb_set(g, '{rentValue,wifiRentAddPerUnit}', to_jsonb(v_wifi_add), true);
    g := jsonb_set(g, '{rentValue,defaultRent}', to_jsonb(v_our_rent), true);
    g := jsonb_set(g, '{rentValue,views}', v_views, true);
    g := jsonb_set(g, '{rentValue,caps}', v_caps, true);
    g := jsonb_set(g, '{rentValue,grid}', v_grid, true);
    g := g #- '{rentValue,valueRange}';
    if v_upside is not null then
      g := jsonb_set(g, '{rentValue,upside}', v_upside, true);
    end if;
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
        'laundry', v_laundry,
        'upside', v_upside
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
      'feesPct', v_fees_pct,
      'feesPctAmt', v_fees_amt,
      'feesFlat', v_fees_flat,
      'reserve', v_reserve,
      'inHand', v_in_hand,
      'inHandOverlay', jsonb_strip_nulls(jsonb_build_array(
        'Loan: ' || commercial_access_private.fmt_money(v_loan),
        case when v_fees_amt > 0 then 'Fees (' || v_fees_pct || '%): −' || commercial_access_private.fmt_money(v_fees_amt) end,
        case when v_fees_flat > 0 then case when v_fees_amt > 0 then 'Flat fees: −' else 'Refi fees (' || commercial_access_private.fmt_money(v_fees_flat) || ' flat): −' end || commercial_access_private.fmt_money(v_fees_flat) end,
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

-- 3. Update get_lead_guide to build structured items[] for collapsible CostSummary and propagate upside.
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
  v_unit_items jsonb := '[]'::jsonb;
  v_bldg_items jsonb := '[]'::jsonb;
  v_setup_items jsonb := '[]'::jsonb;
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

      if jsonb_typeof(v_plan->'units') = 'array' then
        for v_item in select value from jsonb_array_elements(v_plan->'units') loop
          if coalesce((v_item->>'rehab')::numeric, 0) > 0 then
            v_unit_items := v_unit_items || jsonb_build_array(jsonb_build_object(
              'key', 'unit-' || coalesce(v_item->>'id', ''),
              'label', 'Unit ' || coalesce(v_item->>'id', ''),
              'amount', (v_item->>'rehab')::numeric,
              'overlay', jsonb_build_array('Unit ' || coalesce(v_item->>'id', '') || ': ' || commercial_access_private.fmt_money((v_item->>'rehab')::numeric))
            ));
          end if;
        end loop;
      end if;

      if jsonb_typeof(v_plan->'costs') = 'array' then
        v_idx := 0;
        for v_item in select value from jsonb_array_elements(v_plan->'costs') loop
          v_l_cost := greatest(0, coalesce((v_item->>'cost')::numeric, 0));
          if v_l_cost <= 0 then
            continue;
          end if;
          v_l_label := coalesce(v_item->>'label', '');
          v_l_src := nullif(btrim(coalesce(v_item->>'source', '')), '');
          if lower(coalesce(v_item->>'group', '')) = 'systems' then
            v_bldg_amt := v_bldg_amt + v_l_cost;
            v_bldg_items := v_bldg_items || jsonb_build_array(jsonb_build_object(
              'key', 'sys-' || v_idx,
              'label', v_l_label,
              'amount', v_l_cost,
              'overlay', case when v_l_src is not null
                then jsonb_build_array(v_l_src, v_l_label || ': ' || commercial_access_private.fmt_money(v_l_cost))
                else jsonb_build_array(v_l_label || ': ' || commercial_access_private.fmt_money(v_l_cost))
              end
            ));
          elsif lower(coalesce(v_item->>'group', '')) <> 'laundry' and v_l_label !~* '(laundry|washer|dryer)' then
            v_setup_items := v_setup_items || jsonb_build_array(jsonb_build_object(
              'key', 'setup-' || v_idx,
              'label', v_l_label,
              'amount', v_l_cost,
              'overlay', case when v_l_src is not null
                then jsonb_build_array(v_l_src, v_l_label || ': ' || commercial_access_private.fmt_money(v_l_cost))
                else jsonb_build_array(v_l_label || ': ' || commercial_access_private.fmt_money(v_l_cost))
              end
            ));
          end if;
          v_idx := v_idx + 1;
        end loop;
      else
        v_bldg_amt := coalesce((v_budgets->>'building')::numeric, 0);
      end if;
      v_setup_amt := greatest(0, v_rehab_sub - v_units_amt - v_bldg_amt - v_laundry_amt);
      v_heading := 'Repair budget ' || commercial_access_private.fmt_money(v_total);

      v_lines := '[]'::jsonb;
      v_heading_overlay := '[]'::jsonb;
      if v_units_amt > 0 then
        v_lines := v_lines || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
          'key', 'units',
          'label', 'Units ' || commercial_access_private.fmt_money(v_units_amt),
          'title', 'Units',
          'amount', v_units_amt,
          'detail', '',
          'overlay', jsonb_build_array('Total units: ' || commercial_access_private.fmt_money(v_units_amt) || '.'),
          'items', case when jsonb_array_length(v_unit_items) > 0 then v_unit_items end
        )));
        v_heading_overlay := v_heading_overlay || jsonb_build_array('Units: ' || commercial_access_private.fmt_money(v_units_amt));
        v_parts := array_append(v_parts, 'Units ' || commercial_access_private.fmt_money(v_units_amt));
      end if;
      if v_bldg_amt > 0 then
        v_lines := v_lines || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
          'key', 'building',
          'label', 'Building ' || commercial_access_private.fmt_money(v_bldg_amt),
          'title', 'Building',
          'amount', v_bldg_amt,
          'detail', '',
          'overlay', jsonb_build_array('Total building: ' || commercial_access_private.fmt_money(v_bldg_amt) || '.'),
          'items', case when jsonb_array_length(v_bldg_items) > 0 then v_bldg_items end
        )));
        v_heading_overlay := v_heading_overlay || jsonb_build_array('Building: ' || commercial_access_private.fmt_money(v_bldg_amt));
        v_parts := array_append(v_parts, 'Building ' || commercial_access_private.fmt_money(v_bldg_amt));
      end if;
      if v_setup_amt > 0 then
        v_lines := v_lines || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
          'key', 'setup',
          'label', 'Setup ' || commercial_access_private.fmt_money(v_setup_amt),
          'title', 'Setup',
          'amount', v_setup_amt,
          'detail', '',
          'overlay', jsonb_build_array('Total setup: ' || commercial_access_private.fmt_money(v_setup_amt) || '.'),
          'items', case when jsonb_array_length(v_setup_items) > 0 then v_setup_items end
        )));
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

-- 4. Update Charlotte plan, opex, upside, models, protections, steps, and seller_summary atomically.
do $$
declare
  v_deal_id uuid;
  v_raw text;
  v_plan jsonb := '{}'::jsonb;
  v_new_costs jsonb := '[]'::jsonb;
  v_cost_item jsonb;
  v_opex jsonb;
  v_upside jsonb;
  v_laundry jsonb;
  v_laundry_items jsonb;
  v_budgets jsonb;
  v_total numeric := 145940;
  v_cont numeric := 20000;
  v_rehab_sub numeric;
  v_units_amt numeric;
  v_bldg_amt numeric := 0;
  v_laundry_amt numeric := 0;
  v_setup_amt numeric;
  v_base jsonb := '{}'::jsonb;
  v_rent numeric := 1000;
  v_unit_rent numeric := 1030;
  v_cap numeric := 9;
  v_calc jsonb;
  v_noi numeric;
  v_val numeric;
  v_steps jsonb;
  v_protections jsonb;
  v_lender_protections jsonb;
  v_ss jsonb;
  v_guide jsonb;
  v_cs jsonb;
  v_refi jsonb;
  v_note_pay numeric := 1857;
  v_reno_amt numeric;
  v_reno_mo numeric;
  v_bills_mo numeric := (13544.0 + 6500.0 + 12000.0) / 12.0;
  v_def_bills numeric := 0;
  v_def_pnote numeric := 0;
  v_def_rnote numeric := 0;
  v_def_total numeric := 0;
  v_seller_payoff numeric;
  v_seller_total numeric;
  v_seller_covered_at int := null;
  v_reg_loan numeric;
  v_reg_pts numeric := 0;
  v_reg_mo numeric := 0;
  v_lines jsonb := '[]'::jsonb;
  v_unit_items jsonb := '[]'::jsonb;
  v_bldg_items jsonb := '[]'::jsonb;
  v_setup_items jsonb := '[]'::jsonb;
  v_heading_overlay jsonb := '[]'::jsonb;
  v_parts text[] := '{}';
  v_item jsonb;
  v_idx int := 0;
  v_l_label text;
  v_l_cost numeric;
  v_l_src text;
  v_m int;
  v_u int;
  v_rented int;
  v_rent_left numeric;
  v_bills_paid numeric;
  v_note_paid numeric;
  v_note_waits numeric;
  v_reno_paid numeric;
  v_reno_waits numeric;
  v_bills_waits numeric;
  v_bills_lines jsonb;
  v_seller_table jsonb := '[]'::jsonb;
  v_covered text;
  v_terms jsonb;
  v_term jsonb;
  v_new_terms jsonb := '[]'::jsonb;
  v_offer_steps jsonb;
  v_ostep jsonb;
  v_new_osteps jsonb := '[]'::jsonb;
  v_repairs_overlay jsonb := '[]'::jsonb;
  v_old_last jsonb;
  v_last_note numeric;
  v_last_wait numeric;
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

  -- Upsert the 3 new one-time systems items (+$1,500 Wi-Fi APs, +$1,500 10 storage cages, +$500 10 signed parking spots).
  if jsonb_typeof(v_plan->'costs') = 'array' then
    for v_cost_item in select value from jsonb_array_elements(v_plan->'costs') loop
      if coalesce(v_cost_item->>'label', '') ~* '(wi-?fi access points|storage cages:\s*repair|parking:\s*10 signed spots)' then
        continue;
      end if;
      v_new_costs := v_new_costs || jsonb_build_array(v_cost_item);
    end loop;
  end if;

  v_new_costs := v_new_costs || jsonb_build_array(
    jsonb_build_object(
      'start', 1,
      'end', 2,
      'cost', 1500,
      'group', 'systems',
      'label', 'Wi-Fi access points, both buildings',
      'source', 'One-time hardware and wiring for building-wide Wi-Fi across both buildings.'
    ),
    jsonb_build_object(
      'start', 2,
      'end', 4,
      'cost', 1500,
      'group', 'systems',
      'label', 'Storage cages: repair 10',
      'source', 'Estimate until walk-through; wire cages now, upgrade later. 10 basement storage cages (one per unit, included).'
    ),
    jsonb_build_object(
      'start', 2,
      'end', 4,
      'cost', 500,
      'group', 'systems',
      'label', 'Parking: 10 signed spots (signs + paint)',
      'source', 'One assigned spot per unit with signs and stall striping.'
    )
  );

  v_upside := jsonb_build_object(
    'label', 'Upside (not counted)',
    'totalText', '~$9,500+/yr',
    'overlay', jsonb_build_array('Excluded from NOI, value, and DSCR. Lenders do not credit until 12 months of history.'),
    'items', jsonb_build_array(
      jsonb_build_object(
        'key', 'waterRubs',
        'label', 'Water bill-back through the lease (~75% of water/sewer)',
        'valueText', '~$9,000/yr',
        'annual', 9000,
        'overlay', jsonb_build_array('Ohio allows lease-based RUBS; City of Akron keeps the water/sewer account in the deed holder''s name.')
      ),
      jsonb_build_object(
        'key', 'extraParking',
        'label', 'Extra parking spots for sale',
        'valueText', 'TBD',
        'overlay', jsonb_build_array('After 10 assigned spots (one per unit included).')
      ),
      jsonb_build_object(
        'key', 'laundrySupplies',
        'label', 'Laundry-room supplies (bulk-priced below store)',
        'valueText', '~$500/yr net',
        'annual', 500,
        'overlay', jsonb_build_array('Bulk-priced below store, net after restocking.')
      )
    )
  );

  v_opex := (coalesce(v_plan->'opex', '{}'::jsonb) - 'heatGasAnnual') || jsonb_build_object(
    'taxesAnnual', 13544,
    'insuranceAnnual', 6500,
    'waterSewerTrashAnnual', 12000,
    'commonAreaUtilitiesAnnual', 1800,
    'reservesPerUnitAnnual', 450,
    'vacancyPct', 5,
    'repairsMaintPct', 8,
    'mgmtHelpPct', 0,
    'mgmtHelpAnnual', 1200,
    'wifiAnnual', 1140,
    'wifiLabel', 'Building internet (Spectrum Business)',
    'wifiRentAddPerUnit', 30,
    'camerasAnnual', 200,
    'rentalRegPerUnitAnnual', 15,
    'snowLawnAnnual', 3000,
    'upside', v_upside,
    'sources', (coalesce(v_plan->'opex'->'sources', '{}'::jsonb) - 'heatGas') || jsonb_build_object(
      'wifi', 'Spectrum Business ($95/mo full rate after 12-month promo; promo pricing during first year)',
      'refiFees', 'Owner''s 4 Flippin refinance closing statements (~$15,000 flat)'
    )
  );

  v_plan := jsonb_set(v_plan, '{costs}', v_new_costs, true);
  v_plan := jsonb_set(v_plan, '{opex}', v_opex, true);
  v_plan := jsonb_set(v_plan, '{upside}', v_upside, true);
  insert into public.commercial_settings (key, value)
  values ('deal_plan:charlotte', v_plan::text)
  on conflict (key) do update set value = excluded.value;

  v_laundry := case when jsonb_typeof(v_plan->'laundry') = 'object' then v_plan->'laundry' else null end;
  v_budgets := commercial_access_private.plan_step_budgets('charlotte');
  v_laundry_items := commercial_access_private.plan_laundry_items('charlotte');
  if v_budgets is not null and coalesce(v_budgets->>'total', '') ~ '^-?\d+(\.\d+)?$' then
    v_total := (v_budgets->>'total')::numeric;
    v_cont := coalesce((v_budgets->>'contingency')::numeric, 0);
  end if;
  v_rehab_sub := greatest(0, v_total - v_cont);
  v_units_amt := coalesce((v_budgets->>'units')::numeric, 0);
  v_laundry_amt := coalesce((v_budgets->>'laundry')::numeric, 0);

  select coalesce(m.base, '{}'::jsonb) into v_base from public.commercial_models m where m.deal_id = v_deal_id limit 1;
  v_rent := greatest(1, coalesce(nullif((v_base->>'rent')::numeric, 0), 1000));
  v_unit_rent := v_rent + 30;
  v_cap := greatest(0.1, coalesce(nullif((v_base->>'valueCapRate')::numeric, 0), 9));
  v_calc := commercial_access_private.compute_opex_view(v_opex, 10, 10, 10 * v_rent, true, v_cap, v_laundry);
  v_noi := (v_calc->>'netYr')::numeric;
  v_val := round((v_calc->>'value')::numeric);

  v_base := (coalesce(v_base, '{}'::jsonb) - 'bridgeRepairs') || jsonb_build_object(
    'rent', v_rent,
    'rehab', v_total,
    'opex', v_opex,
    'upside', v_upside,
    'value', v_val,
    'valueSource', 'Value by income from operating costs & laundry: ' || commercial_access_private.fmt_money(v_noi) || '/yr NOI ÷ ' || v_cap || '% cap rate = ' || commercial_access_private.fmt_money(v_val) || '.',
    'refiFeesPct', 0,
    'refiFeesFlat', 15000,
    'refiReserve', 0,
    'refiFeesSource', 'Owner''s 4 Flippin refinance closing statements (~$15,000 flat)'
  );

  update public.commercial_models
  set base = v_base,
      updated_at = now()
  where deal_id = v_deal_id;

  -- Consolidate Seller 7 steps -> 5 steps and 6 protections -> 4 bullets.
  v_steps := jsonb_build_array(
    jsonb_build_object(
      'key', 'week1_secure_and_start',
      'week', 'Week 1',
      'title', 'Secure, start near-ready units & launch laundry',
      'budgetKey', 'week1',
      'items', jsonb_build_array(
        jsonb_build_object('text', 'Doors, locks, cameras', 'budgetKey', 'security'),
        jsonb_build_object('text', 'Start the near-ready units 5, 8, 1, 2', 'budgetKey', 'nearReadyUnits'),
        jsonb_build_object('text', 'Get laundry running: 2 stacked sets taking coins, tap/card and bills', 'budgetKey', 'laundry'),
        jsonb_build_object('text', 'Paperwork alongside: gas check and furnace service, code violation, title, rental registration, $50 zoning letter', 'budgetKey', 'paperwork')
      )
    ),
    jsonb_build_object(
      'key', 'weeks2_3_empty_and_first',
      'week', 'Weeks 2-3',
      'title', 'First tenant moves in; units 3 and 9 empty',
      'detail', 'First tenant in Week 2 (Week 3 hard deadline). Unit 9 moves out; Unit 3 handled legally after closing (we handle it, not the seller), done by Week 3.',
      'budgetKey', 'eviction'
    ),
    jsonb_build_object(
      'key', 'weeks2_onward_bigger_units',
      'week', 'Weeks 2 onward',
      'title', 'Bigger units & building systems',
      'budgetKey', 'week2Onward',
      'items', jsonb_build_array(
        jsonb_build_object('text', 'Bigger units 7, 6, 3, 10, then 4 (full gut)', 'budgetKey', 'biggerUnits'),
        jsonb_build_object('text', 'Plumbing, heat, electric, exterior, Wi-Fi APs, 10 storage cages & 10 signed parking spots', 'budgetKey', 'building')
      )
    ),
    jsonb_build_object(
      'key', 'as_each_unit_finishes',
      'week', 'As each unit finishes',
      'title', 'Inspect, lease, collect & update here',
      'detail', 'Inspected, leased to screened long-term tenants, rent collected — with rents, leases and repair photos posted on this page.',
      'budgetKey', 'leaseUp'
    ),
    jsonb_build_object(
      'key', 'within_1_year_payoff',
      'week', 'Within the 1-year renovation loan',
      'title', 'Your renovation loan is paid off in full.'
    )
  );

  v_protections := jsonb_build_array(
    'Your bank gets paid first. A neutral payment company pays your mortgage every month, and you see every payment.',
    'If payments stop (15-day grace, then default), a signed deed at the title company returns the building to you.',
    'You''re named on the insurance, with monthly updates here showing rents, leases and repair photos.',
    'Extra collateral: one of my other rentals backs this loan too.'
  );

  update public.commercial_deals
  set seller_content = jsonb_set(
    jsonb_set(coalesce(seller_content, '{}'::jsonb), '{execution_steps}', v_steps, true),
    '{protections}',
    v_protections,
    true
  )
  where id = v_deal_id;

  -- Consolidate Private lender protections (6 -> 4 bullets).
  v_lender_protections := jsonb_build_array(
    'Recorded first-lien mortgage on 23 & 27 Charlotte, with you named on the insurance.',
    'A neutral payment company pays you every month (15-day grace, then default), and you see every payment.',
    'Monthly updates here showing rents, leases and repair photos.',
    'Extra collateral: one of my other rentals backs this loan too.'
  );

  insert into public.commercial_settings (key, value)
  values ('lender_protections:charlotte', v_lender_protections::text)
  on conflict (key) do update set value = excluded.value;

  -- Rebuild saved lead offer seller_summary + guide at $1,030/unit, $145,940 budget, and $15,000 flat refi fees ($0 reserve).
  select seller_summary into v_ss
  from public.commercial_offers
  where deal_id = v_deal_id and is_lead = true and seller_summary is not null
  order by sort, updated_at desc
  limit 1;

  if v_ss is not null then
    if jsonb_typeof(v_ss->'sellerTable') = 'array' and jsonb_array_length(v_ss->'sellerTable') > 0 then
      v_old_last := (v_ss->'sellerTable')->(jsonb_array_length(v_ss->'sellerTable') - 1);
      v_last_note := coalesce((v_old_last->>'note')::numeric, 0);
      v_last_wait := coalesce((v_old_last->>'noteWaits')::numeric, 0);
      if v_last_note + v_last_wait > 0 then
        v_note_pay := v_last_note + v_last_wait;
      end if;
    end if;

    v_reno_amt := greatest(0, v_total - v_cont) + 5500;
    v_reno_mo := v_reno_amt * 0.08 / 12.0;

    if jsonb_typeof(v_plan->'units') = 'array' then
      for v_item in select value from jsonb_array_elements(v_plan->'units') loop
        if coalesce((v_item->>'rehab')::numeric, 0) > 0 then
          v_unit_items := v_unit_items || jsonb_build_array(jsonb_build_object(
            'key', 'unit-' || coalesce(v_item->>'id', ''),
            'label', 'Unit ' || coalesce(v_item->>'id', ''),
            'amount', (v_item->>'rehab')::numeric,
            'overlay', jsonb_build_array('Unit ' || coalesce(v_item->>'id', '') || ': ' || commercial_access_private.fmt_money((v_item->>'rehab')::numeric))
          ));
        end if;
      end loop;
    end if;

    if jsonb_typeof(v_plan->'costs') = 'array' then
      v_idx := 0;
      for v_item in select value from jsonb_array_elements(v_plan->'costs') loop
        v_l_cost := greatest(0, coalesce((v_item->>'cost')::numeric, 0));
        if v_l_cost <= 0 then
          continue;
        end if;
        v_l_label := coalesce(v_item->>'label', '');
        v_l_src := nullif(btrim(coalesce(v_item->>'source', '')), '');
        if lower(coalesce(v_item->>'group', '')) = 'systems' then
          v_bldg_amt := v_bldg_amt + v_l_cost;
          v_bldg_items := v_bldg_items || jsonb_build_array(jsonb_build_object(
            'key', 'sys-' || v_idx,
            'label', v_l_label,
            'amount', v_l_cost,
            'overlay', case when v_l_src is not null
              then jsonb_build_array(v_l_src, v_l_label || ': ' || commercial_access_private.fmt_money(v_l_cost))
              else jsonb_build_array(v_l_label || ': ' || commercial_access_private.fmt_money(v_l_cost))
            end
          ));
        elsif lower(coalesce(v_item->>'group', '')) <> 'laundry' and v_l_label !~* '(laundry|washer|dryer)' then
          v_setup_items := v_setup_items || jsonb_build_array(jsonb_build_object(
            'key', 'setup-' || v_idx,
            'label', v_l_label,
            'amount', v_l_cost,
            'overlay', case when v_l_src is not null
              then jsonb_build_array(v_l_src, v_l_label || ': ' || commercial_access_private.fmt_money(v_l_cost))
              else jsonb_build_array(v_l_label || ': ' || commercial_access_private.fmt_money(v_l_cost))
            end
          ));
        end if;
        v_idx := v_idx + 1;
      end loop;
    end if;
    v_setup_amt := greatest(0, v_rehab_sub - v_units_amt - v_bldg_amt - v_laundry_amt);

    if v_units_amt > 0 then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'key', 'units', 'label', 'Units ' || commercial_access_private.fmt_money(v_units_amt),
        'title', 'Units', 'amount', v_units_amt, 'detail', '',
        'overlay', jsonb_build_array('Total units: ' || commercial_access_private.fmt_money(v_units_amt) || '.'),
        'items', v_unit_items
      ));
      v_heading_overlay := v_heading_overlay || jsonb_build_array('Units: ' || commercial_access_private.fmt_money(v_units_amt));
      v_parts := array_append(v_parts, 'Units ' || commercial_access_private.fmt_money(v_units_amt));
    end if;
    if v_bldg_amt > 0 then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'key', 'building', 'label', 'Building ' || commercial_access_private.fmt_money(v_bldg_amt),
        'title', 'Building', 'amount', v_bldg_amt, 'detail', '',
        'overlay', jsonb_build_array('Total building: ' || commercial_access_private.fmt_money(v_bldg_amt) || '.'),
        'items', v_bldg_items
      ));
      v_heading_overlay := v_heading_overlay || jsonb_build_array('Building: ' || commercial_access_private.fmt_money(v_bldg_amt));
      v_parts := array_append(v_parts, 'Building ' || commercial_access_private.fmt_money(v_bldg_amt));
    end if;
    if v_setup_amt > 0 then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'key', 'setup', 'label', 'Setup ' || commercial_access_private.fmt_money(v_setup_amt),
        'title', 'Setup', 'amount', v_setup_amt, 'detail', '',
        'overlay', jsonb_build_array('Total setup: ' || commercial_access_private.fmt_money(v_setup_amt) || '.'),
        'items', v_setup_items
      ));
      v_heading_overlay := v_heading_overlay || jsonb_build_array('Setup: ' || commercial_access_private.fmt_money(v_setup_amt));
      v_parts := array_append(v_parts, 'Setup ' || commercial_access_private.fmt_money(v_setup_amt));
    end if;
    if v_laundry_amt > 0 then
      v_heading_overlay := v_heading_overlay || jsonb_build_array('Laundry: ' || commercial_access_private.fmt_money(v_laundry_amt));
    end if;
    v_idx := 0;
    for v_cost_item in select value from jsonb_array_elements(coalesce(v_laundry_items, '[]'::jsonb)) loop
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'key', 'laundry-' || v_idx,
        'label', (v_cost_item->>'label') || ' — ' || commercial_access_private.fmt_money((v_cost_item->>'cost')::numeric),
        'title', v_cost_item->>'label',
        'amount', (v_cost_item->>'cost')::numeric,
        'detail', '',
        'overlay', jsonb_build_array(coalesce(v_cost_item->>'source', ''), (v_cost_item->>'label') || ': ' || commercial_access_private.fmt_money((v_cost_item->>'cost')::numeric))
      ));
      v_parts := array_append(v_parts, (v_cost_item->>'label') || ' — ' || commercial_access_private.fmt_money((v_cost_item->>'cost')::numeric));
      v_idx := v_idx + 1;
    end loop;
    if v_cont > 0 then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object('key', 'contingency', 'label', 'Contingency ' || commercial_access_private.fmt_money(v_cont), 'detail', '', 'overlay', jsonb_build_array('Repair contingency: ' || commercial_access_private.fmt_money(v_cont) || '.')));
      v_parts := array_append(v_parts, 'Contingency ' || commercial_access_private.fmt_money(v_cont));
      v_heading_overlay := v_heading_overlay || jsonb_build_array('Rehab subtotal: ' || commercial_access_private.fmt_money(v_rehab_sub), 'Contingency: ' || commercial_access_private.fmt_money(v_cont), 'Total with contingency: ' || commercial_access_private.fmt_money(v_total) || '.');
    end if;

    -- Recompute sellerTable (0..10 rented units at $1,030/unit).
    for v_u in 0..10 loop
      v_rent_left := v_u * v_unit_rent;
      v_bills_paid := least(v_rent_left, v_bills_mo);
      v_bills_waits := greatest(0, v_bills_mo - v_bills_paid);
      v_rent_left := greatest(0, v_rent_left - v_bills_paid);
      v_note_paid := least(v_rent_left, v_note_pay);
      v_note_waits := greatest(0, v_note_pay - v_note_paid);
      v_rent_left := greatest(0, v_rent_left - v_note_paid);
      v_reno_paid := least(v_rent_left, v_reno_mo);
      v_reno_waits := greatest(0, v_reno_mo - v_reno_paid);
      v_covered := case
        when v_u = 0 then 'no'
        when v_u * v_unit_rent + 1e-6 < v_bills_mo + v_note_pay + v_reno_mo then 'partly'
        else 'yes'
      end;
      if v_seller_covered_at is null and v_covered = 'yes' then
        v_seller_covered_at := v_u;
      end if;
      v_bills_lines := jsonb_build_array(
        'Property tax: ' || commercial_access_private.fmt_money(13544.0 / 12.0) || '/mo',
        'Insurance: ' || commercial_access_private.fmt_money(6500.0 / 12.0) || '/mo',
        'Water and trash: ' || commercial_access_private.fmt_money(12000.0 / 12.0) || '/mo',
        'Paid from rent: ' || commercial_access_private.fmt_money(v_bills_paid) || '/mo',
        case when v_bills_waits > 0 then 'Added to your payoff: ' || commercial_access_private.fmt_money(v_bills_waits) || '/mo' else 'All bills paid from rent' end
      );
      v_seller_table := v_seller_table || jsonb_build_array(jsonb_build_object(
        'units', v_u,
        'rentIn', v_u * v_unit_rent,
        'note', v_note_paid + v_reno_paid,
        'noteWaits', v_note_waits + v_reno_waits,
        'bills', v_bills_waits,
        'billsLines', v_bills_lines,
        'covered', v_covered
      ));
    end loop;

    -- Recompute 12-month lease-up deferrals from unit schedule at $1,030/unit.
    for v_m in 1..12 loop
      select count(*)::int into v_rented
      from jsonb_array_elements(case when jsonb_typeof(v_plan->'units') = 'array' then v_plan->'units' else '[]'::jsonb end) as x(u)
      where ceil(greatest(0, coalesce((u->>'ready')::numeric, 0)) / (52.0 / 12.0)) + 1 <= v_m;

      v_rent_left := v_rented * v_unit_rent;
      v_bills_paid := least(v_rent_left, v_bills_mo);
      v_def_bills := v_def_bills + (v_bills_mo - v_bills_paid);
      v_rent_left := greatest(0, v_rent_left - v_bills_paid);
      v_note_paid := least(v_rent_left, v_note_pay);
      v_def_pnote := v_def_pnote + (v_note_pay - v_note_paid);
      v_rent_left := greatest(0, v_rent_left - v_note_paid);
      v_reno_paid := least(v_rent_left, v_reno_mo);
      v_def_rnote := v_def_rnote + (v_reno_mo - v_reno_paid);
    end loop;
    v_def_total := v_def_bills + v_def_pnote + v_def_rnote;
    v_seller_payoff := 275000 + v_def_total;
    v_seller_total := v_seller_payoff + v_reno_amt;

    v_reg_loan := greatest(0, v_total - v_cont) + 5500 + v_cont;
    v_reg_pts := v_reg_loan * 0.025;
    v_reg_mo := v_reg_loan * 0.11 / 12.0;

    v_ss := (v_ss - 'upside') || jsonb_build_object(
      'stepBudgets', v_budgets,
      'laundryItems', v_laundry_items,
      'sellerTable', v_seller_table,
      'sellerCoveredAt', v_seller_covered_at,
      'refiLine', 'Your payments grow as units are rented, up to ' || commercial_access_private.fmt_money(v_note_pay + v_reno_mo) || ' a month, then you are paid back in full: ' || commercial_access_private.fmt_money(v_seller_total) || '.'
    );

    if jsonb_typeof(v_ss->'terms') = 'array' then
      v_terms := v_ss->'terms';
      for v_term in select value from jsonb_array_elements(v_terms) loop
        case v_term->>'label'
          when 'Renovation note' then
            v_term := jsonb_build_object('label', 'Renovation note', 'value', commercial_access_private.fmt_money(v_reno_amt), 'overlay', jsonb_build_array('Repair budget: ' || commercial_access_private.fmt_money(v_total), 'Closing costs: $5,500', 'Contingency: ' || commercial_access_private.fmt_money(v_cont) || ', added only if used', 'A second seller note. Paid from rent as units are rented, then your renovation loan is paid off in full.'));
          when 'Renovation note rate' then
            v_term := jsonb_build_object('label', 'Renovation note rate', 'value', '8% a year', 'overlay', jsonb_build_array(commercial_access_private.fmt_money(v_reno_mo) || '/mo when your payments are full.'));
          when 'Your payments' then
            v_term := jsonb_build_object('label', 'Your payments', 'value', 'Up to ' || commercial_access_private.fmt_money(v_note_pay + v_reno_mo) || '/mo', 'overlay', jsonb_build_array('Purchase note: ' || commercial_access_private.fmt_money(v_note_pay) || '/mo', 'Renovation note: ' || commercial_access_private.fmt_money(v_reno_mo) || '/mo', 'Full payment: ' || commercial_access_private.fmt_money(v_note_pay + v_reno_mo) || '/mo, at ' || coalesce(v_seller_covered_at::text, '6') || ' units rented.', 'Payments start as units are rented and grow with each one. Rent pays the holding bills first, then you. Any part not paid yet is added to what you are paid back.'));
          when 'All covered' then
            v_term := jsonb_build_object('label', 'All covered', 'value', 'At ' || coalesce(v_seller_covered_at::text, '6') || ' units rented', 'overlay', '[]'::jsonb);
          when 'Paid back in full' then
            v_term := jsonb_build_object('label', 'Paid back in full', 'value', commercial_access_private.fmt_money(v_seller_total), 'overlay', jsonb_build_array('Purchase note: $275,000', 'Renovation note: ' || commercial_access_private.fmt_money(v_reno_amt), 'Deferred holding costs: ' || commercial_access_private.fmt_money(v_def_total), 'Total paid back: ' || commercial_access_private.fmt_money(v_seller_total) || ', on top of your payments from rent.'));
          else null;
        end case;
        v_new_terms := v_new_terms || jsonb_build_array(v_term);
      end loop;
      v_ss := jsonb_set(v_ss, '{terms}', v_new_terms, true);
    end if;

    v_repairs_overlay := jsonb_build_array(
      'Units ' || commercial_access_private.fmt_money(v_units_amt),
      'Building ' || commercial_access_private.fmt_money(v_bldg_amt),
      'Setup ' || commercial_access_private.fmt_money(v_setup_amt)
    );
    for v_cost_item in select value from jsonb_array_elements(coalesce(v_laundry_items, '[]'::jsonb)) loop
      v_repairs_overlay := v_repairs_overlay || jsonb_build_array((v_cost_item->>'label') || ' — ' || commercial_access_private.fmt_money((v_cost_item->>'cost')::numeric));
    end loop;
    v_repairs_overlay := v_repairs_overlay || jsonb_build_array(
      'Contingency ' || commercial_access_private.fmt_money(v_cont),
      commercial_access_private.fmt_money(v_reno_mo) || '/mo when your payments are full.'
    );

    if jsonb_typeof(v_ss->'steps') = 'array' then
      v_offer_steps := v_ss->'steps';
      for v_ostep in select value from jsonb_array_elements(v_offer_steps) loop
        case v_ostep->>'title'
          when 'Repairs' then
            v_ostep := jsonb_build_object(
              'title', 'Repairs',
              'detail', 'You fund the repairs with a second seller note, ' || commercial_access_private.fmt_money(v_reno_amt) || ', at 8% a year, plus a ' || commercial_access_private.fmt_money(v_cont) || ' contingency only if it''s needed. The buyer runs the work.',
              'overlay', v_repairs_overlay
            );
          when 'Paid as units are rented' then
            v_ostep := jsonb_build_object(
              'title', 'Paid as units are rented',
              'detail', 'Your payments start as units are rented and grow with each one. Rent pays the property tax, insurance, water and trash first, then you. At ' || coalesce(v_seller_covered_at::text, '6') || ' units rented you get the full ' || commercial_access_private.fmt_money(v_note_pay + v_reno_mo) || ' a month: ' || commercial_access_private.fmt_money(v_note_pay) || ' on the purchase note and ' || commercial_access_private.fmt_money(v_reno_mo) || ' on the renovation note. Any part not paid before then is added to what you are paid back.',
              'overlay', jsonb_build_array('Purchase note: ' || commercial_access_private.fmt_money(v_note_pay) || '/mo', 'Renovation note: ' || commercial_access_private.fmt_money(v_reno_mo) || '/mo', 'Full payment: ' || commercial_access_private.fmt_money(v_note_pay + v_reno_mo) || '/mo, at ' || coalesce(v_seller_covered_at::text, '6') || ' units rented.', 'Payments start as units are rented and grow with each one. Rent pays the holding bills first, then you. Any part not paid yet is added to what you are paid back.')
            );
          when 'Paid back in full' then
            v_ostep := jsonb_build_object(
              'title', 'Paid back in full',
              'detail', 'You are paid back in full, ' || commercial_access_private.fmt_money(v_seller_total) || ', on top of your payments from rent.',
              'overlay', jsonb_build_array('Purchase note: $275,000', 'Renovation note: ' || commercial_access_private.fmt_money(v_reno_amt), 'Deferred holding costs: ' || commercial_access_private.fmt_money(v_def_total), 'Total paid back: ' || commercial_access_private.fmt_money(v_seller_total) || ', on top of your payments from rent.')
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
        'heading', 'Repair budget ' || commercial_access_private.fmt_money(v_total),
        'headingOverlay', v_heading_overlay,
        'oneLine', 'Repair budget ' || commercial_access_private.fmt_money(v_total) || ' — ' || array_to_string(v_parts, ', '),
        'total', v_total,
        'rehabTotal', v_rehab_sub,
        'contingency', v_cont,
        'stepBudgets', v_budgets,
        'laundryItems', v_laundry_items,
        'lines', v_lines
      );
      v_guide := jsonb_set(v_guide, '{costSummary}', v_cs, true);
      v_guide := jsonb_set(v_guide, '{cost}', v_lines, true);
      v_guide := jsonb_set(v_guide, '{costHeading}', to_jsonb(('Repair budget ' || commercial_access_private.fmt_money(v_total))::text), true);
      v_guide := jsonb_set(v_guide, '{sellerCoveredAt}', to_jsonb(v_seller_covered_at), true);
      if jsonb_typeof(v_guide->'bridge') = 'object' then
        v_guide := jsonb_set(v_guide, '{bridge,repairs}', to_jsonb(v_total), true);
      end if;

      v_refi := coalesce(v_guide->'refi', '{}'::jsonb) || jsonb_build_object(
        'renoNotePrincipal', v_reno_amt,
        'repairLoanPayoff', v_reno_amt,
        'repairLoanPayoffContUsed', v_reno_amt + v_cont,
        'repairLoanOverlay', jsonb_build_array(
          'Repair budget: ' || commercial_access_private.fmt_money(v_total),
          'Closing costs: $5,500',
          'Contingency: ' || commercial_access_private.fmt_money(v_cont) || ', added only if used',
          '8% interest only, no points.',
          'Seller renovation note paid off: ' || commercial_access_private.fmt_money(v_reno_amt) || '.'
        ),
        'deferred', jsonb_build_object(
          'bills', v_def_bills,
          'purchaseNote', v_def_pnote,
          'renoNote', v_def_rnote,
          'total', v_def_total
        ),
        'sellerCarriedBills', v_def_total,
        'sellerCarriedBillsOverlay', jsonb_build_array(
          'Holding bills rent did not cover yet: ' || commercial_access_private.fmt_money(v_def_bills),
          'Purchase note payments that waited: ' || commercial_access_private.fmt_money(v_def_pnote),
          'Renovation note payments that waited: ' || commercial_access_private.fmt_money(v_def_rnote),
          'Paid to the seller at the refi: ' || commercial_access_private.fmt_money(v_def_total) || '.'
        ),
        'sellerPayoff', v_seller_payoff,
        'sellerPayoffText', commercial_access_private.fmt_money(v_seller_payoff),
        'sellerTotalPayoff', v_seller_total,
        'sellerPayoffOverlay', jsonb_build_array('Seller’s note $275,000 paid off at refinance. Plus ' || commercial_access_private.fmt_money(v_def_total) || ' in deferred holding costs.'),
        'renoCompare', jsonb_build_object(
          'sellerRate', 8,
          'sellerAmount', v_reno_amt,
          'sellerMo', v_reno_mo,
          'regularRate', 11,
          'regularPointsPct', 2.5,
          'regularPoints', v_reg_pts,
          'regularLoan', v_reg_loan,
          'regularMo', v_reg_mo
        ),
        'feesPct', 0,
        'feesFlat', 15000,
        'reserve', 0
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
