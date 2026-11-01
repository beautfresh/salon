-- المالية تاخذ مبيعات الصالون من ركاز تلقائيًا (بدل الإقفال اليدوي)
create or replace function private.rk_day_collected(d0 date, d1 date) returns numeric
language sql stable set search_path = '' as $$
  select coalesce(sum(case when type = 'refund' then -amount else amount end), 0) from public.rekaz_transactions
  where status = 'confirmed' and processed_at >= private.rd(d0) and processed_at < private.rd(d1)
$$;

create or replace function public.fin_range(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare d0 date := p_from; d1 date := p_to + 1; span int := p_to - p_from + 1;
  pd0 date := p_from - (p_to - p_from + 1); salon numeric; home numeric; purch numeric; exp numeric; monthly boolean := (p_to - p_from) > 62;
  today date := (now() at time zone 'Asia/Riyadh')::date;
begin
  if private.my_role() not in ('admin','partner') then raise exception 'ليس لديك صلاحية لهذا الإجراء'; end if;
  if p_to < p_from or span > 400 then raise exception 'فترة غير صالحة'; end if;
  salon := private.rk_day_collected(d0, d1);
  select coalesce(sum(total),0) into home from public.home_bookings
   where payment_status = 'paid' and status <> 'cancelled' and (starts_at at time zone 'Asia/Riyadh')::date >= d0 and (starts_at at time zone 'Asia/Riyadh')::date < d1;
  select coalesce(sum(total_amount),0) into purch from public.purchase_invoices where status = 'approved' and invoice_date >= d0 and invoice_date < d1;
  select coalesce(sum(amount),0) into exp from public.fin_expenses where day >= d0 and day < d1;
  return jsonb_build_object(
    'from', d0, 'to', p_to, 'unit', case when monthly then 'month' else 'day' end, 'source', 'rekaz',
    'salon', salon, 'home', home, 'revenue', salon + home, 'purchases', purch, 'expenses', exp, 'net', salon + home - purch - exp,
    'closed_days', greatest(0, least(d1, today + 1) - d0),
    'days', coalesce((select jsonb_agg(jsonb_build_object('day', g::date,
        'salon', private.rk_day_collected(g::date, case when monthly then (g + interval '1 month')::date else g::date + 1 end),
        'home', coalesce((select sum(total) from public.home_bookings b where b.payment_status = 'paid' and b.status <> 'cancelled'
                 and (b.starts_at at time zone 'Asia/Riyadh')::date >= g::date and (b.starts_at at time zone 'Asia/Riyadh')::date < case when monthly then (g + interval '1 month')::date else g::date + 1 end), 0),
        'closed', g::date <= today) order by g)
      from generate_series(case when monthly then date_trunc('month', d0) else d0 end, d1 - 1, case when monthly then interval '1 month' else interval '1 day' end) g), '[]'::jsonb),
    'methods', (select jsonb_build_object(
        'card', coalesce(sum(v) filter (where method = 'point_of_sales'), 0), 'cash', coalesce(sum(v) filter (where method = 'cash'), 0),
        'transfer', coalesce(sum(v) filter (where method = 'bank_transfer'), 0), 'online', coalesce(sum(v) filter (where method in ('online', 'payment_link', 'rekaz_pay')), 0),
        'bnpl', coalesce(sum(v) filter (where method = 'buy_now_pay_later'), 0),
        'other', coalesce(sum(v) filter (where method not in ('point_of_sales', 'cash', 'bank_transfer', 'online', 'payment_link', 'rekaz_pay', 'buy_now_pay_later') or method is null), 0),
        'clients', (select count(distinct customer_id || '|' || ((start_at at time zone 'Asia/Riyadh')::date)::text) from public.rekaz_reservations
                    where status = 'confirmed' and start_at >= private.rd(d0) and start_at < private.rd(d1)))
      from (select method, case when type = 'refund' then -amount else amount end v from public.rekaz_transactions
            where status = 'confirmed' and processed_at >= private.rd(d0) and processed_at < private.rd(d1)) t),
    'cats', (select jsonb_build_object(
        'nails', coalesce(sum(r.total) filter (where pc.grp = 'nails'), 0), 'hair', coalesce(sum(r.total) filter (where pc.grp = 'hair'), 0),
        'makeup', coalesce(sum(r.total) filter (where pc.grp = 'makeup'), 0), 'lashes', coalesce(sum(r.total) filter (where pc.grp in ('lashes', 'face')), 0),
        'products', 0, 'other', coalesce(sum(r.total) filter (where pc.grp is null or pc.grp not in ('nails', 'hair', 'makeup', 'lashes', 'face')), 0))
      from public.rekaz_reservations r left join private.rk_prod_cat() pc on pc.product_id = r.product_id
      where r.status = 'confirmed' and r.start_at >= private.rd(d0) and r.start_at < private.rd(d1)),
    'exp_cats', coalesce((select jsonb_object_agg(category, s) from (select category, sum(amount) s from public.fin_expenses where day >= d0 and day < d1 group by category) x), '{}'::jsonb),
    'partners', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'pct', share_pct, 'amount', round((salon + home - purch - exp) * share_pct / 100, 2)) order by sort) from public.fin_partners), '[]'::jsonb),
    'prev_revenue', private.rk_day_collected(pd0, d0)
       + (select coalesce(sum(total),0) from public.home_bookings where payment_status = 'paid' and status <> 'cancelled'
          and (starts_at at time zone 'Asia/Riyadh')::date >= pd0 and (starts_at at time zone 'Asia/Riyadh')::date < d0)
  );
end $$;
revoke all on function public.fin_range(date, date) from public, anon;
grant execute on function public.fin_range(date, date) to authenticated;
