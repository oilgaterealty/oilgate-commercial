-- Charlotte common-area gas & electric ($1,800/yr = $150/mo) opex line,
-- removal of the $0 Heat / gas line, and regenerated saved models & offer guides.
-- Additive and idempotent. Scoped strictly to public.commercial_* and commercial_access_private.*.
begin;

-- 1. Update compute_opex_view to replace heatGasAnnual with commonAreaUtilitiesAnnual.
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
  v_common_util numeric := greatest(0, coalesce((p_opex->>'commonAreaUtilitiesAnnual')::numeric, 0));
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

-- 2. Update deal_plan:charlotte opex, commercial_models, and every saved commercial_offers guide.
do $$
declare
  v_deal_id uuid;
  v_raw text;
  v_plan jsonb := '{}'::jsonb;
  v_opex jsonb;
  v_sources jsonb;
  v_laundry jsonb;
  v_budgets jsonb;
  v_total numeric := 142440;
  v_base jsonb := '{}'::jsonb;
  v_rent numeric := 1000;
  v_cap numeric := 9;
  v_calc jsonb;
  v_noi numeric;
  v_val numeric;
  v_offer record;
  v_guide jsonb;
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

  v_sources := (coalesce(v_plan->'opex'->'sources', '{}'::jsonb) - 'heatGas') || jsonb_build_object(
    'commonAreaUtilities',
    'Estimate until house-meter bills are read; tenants pay their own unit heat; laundry gas/electric counted per load.'
  );

  v_opex := (coalesce(v_plan->'opex', '{}'::jsonb) - 'heatGasAnnual') || jsonb_build_object(
    'commonAreaUtilitiesAnnual', 1800,
    'sources', v_sources
  );

  v_plan := jsonb_set(v_plan, '{opex}', v_opex, true);
  insert into public.commercial_settings (key, value)
  values ('deal_plan:charlotte', v_plan::text)
  on conflict (key) do update set value = excluded.value;

  v_laundry := case when jsonb_typeof(v_plan->'laundry') = 'object' then v_plan->'laundry' else null end;
  v_budgets := commercial_access_private.plan_step_budgets('charlotte');
  if v_budgets is not null and coalesce(v_budgets->>'total', '') ~ '^-?\d+(\.\d+)?$' then
    v_total := (v_budgets->>'total')::numeric;
  end if;

  select coalesce(m.base, '{}'::jsonb) into v_base from public.commercial_models m where m.deal_id = v_deal_id limit 1;
  v_rent := greatest(1, coalesce(nullif((v_base->>'rent')::numeric, 0), 1000));
  v_cap := greatest(0.1, coalesce(nullif((v_base->>'valueCapRate')::numeric, 0), 9));
  v_calc := commercial_access_private.compute_opex_view(v_opex, 10, 10, 10 * v_rent, true, v_cap, v_laundry);
  v_noi := (v_calc->>'netYr')::numeric;
  v_val := round((v_calc->>'value')::numeric);

  v_base := coalesce(v_base, '{}'::jsonb) || jsonb_build_object(
    'opex', v_opex,
    'value', v_val,
    'valueSource', 'Value by income from operating costs & laundry: ' || commercial_access_private.fmt_money(v_noi) || '/yr NOI ÷ ' || v_cap || '% cap rate = ' || commercial_access_private.fmt_money(v_val) || '.'
  );

  update public.commercial_models
  set base = v_base,
      updated_at = now()
  where deal_id = v_deal_id;

  for v_offer in
    select id, seller_summary
    from public.commercial_offers
    where deal_id = v_deal_id
      and seller_summary is not null
      and jsonb_typeof(seller_summary->'guide') = 'object'
  loop
    v_guide := commercial_access_private.apply_opex_to_guide(
      v_offer.seller_summary->'guide',
      v_opex,
      v_plan,
      v_base,
      v_total
    );
    update public.commercial_offers
    set seller_summary = jsonb_set(seller_summary, '{guide}', v_guide, true),
        updated_at = now()
    where id = v_offer.id;
  end loop;
end
$$;

notify pgrst, 'reload schema';
commit;
