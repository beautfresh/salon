-- بيوتفريش: تذكيرات مجدولة للإدارة (إقفال اليوم، موجز الصباح، أسبوع بيوتفريش)

create or replace function private.closing_reminder() returns void
language plpgsql security definer set search_path = '' as $$
declare d date := (now() at time zone 'Asia/Riyadh')::date;
begin
  if extract(dow from d)::int = any(coalesce((select closed_weekdays from public.home_settings where id = 1), '{}')) then return; end if;
  if exists (select 1 from public.fin_daily where day = d) then return; end if;
  perform private.push_admins('اليوم ما انقفل', 'سجّلوا مبيعات اليوم حسب طرق الدفع قبل ما تطلعون.', '#/closing', 'closing-' || d, null);
end $$;

create or replace function private.salon_brief() returns void
language plpgsql security definer set search_path = '' as $$
declare d date := (now() at time zone 'Asia/Riyadh')::date; p text[] := '{}'; n int; names text;
begin
  select count(*), string_agg(split_part(name, ' ', 1), '، ') into n, names from public.clients
   where birthday is not null and extract(month from birthday) = extract(month from d) and extract(day from birthday) = extract(day from d);
  if n > 0 then p := p || ('🎂 ميلاد ' || names); end if;
  select count(*) into n from public.client_feedback where kind = 'complaint' and status = 'open';
  if n > 0 then p := p || (n || ' شكوى مفتوحة'); end if;
  select count(*) into n from public.maint_issues where status = 'open';
  if n > 0 then p := p || (n || ' عطل مفتوح'); end if;
  select count(*) into n from public.maint_plans where last_done is not null and last_done + every_days < d;
  if n > 0 then p := p || (n || ' صيانة متأخرة'); end if;
  select count(*) into n from public.team_leaves where status = 'pending';
  if n > 0 then p := p || (n || ' طلب إجازة'); end if;
  select count(*) into n from (
    select due_on x from public.ops_rules where kind = 'expiry' and due_on between d and d + 14
    union all select health_card_expiry from public.team_private where health_card_expiry between d and d + 14
    union all select iqama_expiry from public.team_private where iqama_expiry between d and d + 14) t;
  if n > 0 then p := p || (n || ' وثيقة تنتهي خلال أسبوعين'); end if;
  select count(*) into n from public.home_bookings where status in ('pending','confirmed') and (starts_at at time zone 'Asia/Riyadh')::date = d;
  if n > 0 then p := p || (n || ' حجز منزلي اليوم'); end if;
  if array_length(p, 1) > 0 then
    perform private.push_admins('صباح بيوتفريش', array_to_string(p, ' · '), '#/home', 'brief-' || d, null);
  end if;
end $$;

create or replace function private.weekly_digest() returns void
language plpgsql security definer set search_path = '' as $$
declare d date := (now() at time zone 'Asia/Riyadh')::date; w0 date := d - 7; s1 numeric; s0 numeric; nc int; bday date; msg text;
begin
  select coalesce(sum(total), 0) into s1 from public.fin_daily where day >= w0 and day < d;
  select coalesce(sum(total), 0) into s0 from public.fin_daily where day >= w0 - 7 and day < w0;
  s1 := s1 + coalesce((select sum(total) from public.home_bookings where payment_status = 'paid' and status <> 'cancelled' and (starts_at at time zone 'Asia/Riyadh')::date >= w0 and (starts_at at time zone 'Asia/Riyadh')::date < d), 0);
  select count(*) into nc from public.clients where created_at >= w0;
  select day into bday from public.fin_daily where day >= w0 and day < d order by total desc limit 1;
  msg := 'المبيعات ' || to_char(s1, 'FM999,999,990') || ' ر.س'
    || case when s0 > 0 then ' (' || case when s1 >= s0 then '▲ ' else '▼ ' end || round(abs(s1 - s0) / s0 * 100) || '٪)' else '' end
    || case when bday is not null then ' · أفضل يوم ' || to_char(bday, 'DD/MM') else '' end
    || ' · ' || nc || ' عميلة جديدة';
  perform private.push_admins('أسبوع بيوتفريش', msg, '#/finance?l=w', 'week-' || d, null);
end $$;

revoke all on function private.closing_reminder(), private.salon_brief(), private.weekly_digest() from public, anon, authenticated;

select cron.unschedule(jobname) from cron.job where jobname in ('bf-closing-reminder','bf-salon-brief','bf-weekly-digest');
-- الأوقات بتوقيت UTC: ٩:٤٥م، ٩:١٥ص، والسبت ١٠ص بتوقيت الرياض
select cron.schedule('bf-closing-reminder', '45 18 * * *', 'select private.closing_reminder()');
select cron.schedule('bf-salon-brief', '15 6 * * *', 'select private.salon_brief()');
select cron.schedule('bf-weekly-digest', '0 7 * * 6', 'select private.weekly_digest()');
