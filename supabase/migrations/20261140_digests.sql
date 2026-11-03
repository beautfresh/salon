-- ملخص الصباح والأسبوع والشهر من أرقام ركاز الحقيقية (بدل الإقفال اليدوي)

create or replace function private.fmt_sar(v numeric) returns text language sql immutable set search_path = '' as $$
  select to_char(round(coalesce(v, 0)), 'FM999,999,990')
$$;

-- ☀️ ملخص الصباح ٩:١٥: أمس، اليوم، وشي واحد يستاهل تسوونه
create or replace function private.salon_brief() returns void
language plpgsql security definer set search_path = '' as $$
declare
  d date := (now() at time zone 'Asia/Riyadh')::date; y date := d - 1;
  ys numeric; avg_wd numeric; tn int; tv numeric; t1 timestamptz; n int; act text; p text[] := '{}'; body text;
begin
  select coalesce(sum(total), 0) into ys from public.rekaz_orders where status = 'confirmed' and created_at >= private.rd(y) and created_at < private.rd(d);
  select avg(s) into avg_wd from (select sum(total) s from public.rekaz_orders where status = 'confirmed'
      and created_at >= private.rd(y - 56) and created_at < private.rd(y) and extract(dow from (created_at at time zone 'Asia/Riyadh')) = extract(dow from y)
      group by (created_at at time zone 'Asia/Riyadh')::date) z;
  p := p || ('أمس ' || private.fmt_sar(ys) || ' ر.س' || case when avg_wd > 0 then
      case when ys >= avg_wd * 1.03 then ' ▲' || round((ys / avg_wd - 1) * 100) || '٪' when ys <= avg_wd * 0.97 then ' ▼' || round((1 - ys / avg_wd) * 100) || '٪' else '' end || ' عن معدل ' || (array['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'])[extract(dow from y)::int + 1]
    else '' end);
  select count(*), coalesce(sum(total), 0), min(start_at) into tn, tv, t1 from public.rekaz_reservations
    where status in ('confirmed', 'pending') and start_at >= private.rd(d) and start_at < private.rd(d + 1);
  p := p || case when tn > 0 then 'اليوم ' || tn || ' موعد بـ' || private.fmt_sar(tv) || ' ر.س، أولها ' || to_char(t1 at time zone 'Asia/Riyadh', 'HH12:MI') else 'ما فيه مواعيد اليوم للحين' end;
  -- شي واحد تسوونه (أول اللي ينطبق)
  select count(*) into n from public.visit_followups where day = y and outcome = 'issue';
  if n > 0 then act := '⚠️ ' || n || ' عميلة عندها ملاحظة من أمس، كلموها اليوم'; end if;
  if act is null then
    select count(distinct customer_id) into n from public.rekaz_reservations r where r.status = 'confirmed' and r.end_at < now() and r.start_at >= private.rd(y) and r.start_at < private.rd(d)
      and not exists (select 1 from public.visit_followups f where f.customer_id = r.customer_id and f.day = y and f.sent_at is not null);
    if n >= 3 then act := '💬 ' || n || ' عميلة ما انسألت عن تجربتها أمس (مواعيد الصالون ← بعد الزيارة)'; end if;
  end if;
  if act is null then
    select count(*) into n from public.winback_msgs where status = 'draft';
    if n > 0 then act := '💌 ' || n || ' رسالة استرجاع جاهزة تنتظر الإرسال'; end if;
  end if;
  if act is not null then p := p || act; end if;
  -- تنبيهات التشغيل
  select count(*) into n from public.maint_issues where status = 'open'; if n > 0 then p := p || (n || ' عطل مفتوح'); end if;
  select count(*) into n from public.team_leaves where status = 'pending'; if n > 0 then p := p || (n || ' طلب إجازة'); end if;
  select count(*) into n from (
    select due_on x from public.ops_rules where kind = 'expiry' and due_on between d and d + 14
    union all select health_card_expiry from public.team_private where health_card_expiry between d and d + 14
    union all select iqama_expiry from public.team_private where iqama_expiry between d and d + 14) t;
  if n > 0 then p := p || (n || ' وثيقة تنتهي خلال أسبوعين'); end if;
  body := array_to_string(p, ' · ');
  perform private.push_admins('صباح بيوتفريش ☀️', body, '#/sales?l=d', 'brief-' || d, null);
end $$;

