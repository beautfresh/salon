-- بيوتفريش: العُدّة (بطاقة المنشأة، الرسائل الجاهزة، قسائم الهدايا)

create table if not exists public.kit_profile (
  id int primary key default 1 check (id = 1),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
insert into public.kit_profile (id, data) values (1, jsonb_build_object(
  'brand', 'بيوتفريش', 'brand_en', 'Beautfresh', 'tagline', 'The Fresh Version of You',
  'phone', '0509492224', 'whatsapp', '0509492224', 'instagram', 'beautfresh',
  'site', 'https://beautfresh.com', 'booking', 'https://rekaz.io/beautfresh', 'home_booking', 'https://beautfresh.com/home/'
)) on conflict (id) do nothing;

create table if not exists public.kit_messages (
  id bigint generated always as identity primary key,
  cat text not null check (cat in ('booking','visit','service','issues','seasons','team')),
  title text not null check (length(trim(title)) between 2 and 80),
  body text not null check (length(body) between 2 and 1500),
  sort int not null default 0
);

create table if not exists public.gift_vouchers (
  id bigint generated always as identity primary key,
  code text not null unique check (code ~ '^BF-[A-Z0-9]{5}$'),
  value_text text not null check (length(value_text) between 2 and 80),
  amount numeric(10,2) check (amount is null or amount >= 0),
  to_name text check (to_name is null or length(to_name) <= 60),
  from_name text check (from_name is null or length(from_name) <= 60),
  message text check (message is null or length(message) <= 200),
  issued_on date not null default current_date,
  expires_on date,
  paid boolean not null default true,
  redeemed_on date,
  created_by uuid default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['kit_profile','kit_messages','gift_vouchers'] loop
    execute format('alter table public.%1$s enable row level security', t);
    execute format('revoke all on public.%1$s from anon', t);
    execute format('drop policy if exists %1$s_read on public.%1$s', t);
    execute format('create policy %1$s_read on public.%1$s for select to authenticated using (private.is_active_user())', t);
    execute format('drop policy if exists %1$s_mgr on public.%1$s', t);
    execute format($p$create policy %1$s_mgr on public.%1$s for all to authenticated
      using (private.my_role() in ('admin','partner')) with check (private.my_role() in ('admin','partner'))$p$, t);
  end loop;
end $$;
-- الاستقبال يستبدل القسيمة
drop policy if exists gift_vouchers_redeem on public.gift_vouchers;
create policy gift_vouchers_redeem on public.gift_vouchers for update to authenticated using (private.is_active_user()) with check (private.is_active_user());

insert into public.kit_messages (cat, title, sort, body)
select * from (values
 ('booking', 'تأكيد الحجز', 1, $m$هلا {الاسم} 🤍
تم تأكيد موعدك في بيوتفريش:
{الخدمة}
{الموعد}

موقعنا: {الموقع}
إذا تبين تغيرين الموعد، كلمينا هنا قبلها بأربع ساعات.$m$),
 ('booking', 'تذكير قبل الموعد بيوم', 2, $m$هلا {الاسم} 🤍
نذكّرك بموعدك بكرة في بيوتفريش {الموعد}.
تكفين ردّي بكلمة «تم» عشان نثبّته لك.$m$),
 ('booking', 'الرد على سؤال الأسعار', 3, $m$هلا والله {الاسم} 🤍
أسعار خدماتنا ومواعيدنا المتاحة كلها هنا:
{رابط_الحجز}
وإذا تحتاجين استشارة قبل تختارين، أنا معك.$m$),
 ('booking', 'الموقع وأوقات الدوام', 4, $m$موقع بيوتفريش:
{الموقع}

أوقات الدوام: {الدوام}
ننتظرك 🤍$m$),
 ('visit', 'شكر بعد الزيارة', 1, $m$هلا {الاسم} 🤍
شكرًا لزيارتك بيوتفريش اليوم، إن شاء الله عجبتك النتيجة.
رأيك يهمنا، وإذا فيه أي ملاحظة قولي لنا.$m$),
 ('visit', 'طلب تقييم قوقل', 2, $m$هلا {الاسم} 🤍
سعدنا فيك اليوم! إذا عجبتك تجربتك، تقييمك يفرق معنا كثير:
{رابط_التقييم}
شكرًا من القلب.$m$),
 ('visit', 'وحشتينا', 3, $m$هلا {الاسم} 🤍
وحشتينا في بيوتفريش! صار لك فترة ما جيتي.
ودّك نرتب لك موعد هالأسبوع؟$m$),
 ('service', 'العناية بعد الجيل', 1, $m$هلا {الاسم} 🤍
عشان يثبت الجيل أطول وقت:
• لا تستخدمين أظافرك كأداة
• البسي قفازات وقت التنظيف
• زيت الأظافر كل ليلة
• لا تقشرينه، نزيله لك عندنا بدون ما يضر أظافرك$m$),
 ('service', 'العناية بعد الصبغة', 2, $m$هلا {الاسم} 🤍
عشان يعيش لونك:
• لا تغسلين شعرك أول ٤٨ ساعة
• شامبو خالي من السلفات
• قللي الحرارة واستخدمي حماية
ولو حسيتي بأي حكة أو تهيج، كلمينا على طول.$m$),
 ('issues', 'اعتذار عن تأخير', 1, $m$هلا {الاسم}،
نعتذر منك على التأخير اليوم، وقتك غالي علينا.
عشان كذا زيارتك الجاية عليها {التعويض}. ننتظرك 🤍$m$),
 ('issues', 'الرد على شكوى', 2, $m$هلا {الاسم}،
شكرًا إنك قلتي لنا، وآسفين إن تجربتك ما كانت مثل ما تستاهلين.
بنتواصل معك اليوم ونصلّحها بالطريقة اللي تريحك.$m$),
 ('issues', 'سياسة الإلغاء', 3, $m$هلا {الاسم} 🤍
عشان نقدر نخدم الكل، نرجو الإلغاء أو التعديل قبل الموعد بأربع ساعات على الأقل.
شكرًا لتفهمك.$m$),
 ('seasons', 'أوقات دوام العيد', 1, $m$كل عام وأنتم بخير 🤍
أوقات بيوتفريش في العيد:
{الدوام}
الحجز من هنا: {رابط_الحجز}
المواعيد محدودة، احجزي بدري.$m$),
 ('seasons', 'تهنئة ميلاد', 2, $m$كل عام وأنتِ بخير يا {الاسم} 🎂
بمناسبة ميلادك، هديتك من بيوتفريش بانتظارك هالشهر: {الهدية}$m$),
 ('seasons', 'قسيمة هدية', 3, $m$هلا {الاسم} 🤍
وصلتك هدية من {من} في بيوتفريش!
قسيمتك: {الهدية}
رقمها: {رقم_القسيمة}
احجزي متى ما بغيتي: {رابط_الحجز}$m$),
 ('team', 'ترحيب بموظفة جديدة', 1, $m$هلا {الاسم} 🤍
حياك في عائلة بيوتفريش!
أول يوم {الموعد}. اقري الأدلة من التطبيق ووقّعي عليها قبل ما تبدين.
أي سؤال، احنا معك.$m$)
) v(cat, title, sort, body)
where not exists (select 1 from public.kit_messages);
