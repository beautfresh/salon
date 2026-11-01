-- بيوتفريش: قواعد بيوتفريش، أدلة بيوتفريش، تفقّد التطبيق

create table if not exists public.rules_state (
  code text primary key check (code ~ '^[A-Z]{2,5}-[0-9]{2}$'),
  adopted boolean not null default true,
  dismissed_reason text check (dismissed_reason is null or length(dismissed_reason) <= 300),
  answer text check (answer is null or length(answer) <= 60),
  updated_by uuid default auth.uid() references public.profiles(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.guides (
  id bigint generated always as identity primary key,
  title text not null check (length(trim(title)) between 2 and 100),
  audience text check (audience is null or length(audience) <= 100),
  tagline text check (tagline is null or length(tagline) <= 200),
  body text not null check (length(body) <= 20000),
  version int not null default 1,
  sort int not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.guide_reads (
  guide_id bigint not null references public.guides(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  version int not null,
  read_at timestamptz not null default now(),
  primary key (guide_id, profile_id)
);

create table if not exists public.ops_audits (
  id bigint generated always as identity primary key,
  day date not null default current_date,
  list_id bigint not null references public.ops_lists(id) on delete cascade,
  item_id bigint not null references public.ops_list_items(id) on delete cascade,
  match boolean not null,
  note text check (note is null or length(note) <= 200),
  created_by uuid default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (day, item_id)
);

alter table public.rules_state enable row level security;
alter table public.guides enable row level security;
alter table public.guide_reads enable row level security;
alter table public.ops_audits enable row level security;
revoke all on public.rules_state, public.guides, public.guide_reads, public.ops_audits from anon;

drop policy if exists rules_state_read on public.rules_state;
create policy rules_state_read on public.rules_state for select to authenticated using (private.is_active_user());
drop policy if exists rules_state_mgr on public.rules_state;
create policy rules_state_mgr on public.rules_state for all to authenticated using (private.my_role() in ('admin','partner')) with check (private.my_role() in ('admin','partner'));

drop policy if exists guides_read on public.guides;
create policy guides_read on public.guides for select to authenticated using (private.is_active_user());
drop policy if exists guides_mgr on public.guides;
create policy guides_mgr on public.guides for all to authenticated using (private.my_role() in ('admin','partner')) with check (private.my_role() in ('admin','partner'));

drop policy if exists guide_reads_read on public.guide_reads;
create policy guide_reads_read on public.guide_reads for select to authenticated using (private.is_active_user());
drop policy if exists guide_reads_sign on public.guide_reads;
create policy guide_reads_sign on public.guide_reads for insert to authenticated with check (private.is_active_user() and profile_id = auth.uid());
drop policy if exists guide_reads_resign on public.guide_reads;
create policy guide_reads_resign on public.guide_reads for update to authenticated using (profile_id = auth.uid()) with check (profile_id = auth.uid());

drop policy if exists ops_audits_read on public.ops_audits;
create policy ops_audits_read on public.ops_audits for select to authenticated using (private.my_role() in ('admin','partner'));
drop policy if exists ops_audits_mgr on public.ops_audits;
create policy ops_audits_mgr on public.ops_audits for all to authenticated using (private.my_role() in ('admin','partner')) with check (private.my_role() in ('admin','partner'));

-- كل تعديل على نص الدليل يرفع إصداره، فيُطلب توقيع جديد
create or replace function private.guide_bump() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.body is distinct from old.body then new.version := old.version + 1; end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists guide_bump on public.guides;
create trigger guide_bump before update on public.guides for each row execute function private.guide_bump();

insert into public.guides (title, audience, tagline, sort, body)
select * from (values
('دليل التعقيم والنظافة', 'لكل من تخدم العميلة بيدها', 'العميلة تشوف التعقيم قبل ما تجلس، واللي ما تشوفه نسجّله.', 1, $g$# بين كل عميلة والثانية
- غسل اليدين أو تعقيمها قدام العميلة
- منشفة وغطاء جديد لكل عميلة
- تعقيم الكرسي والمسند وطاولة الأظافر
- أدوات معقّمة من الجهاز، أو جديدة للاستعمال الواحد
- الأمشاط والفرش في المحلول المطهر حسب المدة المكتوبة على العبوة

# الأدوات
| الأداة | طريقة التعقيم | ملاحظة
| أدوات الأظافر المعدنية | غسل، ثم جهاز التعقيم | دورة كاملة قبل الاستعمال
| المقصات والأمشاط | غسل، ثم محلول مطهر | حسب مدة العبوة
| المبارد وأحجار الحك | استعمال واحد | تُرمى بعد العميلة
| عيدان الجلد والقطن | استعمال واحد | تُرمى بعد العميلة
| رؤوس جهاز الأظافر | تنظيف ثم تعقيم | لكل عميلة رأس نظيف
! أي أداة طاحت على الأرض تنعاد للتعقيم، حتى لو كانت نظيفة بالعين.

# المناشف والمفارش
- النظيف في خزانة مغلقة، والمستعمل في سلة لها غطاء
- الغسيل بحرارة عالية، والتنشيف كامل قبل الاستعمال
- منشفة فيها أي بقعة ما تنعطى لعميلة

# نهاية اليوم
- غسل كل الأدوات وتعقيمها، وتأشير قائمة الإقفال
- التخلص من محلول التطهير وتجهيز جديد بكرة
- النفايات في أكياس مغلقة
- إغلاق علب الجيل والصبغات بإحكام ورجوعها لمكانها

# ما يُقال للعميلة
> هذي أدواتك، معقّمة ومغلقة، نفتحها قدامك.
> المبرد جديد ولك أنتِ بس.
$g$),
('دليل السلامة والطوارئ', 'لكل من تعمل في الصالون', 'نعرف وش نسوي قبل ما نحتاجه.', 2, $g$# نعرف مكاننا
- مكان طفايات الحريق وطريقة استعمالها
- مخارج الطوارئ، وما يتسكّر أي مخرج بأغراض
- لوحة الكهرباء الرئيسية وكيف تنفصل
- صندوق الإسعافات عند الاستقبال

# الحريق
- نطلّع العميلات أول، بهدوء ومن أقرب مخرج
- نتصل على الدفاع المدني ٩٩٨
- نفصل الكهرباء إذا كان آمن
- ما نرجع داخل لأي غرض
! السشوار والمكواة ما تنترك شغالة واحنا بعيد عنها.

# الحروق والجروح البسيطة
- ماء بارد جاري على الحرق عشر دقايق
- الجرح يتنظف ويتغطى من صندوق الإسعافات
- نبلّغ الإدارة ونسجّل اللي صار

# الحساسية والإغماء
- أي احمرار أو حكة قوية أو ضيق نفس: نوقف الخدمة فورًا
- نغسل المنطقة بالماء، ونبعد المنتج
- ضيق النفس أو تورم الوجه: نتصل على الإسعاف ٩٩٧ مباشرة
- الإغماء: نمددها ونرفع رجولها ونفتح الهوا

# الأجهزة الكهربائية
- ما يُستعمل جهاز سلكه مقشور أو فيشه محروق
- ما تنركّب أكثر من جهاز حرارة على نفس الفيش
- كل الأجهزة تنفصل في الإقفال

# أرقام الطوارئ
| الجهة | الرقم
| الدفاع المدني | ٩٩٨
| الإسعاف | ٩٩٧
| الشرطة | ٩٩٩
| الرقم الموحد | ٩١١
$g$),
('دليل تجربة عميلة بيوتفريش', 'للاستقبال وكل الأخصائيات', 'العميلة تتذكر شعورها، أكثر من الخدمة نفسها.', 3, $g$# قبل الموعد
- رسالة تأكيد قبل الموعد بيوم، ونطلب منها ترد بكلمة
- إذا عندنا تأخير، نبلّغها قبل ما تطلع من بيتها

# الاستقبال
- ترحيب باسمها خلال ثواني من دخولها
- ضيافة: قهوة أو ماء أو تمر
- إذا فيه انتظار نقول لها المدة وسببها بصراحة
> هلا والله، نورتي بيوتفريش. موعدك جاهز.

# الاستشارة
- نسأل عن أي حساسية أو منتج ما يناسبها
- نشوف ملفها: لونها المفضل، شكل الأظافر، ملاحظات آخر زيارة
- نتفق على الخدمة والسعر قبل البدء، ما فيه مفاجآت بالفاتورة
! الصبغة ما تبدأ إلا بعد اختبار الحساسية حسب تعليمات المنتج.

# أثناء الخدمة
- خصوصيتها أول: ما فيه تصوير إلا بإذنها
- الجوال الشخصي بعيد عن المحطة
- صوت هادئ، وما نتكلم عن عميلات ثانيات

# الوداع
- نوريها النتيجة ونسألها رأيها
- نختم بطاقة الولاء ونقول لها كم باقي
- نقترح موعدها الجاي حسب الخدمة

# بعد الزيارة
- رسالة شكر بعد يومين
- أي ملاحظة منها تنسجّل في «الآراء والملاحظات» وتنحل
$g$),
('دليل يوم العروس', 'لفريق العرايس والاستقبال', 'يوم ما يتكرر، وما فيه مجال للارتجال.', 4, $g$# الحجز
- عربون يثبّت الموعد، ويتسجّل في ملفها
- نكتب: تاريخ الزواج، ووقت الزفة، وعدد المرافقات
- جلسة تجربة قبل الزواج بأسبوعين إلى شهر

# جلسة التجربة
- نصوّر الإطلالة المتفق عليها من أكثر من زاوية
- نسجّل المنتجات والألوان المستخدمة في ملفها
- نختبر الحساسية للمنتجات الجديدة

# قبل الزواج بأسبوع
- تأكيد الموعد والوقت ومكان الزفة
- تأكيد طلبات المرافقات وأوقاتهم
- تجهيز أدوات ومنتجات العروس في صندوق خاص

# يوم الزواج
| الوقت قبل الزفة | الخطوة
| ٦ ساعات | وصول العروس والضيافة
| ٥ ساعات | تجهيز البشرة
| ٤ ساعات | الشعر
| ساعتين | المكياج
| ساعة | الفستان واللمسات الأخيرة والصور
! نحسب نص ساعة احتياط لكل مرحلة. العروس ما تنتظر، واحنا اللي ننتظرها.

# تطلبها العروس معها
- الفستان والطرحة والإكسسوارات
- عباية بأزرار من قدام
- صورة الإطلالة المتفق عليها

# بعد الزواج
- رسالة تهنئة بعد أسبوع
- نطلب رأيها، وصورة بإذنها لألبوم «عرايس بيوتفريش»
$g$)
) v(title, audience, tagline, sort, body)
where not exists (select 1 from public.guides);
