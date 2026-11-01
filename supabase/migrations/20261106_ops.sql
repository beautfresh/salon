-- بيوتفريش: التشغيل (قوائم يومية، دليل الإجراءات، بطاقات الخدمات، قواعد بيوتفريش)

create table if not exists public.ops_lists (
  id bigint generated always as identity primary key,
  kind text not null unique check (kind in ('open','close','weekly')),
  name text not null,
  sort int not null default 0
);
create table if not exists public.ops_list_items (
  id bigint generated always as identity primary key,
  list_id bigint not null references public.ops_lists(id) on delete cascade,
  body text not null check (length(trim(body)) between 2 and 160),
  critical boolean not null default false,
  sort int not null default 0
);
create table if not exists public.ops_runs (
  list_id bigint not null references public.ops_lists(id) on delete cascade,
  day date not null,
  done jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (list_id, day)
);
create table if not exists public.ops_sops (
  id bigint generated always as identity primary key,
  title text not null check (length(trim(title)) between 2 and 100),
  category text not null default 'service' check (category in ('service','hygiene','cashier','complaints','emergency','team','other')),
  steps text not null check (length(steps) <= 4000),
  sort int not null default 0,
  updated_at timestamptz not null default now()
);
create table if not exists public.ops_services (
  id bigint generated always as identity primary key,
  name text not null check (length(trim(name)) between 2 and 80),
  category text not null default 'nails' check (category in ('nails','hair','makeup','lashes','skin','package','other')),
  price numeric(10,2) check (price is null or price >= 0),
  duration_min int not null default 60 check (duration_min between 5 and 600),
  steps text check (steps is null or length(steps) <= 3000),
  tips text check (tips is null or length(tips) <= 1000),
  active boolean not null default true,
  sort int not null default 0
);
create table if not exists public.ops_service_items (
  service_id bigint not null references public.ops_services(id) on delete cascade,
  item_id bigint not null references public.items(id) on delete cascade,
  qty numeric(10,3) not null check (qty > 0),
  primary key (service_id, item_id)
);
create table if not exists public.ops_rules (
  id bigint generated always as identity primary key,
  name text not null check (length(trim(name)) between 2 and 80),
  kind text not null check (kind in ('expiry','check')),
  due_on date,
  every_days int check (every_days is null or every_days between 1 and 1000),
  last_done date,
  note text check (note is null or length(note) <= 300),
  sort int not null default 0
);

do $$
declare t text;
begin
  foreach t in array array['ops_lists','ops_list_items','ops_runs','ops_sops','ops_services','ops_service_items','ops_rules'] loop
    execute format('alter table public.%1$s enable row level security', t);
    execute format('revoke all on public.%1$s from anon', t);
    execute format('drop policy if exists %1$s_read on public.%1$s', t);
    execute format('create policy %1$s_read on public.%1$s for select to authenticated using (private.is_active_user())', t);
    execute format('drop policy if exists %1$s_mgr on public.%1$s', t);
    execute format($p$create policy %1$s_mgr on public.%1$s for all to authenticated
      using (private.my_role() in ('admin','partner')) with check (private.my_role() in ('admin','partner'))$p$, t);
  end loop;
end $$;
-- الفريق كله يأشّر على القوائم ويسجّل الفحوصات
drop policy if exists ops_runs_team on public.ops_runs;
create policy ops_runs_team on public.ops_runs for insert to authenticated with check (private.is_active_user());
drop policy if exists ops_runs_team_up on public.ops_runs;
create policy ops_runs_team_up on public.ops_runs for update to authenticated using (private.is_active_user()) with check (private.is_active_user());