-- أسبوع بيوتفريش (السبت ١٠ص)
create or replace function private.weekly_digest() returns void
language plpgsql security definer set search_path = '' as $$
declare d date := (now() at time zone 'Asia/Riyadh')::date; w0 date := d - 7; s1 numeric; s0 numeric; nc int; bday date; bv numeric; prov text; msg text;
begin
  select coalesce(sum(total), 0) into s1 from public.rekaz_orders where status = 'confirmed' and created_at >= private.rd(w0) and created_at < private.rd(d);
  select coalesce(sum(total), 0) into s0 from public.rekaz_orders where status = 'confirmed' and created_at >= private.rd(w0 - 7) and created_at < private.rd(w0);
  select dd, s into bday, bv from (select (created_at at time zone 'Asia/Riyadh')::date dd, sum(total) s from public.rekaz_orders
    where status = 'confirmed' and created_at >= private.rd(w0) and created_at < private.rd(d) group by 1 order by 2 desc limit 1) z;
  select count(*) into nc from (select customer_id, min(start_at) f from public.rekaz_reservations where status = 'confirmed' group by 1) z where f >= private.rd(w0) and f < private.rd(d);
  select trim(x) into prov from public.rekaz_reservations r, unnest(string_to_array(coalesce(r.provider_names, ''), ',')) x
    where r.status = 'confirmed' and r.start_at >= private.rd(w0) and r.start_at < private.rd(d) and trim(x) not in ('', 'مزود الخدمة الافتراضي')
    group by 1 order by sum(r.total) desc limit 1;
  msg := 'المبيعات ' || private.fmt_sar(s1) || ' ر.س'
    || case when s0 > 0 then ' (' || case when s1 >= s0 then '▲' else '▼' end || round(abs(s1 - s0) / s0 * 100) || '٪ عن الأسبوع قبله)' else '' end
    || case when bday is not null then ' · أفضل يوم ' || (array['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'])[extract(dow from bday)::int + 1] || ' ' || private.fmt_sar(bv) else '' end
    || ' · ' || nc || ' عميلة جديدة'
    || case when prov is not null then ' · الأعلى: ' || prov else '' end;
  perform private.push_admins('أسبوع بيوتفريش', msg, '#/sales?l=w&at=' || (d - 1), 'week-' || d, null);
end $$;

-- تقرير الشهر (أول كل شهر ٩:٣٠ص)
create or replace function private.monthly_digest() returns void
language plpgsql security definer set search_path = '' as $$
declare d date := (now() at time zone 'Asia/Riyadh')::date; m1 date := date_trunc('month', d)::date; m0 date := (m1 - interval '1 month')::date; mp date := (m0 - interval '1 month')::date;
  s1 numeric; s0 numeric; nc int; prov text; rt numeric; rn int; best numeric; mname text; msg text;
begin
  mname := (array['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'])[extract(month from m0)::int];
  select coalesce(sum(total), 0) into s1 from public.rekaz_orders where status = 'confirmed' and created_at >= private.rd(m0) and created_at < private.rd(m1);
  select coalesce(sum(total), 0) into s0 from public.rekaz_orders where status = 'confirmed' and created_at >= private.rd(mp) and created_at < private.rd(m0);
  select max(s) into best from (select sum(total) s from public.rekaz_orders where status = 'confirmed' and created_at < private.rd(m0) group by date_trunc('month', created_at at time zone 'Asia/Riyadh')) z;
  select count(*) into nc from (select customer_id, min(start_at) f from public.rekaz_reservations where status = 'confirmed' group by 1) z where f >= private.rd(m0) and f < private.rd(m1);
  select trim(x) into prov from public.rekaz_reservations r, unnest(string_to_array(coalesce(r.provider_names, ''), ',')) x
    where r.status = 'confirmed' and r.start_at >= private.rd(m0) and r.start_at < private.rd(m1) and trim(x) not in ('', 'مزود الخدمة الافتراضي')
    group by 1 order by sum(r.total) desc limit 1;
  select round(avg(rating)::numeric, 2), count(*) into rt, rn from public.rekaz_reviews where created_at >= private.rd(m0) and created_at < private.rd(m1);
  msg := 'المبيعات ' || private.fmt_sar(s1) || ' ر.س'
    || case when s0 > 0 then ' (' || case when s1 >= s0 then '▲' else '▼' end || round(abs(s1 - s0) / s0 * 100) || '٪ عن الشهر قبله)' else '' end
    || case when best is not null and s1 > best then ' 🏆 أفضل شهر في تاريخكم' else '' end
    || ' · ' || nc || ' عميلة جديدة'
    || case when prov is not null then ' · الأعلى: ' || prov else '' end
    || case when rn > 0 then ' · التقييم ★' || rt || ' من ' || rn else '' end
    || '. التقرير الكامل جاهز للطباعة.';
  perform private.push_admins('تقرير ' || mname || ' جاهز 📄', msg, '#/finance?l=m&at=' || (m0 + 14), 'month-' || m0, null);
end $$;

revoke all on function private.salon_brief(), private.weekly_digest(), private.monthly_digest(), private.fmt_sar(numeric) from public, anon, authenticated;

select cron.unschedule(jobname) from cron.job where jobname in ('bf-closing-reminder', 'bf-monthly-digest');
select cron.schedule('bf-monthly-digest', '30 6 1 * *', 'select private.monthly_digest()');