-- التأشير الذري على بند (يتفادى تضارب اثنين يأشرون بنفس الوقت)
create or replace function public.ops_tick(p_list bigint, p_day date, p_item bigint, p_on boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r jsonb;
begin
  if not private.is_active_user() then raise exception 'ليس لديك صلاحية'; end if;
  insert into public.ops_runs (list_id, day) values (p_list, p_day) on conflict do nothing;
  update public.ops_runs set
    done = case when p_on then done || jsonb_build_object(p_item::text, jsonb_build_object('by', auth.uid(), 'at', now())) else done - p_item::text end,
    updated_at = now()
  where list_id = p_list and day = p_day returning done into r;
  return r;
end $$;
revoke all on function public.ops_tick(bigint, date, bigint, boolean) from public, anon;
grant execute on function public.ops_tick(bigint, date, bigint, boolean) to authenticated;

-- بيانات أولية
insert into public.ops_lists (kind, name, sort) values ('open', 'فتح الصالون', 1), ('close', 'إقفال الصالون', 2), ('weekly', 'التنظيف الأسبوعي', 3) on conflict (kind) do nothing;

insert into public.ops_list_items (list_id, body, critical, sort)
select l.id, v.body, v.crit, v.sort from public.ops_lists l
join (values
  ('open', 'تشغيل الإضاءة والتكييف والموسيقى الهادئة', false, 1),
  ('open', 'تعطير المكان', false, 2),
  ('open', 'ترتيب الاستقبال وتجهيز الضيافة (قهوة، ماء، تمر)', false, 3),
  ('open', 'نظافة الحمام وتوفر المناديل والصابون', false, 4),
  ('open', 'تجهيز الأدوات المعقّمة وتشغيل جهاز التعقيم', true, 5),
  ('open', 'تجهيز المناشف النظيفة لكل محطة', false, 6),
  ('open', 'مراجعة مواعيد اليوم والحجوزات المنزلية', true, 7),
  ('open', 'تشغيل جهاز الشبكة والتأكد من فكة الكاش', false, 8),
  ('open', 'ستوري «صباح بيوتفريش»', false, 9),
  ('close', 'إقفال اليوم في النظام حسب طرق الدفع', true, 1),
  ('close', 'مطابقة الكاش مع المسجّل', true, 2),
  ('close', 'تعقيم كل الأدوات المستخدمة', true, 3),
  ('close', 'تسجيل أي صرف من المخزون', false, 4),
  ('close', 'تنظيف المحطات ورمي النفايات', false, 5),
  ('close', 'إغلاق علب الجيل والصبغات وترتيب المنتجات', false, 6),
  ('close', 'جمع المناشف للغسيل', false, 7),
  ('close', 'فصل السشوار والمكواة وأجهزة الأظافر', true, 8),
  ('close', 'إطفاء التكييف والإضاءة وقفل الأبواب', true, 9),
  ('weekly', 'تنظيف عميق للكراسي وأحواض الغسيل', false, 1),
  ('weekly', 'تنظيف فلاتر المكيفات', false, 2),
  ('weekly', 'فحص تواريخ صلاحية المنتجات', true, 3),
  ('weekly', 'جرد سريع لأكثر المنتجات استخدامًا', false, 4),
  ('weekly', 'تنظيف المرايا والزجاج والأرفف', false, 5),
  ('weekly', 'التأكد أن الكاميرات تسجّل', true, 6)
) v(kind, body, crit, sort) on v.kind = l.kind
where not exists (select 1 from public.ops_list_items);

insert into public.ops_sops (title, category, sort, steps)
select * from (values
  ('استقبال العميلة', 'service', 1, 'نرحّب بالعميلة باسمها إذا كانت مسجلة\nنقدّم الضيافة خلال أول دقيقتين\nنأكّد الخدمة والسعر والوقت المتوقع قبل البدء\nنسألها عن أي حساسية أو تفضيل، ونسجّله في ملفها\nنبلّغ الأخصائية بوصولها، وإذا فيه تأخير نبلّغ العميلة بصراحة'),
  ('تعقيم الأدوات', 'hygiene', 2, 'نغسل الأدوات بالماء والصابون مباشرة بعد كل عميلة\nننقعها في المحلول المعقّم حسب المدة المكتوبة على العبوة\nننشفها ونحطها في جهاز التعقيم\nنحفظها في أكياس معقمة مغلقة وما نفتحها إلا قدام العميلة\nالمبارد وأحجار الحك للاستخدام مرة وحدة، ما تنعاد'),
  ('التعامل مع شكوى', 'complaints', 3, 'نسمع العميلة للآخر بدون مقاطعة\nنعتذر عن شعورها حتى لو ما كان الخطأ واضح\nنعرض حل فوري: تعديل مجاني، أو موعد قريب، أو خصم بموافقة الإدارة\nنسجّل الشكوى في النظام من «الآراء والملاحظات»\nنتابع معها برسالة بعد يومين'),
  ('تأخر العميلة أو إلغاؤها', 'service', 4, 'التأخير أكثر من ١٥ دقيقة: نبلّغها إن الخدمة ممكن تختصر أو تتأجل\nالإلغاء قبل الموعد بأقل من ٤ ساعات: يُسجّل في ملفها\nثلاث مرات عدم حضور: نطلب عربون للحجز الجاي\nدايمًا بأسلوب لطيف، والقرار النهائي للإدارة'),
  ('إقفال الكاشير', 'cashier', 5, 'نطبع تقرير جهاز الشبكة\nنعدّ الكاش ونطابقه مع المسجّل\nنسجّل إقفال اليوم في النظام حسب طرق الدفع\nأي فرق يتسجّل في الملاحظة ويتبلّغ للإدارة نفس اليوم\nالكاش يتحفظ في الخزنة'),
  ('حالة طوارئ', 'emergency', 6, 'حريق: نطلّع العميلات أول، ونتصل على ٩٩٨\nإصابة أو حرق بسيط: صندوق الإسعافات عند الاستقبال\nحساسية شديدة أو ضيق نفس: نوقف الخدمة فورًا ونتصل على ٩٩٧\nنبلّغ الإدارة بأي حادثة ونسجّلها')
) v(title, category, sort, steps)
where not exists (select 1 from public.ops_sops);
update public.ops_sops set steps = replace(steps, '\n', E'\n') where steps like '%\n%';

insert into public.ops_rules (name, kind, every_days, sort, note)
select * from (values
  ('السجل التجاري', 'expiry', null::int, 1, null::text),
  ('رخصة البلدية', 'expiry', null, 2, null),
  ('شهادة الدفاع المدني', 'expiry', null, 3, null),
  ('عقد الإيجار', 'expiry', null, 4, null),
  ('صيانة طفايات الحريق', 'check', 365, 5, 'صيانة سنوية من جهة معتمدة'),
  ('مكافحة الحشرات', 'check', 90, 6, 'كل ٣ شهور مع شهادة'),
  ('صندوق الإسعافات الأولية', 'check', 30, 7, 'نتأكد من المحتويات والصلاحية'),
  ('الكاميرات تسجّل', 'check', 7, 8, 'نراجع تسجيل آخر ٢٤ ساعة')
) v(name, kind, every_days, sort, note)
where not exists (select 1 from public.ops_rules);
