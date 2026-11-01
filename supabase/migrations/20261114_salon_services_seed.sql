-- بيوتفريش: خدمات الصالون وأسعارها كما في ركاز (١ نوفمبر ٢٠٢٦)

insert into public.salon_svc_cats (name, grp, role, sort) values
 ('الترميم وبناء الشعر', 'hair', 'hair', 0),
 ('علاجات DR.AN', 'hair', 'hair', 10),
 ('أقنعة للشعر', 'hair', 'hair', 20),
 ('معالجات فروة الرأس', 'hair', 'hair', 30),
 ('المعالجات الحرارية', 'hair', 'hair', 40),
 ('الصبغات', 'hair', 'hair', 50),
 ('تسريح وقص الشعر', 'hair', 'hair', 60),
 ('الأظافر', 'nails', 'nails', 70),
 ('تلوين وتركيب الأظافر', 'nails', 'nails', 80),
 ('ديب أند بيف', 'nails', 'nails', 90),
 ('جيل بوليش', 'nails', 'nails', 100),
 ('إكسبريس جيل بوليش', 'nails', 'nails', 110),
 ('خدمات الوجه', 'face', 'face', 120),
 ('الرموش والحواجب', 'face', 'lashes', 130),
 ('المكياج', 'face', 'makeup', 140)
on conflict (name) do nothing;

do $$
declare sid bigint;
begin
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'فيتامين أو كولور', 'علاج خاص للشعر المصبوغ، يعيد التوازن واللمعان للشعر المصبوغ ويحميه من الجفاف.', 190, 90, false, 0, 'awyl-altym-1-1' from public.salon_svc_cats where name = 'الترميم وبناء الشعر'
  on conflict (rekaz_slug) do nothing returning id into sid;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'قناع الذهب', 'علاج ذهبي للشعر بتركيبة فاخرة من الذهب والكيراتين والكولاجين والفيتامينات الأساسية للعناية بالشعر الجاف والتالف والمتقصف، يمد الشعر بالغذاء اللازم ويحافظ على لمعانه ونعومته.', 190, 90, false, 10, 'awyl-altym-1' from public.salon_svc_cats where name = 'الترميم وبناء الشعر'
  on conflict (rekaz_slug) do nothing returning id into sid;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'أويل ألتيم', 'علاج للشعر الجاف والمستعصي، العلاج بالشمع الدافئ مع الزيوت الفاخرة والأرجان والبروتين النباتي الطبيعي النقي، يضبط ترطيب الشعر ويحدد قوامه وملمسه ويعزز لمعانه.', 190, 90, false, 20, 'awyl-altym' from public.salon_svc_cats where name = 'الترميم وبناء الشعر'
  on conflict (rekaz_slug) do nothing returning id into sid;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'الترميم', 'يعادل درجة الحموضة PH ويرطب الشعر ترطيبًا عميقًا ويغذيه بزيوت فعالة بعد العمليات الكيميائية مثل السحب والصبغات، ويعالج الشعر الجاف والتالف.', 299, 90, true, 30, 'altrmym' from public.salon_svc_cats where name = 'الترميم وبناء الشعر'
  on conflict (rekaz_slug) do nothing returning id into sid;
  if sid is not null then insert into public.salon_service_options (service_id, name, price, duration_min, sort) values
    (sid, 'ترميم VL', 450, 90, 0),
    (sid, 'ترميم L', 400, 90, 1),
    (sid, 'ترميم M', 350, 90, 2),
    (sid, 'ترميم S', 299, 90, 3);
  end if;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'REFRESH SCRUB', null, 120, 30, false, 40, 'pina-colada-hair-masks-1-1-1-1-1' from public.salon_svc_cats where name = 'أقنعة للشعر'
  on conflict (rekaz_slug) do nothing returning id into sid;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'Coco coffee', null, 120, 80, false, 50, 'pina-colada-hair-masks-1' from public.salon_svc_cats where name = 'أقنعة للشعر'
  on conflict (rekaz_slug) do nothing returning id into sid;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'حناء ميمز بليند', null, 130, 120, false, 60, 'pina-colada-hair-masks-1-1' from public.salon_svc_cats where name = 'أقنعة للشعر'
  on conflict (rekaz_slug) do nothing returning id into sid;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'REFRESH SCRUB SIDER', null, 120, 30, false, 70, 'pina-colada-hair-masks-1-1-1-1-1-1' from public.salon_svc_cats where name = 'أقنعة للشعر'
  on conflict (rekaz_slug) do nothing returning id into sid;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'BEAUTFRESH MAGIC OIL', null, 120, 120, false, 80, 'pina-colada-hair-masks-1-1-1-1' from public.salon_svc_cats where name = 'أقنعة للشعر'
  on conflict (rekaz_slug) do nothing returning id into sid;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'سدر ميمز بليند', null, 130, 120, false, 90, 'pina-colada-hair-masks-1-1-1' from public.salon_svc_cats where name = 'أقنعة للشعر'
  on conflict (rekaz_slug) do nothing returning id into sid;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'Piña Colada', null, 120, 80, false, 100, 'pina-colada-hair-masks' from public.salon_svc_cats where name = 'أقنعة للشعر'
  on conflict (rekaz_slug) do nothing returning id into sid;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'Almond Breeze', null, 120, 80, false, 110, 'almond-breeze-hair-masks' from public.salon_svc_cats where name = 'أقنعة للشعر'
  on conflict (rekaz_slug) do nothing returning id into sid;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'Intensive Scalp Detox', null, 220, 60, false, 120, 'intensive-scalp-detox' from public.salon_svc_cats where name = 'معالجات فروة الرأس'
  on conflict (rekaz_slug) do nothing returning id into sid;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'BB Cream', null, 1000, 240, true, 130, 'brwtyn-1-1-1' from public.salon_svc_cats where name = 'المعالجات الحرارية'
  on conflict (rekaz_slug) do nothing returning id into sid;
  if sid is not null then insert into public.salon_service_options (service_id, name, price, duration_min, sort) values
    (sid, 'BB Cream قصير', 1000, 240, 0),
    (sid, 'BB Cream متوسط', 1300, 240, 1),
    (sid, 'BB Cream طويل', 1600, 240, 2),
    (sid, 'BB Cream طويل جدًا', 1900, 240, 3),
    (sid, 'BB Cream طويل جدًا ×٢', 2300, 240, 4);
  end if;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'تنعيم', null, 1000, 240, false, 140, 'brwtyn-1-1' from public.salon_svc_cats where name = 'المعالجات الحرارية'
  on conflict (rekaz_slug) do nothing returning id into sid;
  if sid is not null then insert into public.salon_service_options (service_id, name, price, duration_min, sort) values
    (sid, 'تنعيم قصير', 1000, 240, 0),
    (sid, 'تنعيم متوسط', 1300, 240, 1),
    (sid, 'تنعيم طويل', 1600, 240, 2),
    (sid, 'تنعيم طويل جدًا', 1900, 240, 3),
    (sid, 'تنعيم طويل جدًا ×٢', 2300, 240, 4);
  end if;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'بوتوكس', null, 1000, 240, false, 150, 'brwtyn-1' from public.salon_svc_cats where name = 'المعالجات الحرارية'
  on conflict (rekaz_slug) do nothing returning id into sid;
  if sid is not null then insert into public.salon_service_options (service_id, name, price, duration_min, sort) values
    (sid, 'بوتوكس S', 1000, 240, 0),
    (sid, 'بوتوكس M', 1300, 240, 1),
    (sid, 'بوتوكس L', 1600, 240, 2),
    (sid, 'بوتوكس VL', 1900, 240, 3);
  end if;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'بروتين', null, 1000, 240, false, 160, 'brwtyn' from public.salon_svc_cats where name = 'المعالجات الحرارية'
  on conflict (rekaz_slug) do nothing returning id into sid;
  if sid is not null then insert into public.salon_service_options (service_id, name, price, duration_min, sort) values
    (sid, 'بروتين S', 1000, 240, 0),
    (sid, 'بروتين M', 1300, 240, 1),
    (sid, 'بروتين L', 1600, 240, 2),
    (sid, 'بروتين VL', 1900, 240, 3);
  end if;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'قص أطراف بالآلة', null, 60, 20, false, 170, 's-alshar-ma-astshwar-1-1' from public.salon_svc_cats where name = 'تسريح وقص الشعر'
  on conflict (rekaz_slug) do nothing returning id into sid;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'قص الشعر مع استشوار', 'يتحدد السعر حسب طول الشعر.', 200, 60, false, 180, 's-alshar-ma-astshwar' from public.salon_svc_cats where name = 'تسريح وقص الشعر'
  on conflict (rekaz_slug) do nothing returning id into sid;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'استشوار شعر كلاسيك', null, 80, 60, false, 190, 'astshwar-shar' from public.salon_svc_cats where name = 'تسريح وقص الشعر'
  on conflict (rekaz_slug) do nothing returning id into sid;
  if sid is not null then insert into public.salon_service_options (service_id, name, price, duration_min, sort) values
    (sid, 'كلاسيك S', 80, 60, 0),
    (sid, 'كلاسيك M', 100, 60, 1),
    (sid, 'كلاسيك L', 120, 60, 2),
    (sid, 'كلاسيك VL', 140, 60, 3),
    (sid, 'كلاسيك 2VL', 180, 60, 4);
  end if;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'استشوار شعر - Beautfresh Signature', null, 120, 60, true, 200, 'astshwar-shar-beautfresh-signature' from public.salon_svc_cats where name = 'تسريح وقص الشعر'
  on conflict (rekaz_slug) do nothing returning id into sid;
  if sid is not null then insert into public.salon_service_options (service_id, name, price, duration_min, sort) values
    (sid, 'Signature S', 120, 60, 0),
    (sid, 'Signature M', 140, 60, 1),
    (sid, 'Signature L', 160, 60, 2),
    (sid, 'Signature VL', 200, 60, 3);
  end if;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'قص غرة', null, 30, 20, false, 210, 's-alshar-ma-astshwar-1-1-1-1' from public.salon_svc_cats where name = 'تسريح وقص الشعر'
  on conflict (rekaz_slug) do nothing returning id into sid;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'قص أطفال', null, 40, 20, false, 220, 's-alshar-ma-astshwar-1-1-1' from public.salon_svc_cats where name = 'تسريح وقص الشعر'
  on conflict (rekaz_slug) do nothing returning id into sid;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'تسريح شعر', null, 250, 90, false, 230, 'tsryh-shar' from public.salon_svc_cats where name = 'تسريح وقص الشعر'
  on conflict (rekaz_slug) do nothing returning id into sid;
  if sid is not null then insert into public.salon_service_options (service_id, name, price, duration_min, sort) values
    (sid, 'تسريح S', 250, 90, 0),
    (sid, 'تسريح M', 350, 90, 1),
    (sid, 'تسريح L', 450, 90, 2),
    (sid, 'تسريح VL', 550, 90, 3);
  end if;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'إضافة بنس للشعر', null, 30, 5, false, 240, 'adafh-bns-llshar' from public.salon_svc_cats where name = 'تسريح وقص الشعر'
  on conflict (rekaz_slug) do nothing returning id into sid;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'تفتيح حواجب', null, 35, 10, false, 250, 'qs-hwajb-1-1-1' from public.salon_svc_cats where name = 'خدمات الوجه'
  on conflict (rekaz_slug) do nothing returning id into sid;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'قص حواجب', null, 23, 20, false, 260, 'qs-hwajb' from public.salon_svc_cats where name = 'خدمات الوجه'
  on conflict (rekaz_slug) do nothing returning id into sid;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'صبغ حواجب', null, 35, 30, false, 270, 'qs-hwajb-1-1' from public.salon_svc_cats where name = 'خدمات الوجه'
  on conflict (rekaz_slug) do nothing returning id into sid;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'تشقير حواجب', null, 35, 30, false, 280, 'qs-hwajb-1' from public.salon_svc_cats where name = 'خدمات الوجه'
  on conflict (rekaz_slug) do nothing returning id into sid;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'حف خيط حول الشفاه', null, 30, 30, false, 290, 'qs-hwajb-1-1-1-1' from public.salon_svc_cats where name = 'خدمات الوجه'
  on conflict (rekaz_slug) do nothing returning id into sid;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'حف وجه', null, 55, 60, false, 300, 'qs-hwajb-1-1-1-1-1' from public.salon_svc_cats where name = 'خدمات الوجه'
  on conflict (rekaz_slug) do nothing returning id into sid;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'كومبو أوه لا لا', null, 349, 90, false, 310, 'manykyr-1-1-1-1' from public.salon_svc_cats where name = 'الأظافر'
  on conflict (rekaz_slug) do nothing returning id into sid;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'بديكير أوه لا لا', null, 190, 60, false, 320, 'manykyr-1-1-1' from public.salon_svc_cats where name = 'الأظافر'
  on conflict (rekaz_slug) do nothing returning id into sid;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'مانيكير أوه لا لا', null, 175, 45, false, 330, 'manykyr-1-1' from public.salon_svc_cats where name = 'الأظافر'
  on conflict (rekaz_slug) do nothing returning id into sid;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'كومبو بيوتفريش', null, 265, 90, true, 340, 'manykyr-1' from public.salon_svc_cats where name = 'الأظافر'
  on conflict (rekaz_slug) do nothing returning id into sid;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'مانيكير بيوتفريش', null, 138, 45, true, 350, 'manykyr' from public.salon_svc_cats where name = 'الأظافر'
  on conflict (rekaz_slug) do nothing returning id into sid;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'فاست رفرش', null, 104, 80, false, 360, 'kwmbw-fast-rfrsh' from public.salon_svc_cats where name = 'الأظافر'
  on conflict (rekaz_slug) do nothing returning id into sid;
  if sid is not null then insert into public.salon_service_options (service_id, name, price, duration_min, sort) values
    (sid, 'كومبو فاست رفرش', 190, 80, 0),
    (sid, 'مناكير فاست رفرش', 104, 45, 1),
    (sid, 'بدكير فاست رفرش', 115, 60, 2);
  end if;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'رسم على ظفر واحد', null, 18, 10, false, 370, 'rsm-azafr-kaml-1' from public.salon_svc_cats where name = 'تلوين وتركيب الأظافر'
  on conflict (rekaz_slug) do nothing returning id into sid;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'رسم أظافر كامل', null, 160, 60, false, 380, 'rsm-azafr-kaml' from public.salon_svc_cats where name = 'تلوين وتركيب الأظافر'
  on conflict (rekaz_slug) do nothing returning id into sid;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'أومبري', null, 75, 50, false, 390, 'lwn-wahd-asasy-1-1-1' from public.salon_svc_cats where name = 'تلوين وتركيب الأظافر'
  on conflict (rekaz_slug) do nothing returning id into sid;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'لون ستايل فرنسي', null, 55, 50, false, 400, 'lwn-wahd-asasy-1-1' from public.salon_svc_cats where name = 'تلوين وتركيب الأظافر'
  on conflict (rekaz_slug) do nothing returning id into sid;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'لون واحد أساسي - BREATHABLE', null, 41, 20, false, 410, 'lwn-wahd-asasy-1' from public.salon_svc_cats where name = 'تلوين وتركيب الأظافر'
  on conflict (rekaz_slug) do nothing returning id into sid;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'لون واحد أساسي', null, 35, 20, false, 420, 'lwn-wahd-asasy' from public.salon_svc_cats where name = 'تلوين وتركيب الأظافر'
  on conflict (rekaz_slug) do nothing returning id into sid;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'أظافر بلاستيك + لون أساسي جيل', null, 250, 180, false, 430, 'azafr-blastyk-lwn-jyl' from public.salon_svc_cats where name = 'تلوين وتركيب الأظافر'
  on conflict (rekaz_slug) do nothing returning id into sid;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'البياب', null, 129, 180, false, 440, 'albyab' from public.salon_svc_cats where name = 'تلوين وتركيب الأظافر'
  on conflict (rekaz_slug) do nothing returning id into sid;
  if sid is not null then insert into public.salon_service_options (service_id, name, price, duration_min, sort) values
    (sid, 'بياب تركيب أظافر', 329, 180, 0),
    (sid, 'بياب طبقة حماية', 199, 180, 1),
    (sid, 'بياب إعادة تعبئة', 129, 180, 2),
    (sid, 'إزالة البياب', 179, 180, 3);
  end if;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'أظافر بلاستيك + لون أومبري جيل', null, 300, 180, false, 450, 'azafr-blastyk-lwn-jyl-1-1' from public.salon_svc_cats where name = 'تلوين وتركيب الأظافر'
  on conflict (rekaz_slug) do nothing returning id into sid;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'أظافر بلاستيك + لون فرنسي جيل', null, 300, 180, false, 460, 'azafr-blastyk-lwn-jyl-1' from public.salon_svc_cats where name = 'تلوين وتركيب الأظافر'
  on conflict (rekaz_slug) do nothing returning id into sid;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'إزالة ديب أند بيف', null, 179, 180, false, 470, 'dyb-and-byf-bdwn-trkyb-1-1-1' from public.salon_svc_cats where name = 'ديب أند بيف'
  on conflict (rekaz_slug) do nothing returning id into sid;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'ديب أند بيف - إعادة تعبئة اللون', null, 140, 180, false, 480, 'dyb-and-byf-bdwn-trkyb-1-1' from public.salon_svc_cats where name = 'ديب أند بيف'
  on conflict (rekaz_slug) do nothing returning id into sid;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'ديب أند بيف - مع تركيب بلاستيك', null, 280, 180, false, 490, 'dyb-and-byf-bdwn-trkyb-1' from public.salon_svc_cats where name = 'ديب أند بيف'
  on conflict (rekaz_slug) do nothing returning id into sid;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'ديب أند بيف - بدون تركيب', null, 190, 180, false, 500, 'dyb-and-byf-bdwn-trkyb' from public.salon_svc_cats where name = 'ديب أند بيف'
  on conflict (rekaz_slug) do nothing returning id into sid;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'جيل بوليش - رسم على ظفر واحد', null, 23, 15, false, 510, 'jyl-bwlysh-1-1-1-2' from public.salon_svc_cats where name = 'جيل بوليش'
  on conflict (rekaz_slug) do nothing returning id into sid;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'إزالة جيل بوليش', null, 179, 90, false, 520, 'jyl-bwlysh-1-1-1-1' from public.salon_svc_cats where name = 'جيل بوليش'
  on conflict (rekaz_slug) do nothing returning id into sid;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'جيل بوليش - كروم', null, 150, 90, false, 530, 'jyl-bwlysh-1-1-1' from public.salon_svc_cats where name = 'جيل بوليش'
  on conflict (rekaz_slug) do nothing returning id into sid;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'جيل بوليش - أومبري', null, 150, 90, false, 540, 'jyl-bwlysh-1-1' from public.salon_svc_cats where name = 'جيل بوليش'
  on conflict (rekaz_slug) do nothing returning id into sid;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'جيل بوليش - ستايل فرنسي', null, 150, 60, false, 550, 'jyl-bwlysh-1' from public.salon_svc_cats where name = 'جيل بوليش'
  on conflict (rekaz_slug) do nothing returning id into sid;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'جيل بوليش', null, 100, 60, true, 560, 'jyl-bwlysh' from public.salon_svc_cats where name = 'جيل بوليش'
  on conflict (rekaz_slug) do nothing returning id into sid;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'إكسبريس جيل بوليش ستايل فرنسي', null, 200, 120, false, 570, 'jyl-bwlysh-1-1-1-2-1-1-1' from public.salon_svc_cats where name = 'إكسبريس جيل بوليش'
  on conflict (rekaz_slug) do nothing returning id into sid;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'إكسبريس جيل بوليش أومبري', null, 200, 120, false, 580, 'jyl-bwlysh-1-1-1-2-1-1' from public.salon_svc_cats where name = 'إكسبريس جيل بوليش'
  on conflict (rekaz_slug) do nothing returning id into sid;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'إكسبريس جيل بوليش', null, 150, 90, false, 590, 'jyl-bwlysh-1-1-1-2-1' from public.salon_svc_cats where name = 'إكسبريس جيل بوليش'
  on conflict (rekaz_slug) do nothing returning id into sid;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'إزالة الرموش', null, 95, 15, false, 600, 'azalh-alrmwsh-lash-removal' from public.salon_svc_cats where name = 'الرموش والحواجب'
  on conflict (rekaz_slug) do nothing returning id into sid;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'قناع DR.AN · Hydrate', null, 190, 60, false, 610, 'x69' from public.salon_svc_cats where name = 'علاجات DR.AN'
  on conflict (rekaz_slug) do nothing returning id into sid;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'BB Touch · حراري', 'علاج حراري يهدّي نفشة الشعر ويرمم الشعر المصبوغ والمسحوب لونه، بالبيوتين والهيالورونيك، ويدوم ٣ شهور.', 1000, 240, false, 620, 'x70' from public.salon_svc_cats where name = 'علاجات DR.AN'
  on conflict (rekaz_slug) do nothing returning id into sid;
  if sid is not null then insert into public.salon_service_options (service_id, name, price, duration_min, sort) values
    (sid, 'BB Touch حراري S', 1000, 240, 0),
    (sid, 'BB Touch حراري M', 1300, 240, 1),
    (sid, 'BB Touch حراري L', 1600, 240, 2),
    (sid, 'BB Touch حراري VL', 1900, 240, 3);
  end if;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'BB Touch · بارد', 'جلسة شهرية على البارد.', 600, 120, false, 630, 'x71' from public.salon_svc_cats where name = 'علاجات DR.AN'
  on conflict (rekaz_slug) do nothing returning id into sid;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'جلسة القوة الثلاثية', 'جلسة معززة بثلاث أمبولات: الخلايا الجذعية، الذهب والفضة، والبيوتين مع الهيالورونيك والبوتوكس.', 700, 120, false, 640, 'x72' from public.salon_svc_cats where name = 'علاجات DR.AN'
  on conflict (rekaz_slug) do nothing returning id into sid;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'علاج الأمبولات الطبية', 'عدد الجلسات حسب حالة الشعر، مع منتجات العناية في البيت.', 400, 120, false, 650, 'x73' from public.salon_svc_cats where name = 'علاجات DR.AN'
  on conflict (rekaz_slug) do nothing returning id into sid;
  if sid is not null then insert into public.salon_service_options (service_id, name, price, duration_min, sort) values
    (sid, 'أمبولات البوتوكس', 400, 120, 0),
    (sid, 'أمبولات التساقط والإنبات', 400, 120, 1),
    (sid, 'الخلايا الجذعية بماء الذهب والفضة', 400, 120, 2);
  end if;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'DR.AN Spider', null, 190, 60, false, 660, 'x74' from public.salon_svc_cats where name = 'علاجات DR.AN'
  on conflict (rekaz_slug) do nothing returning id into sid;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'صبغ جذور', null, 250, 60, false, 670, 'x75' from public.salon_svc_cats where name = 'الصبغات'
  on conflict (rekaz_slug) do nothing returning id into sid;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'Combo Hair Color', null, 1100, 300, false, 680, 'x76' from public.salon_svc_cats where name = 'الصبغات'
  on conflict (rekaz_slug) do nothing returning id into sid;
  if sid is not null then insert into public.salon_service_options (service_id, name, price, duration_min, sort) values
    (sid, 'Combo Hair Color S', 1100, 300, 0),
    (sid, 'Combo Hair Color M', 1550, 300, 1),
    (sid, 'Combo Hair Color L', 2000, 300, 2),
    (sid, 'Combo Hair Color VL', 2600, 300, 3);
  end if;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'رنساج', null, 200, 40, false, 690, 'x77' from public.salon_svc_cats where name = 'الصبغات'
  on conflict (rekaz_slug) do nothing returning id into sid;
  if sid is not null then insert into public.salon_service_options (service_id, name, price, duration_min, sort) values
    (sid, 'رنساج قصير', 200, 40, 0),
    (sid, 'رنساج متوسط', 300, 40, 1),
    (sid, 'رنساج طويل', 400, 40, 2),
    (sid, 'رنساج طويل جدًا', 500, 40, 3);
  end if;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'مكياج', null, 400, 120, false, 700, 'x78' from public.salon_svc_cats where name = 'المكياج'
  on conflict (rekaz_slug) do nothing returning id into sid;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'غسيل شعر', null, 20, 10, false, 710, 'x79' from public.salon_svc_cats where name = 'تسريح وقص الشعر'
  on conflict (rekaz_slug) do nothing returning id into sid;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'تدريم الشعر · قص أطراف', null, 60, 20, false, 720, 'x80' from public.salon_svc_cats where name = 'تسريح وقص الشعر'
  on conflict (rekaz_slug) do nothing returning id into sid;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'بيوتفريش طيب', 'تبخير الشعر بمبخر خاص، مع اختيار نوع العود من ثلاثة خيارات. رائحة راقية تدوم طول اليوم.', 19, 5, false, 730, 'x81' from public.salon_svc_cats where name = 'تسريح وقص الشعر'
  on conflict (rekaz_slug) do nothing returning id into sid;
  if sid is not null then insert into public.salon_service_options (service_id, name, price, duration_min, sort) values
    (sid, 'عود بيور', 24, 5, 0),
    (sid, 'روز', 19, 5, 1),
    (sid, 'عنبر', 19, 5, 2);
  end if;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'استشارة شعر · صبغة، بروتين، معالج', null, 100, 30, false, 740, 'x82' from public.salon_svc_cats where name = 'الترميم وبناء الشعر'
  on conflict (rekaz_slug) do nothing returning id into sid;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'بدكير بيوتفريش', 'إزالة الجلد الزائد مع تقليم وبرد الأظافر، ومقشر طبيعي يتحضّر يوميًا عندنا، وكريم مرطب ولون واحد للقدمين.', 150, 45, false, 750, 'x83' from public.salon_svc_cats where name = 'الأظافر'
  on conflict (rekaz_slug) do nothing returning id into sid;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'سوفت جيل', null, 35, 240, false, 760, 'x84' from public.salon_svc_cats where name = 'تلوين وتركيب الأظافر'
  on conflict (rekaz_slug) do nothing returning id into sid;
  if sid is not null then insert into public.salon_service_options (service_id, name, price, duration_min, sort) values
    (sid, 'سوفت جيل مع لون عادي', 350, 240, 0),
    (sid, 'سوفت جيل ظفر واحد', 35, 240, 1),
    (sid, 'إزالة سوفت جيل', 179, 240, 2);
  end if;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'بولي جيل', null, 45, 240, false, 770, 'x85' from public.salon_svc_cats where name = 'تلوين وتركيب الأظافر'
  on conflict (rekaz_slug) do nothing returning id into sid;
  if sid is not null then insert into public.salon_service_options (service_id, name, price, duration_min, sort) values
    (sid, 'بولي جيل مع لون عادي', 450, 240, 0),
    (sid, 'إعادة تعبئة بولي جيل', 288, 240, 1),
    (sid, 'بولي جيل ظفر واحد', 45, 240, 2),
    (sid, 'إزالة بولي جيل', 179, 240, 3);
  end if;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'لون جيل كوتور', null, 65, 20, false, 780, 'x86' from public.salon_svc_cats where name = 'تلوين وتركيب الأظافر'
  on conflict (rekaz_slug) do nothing returning id into sid;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'إضافة إكسسوار (للظفر)', null, 6, 10, false, 790, 'x87' from public.salon_svc_cats where name = 'تلوين وتركيب الأظافر'
  on conflict (rekaz_slug) do nothing returning id into sid;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'تركيب رموش · Signature Sweep (كلاسيك)', null, 165, 40, false, 800, 'lash-80' from public.salon_svc_cats where name = 'الرموش والحواجب'
  on conflict (rekaz_slug) do nothing returning id into sid;
  if sid is not null then insert into public.salon_service_options (service_id, name, price, duration_min, sort) values
    (sid, 'تركيب', 299, 40, 0),
    (sid, 'إعادة تعبئة', 165, 40, 1);
  end if;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'تركيب رموش · Flawless Blend (هايبرد)', null, 189, 90, false, 810, 'lash-81' from public.salon_svc_cats where name = 'الرموش والحواجب'
  on conflict (rekaz_slug) do nothing returning id into sid;
  if sid is not null then insert into public.salon_service_options (service_id, name, price, duration_min, sort) values
    (sid, 'تركيب', 389, 90, 0),
    (sid, 'إعادة تعبئة', 189, 90, 1);
  end if;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'تركيب رموش · Foxy Lift (عين القطة)', null, 179, 90, false, 820, 'lash-82' from public.salon_svc_cats where name = 'الرموش والحواجب'
  on conflict (rekaz_slug) do nothing returning id into sid;
  if sid is not null then insert into public.salon_service_options (service_id, name, price, duration_min, sort) values
    (sid, 'تركيب', 359, 90, 0),
    (sid, 'إعادة تعبئة', 179, 90, 1);
  end if;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'تركيب رموش · Airy Wisps (ويسبي)', null, 199, 90, false, 830, 'lash-83' from public.salon_svc_cats where name = 'الرموش والحواجب'
  on conflict (rekaz_slug) do nothing returning id into sid;
  if sid is not null then insert into public.salon_service_options (service_id, name, price, duration_min, sort) values
    (sid, 'تركيب', 399, 90, 0),
    (sid, 'إعادة تعبئة', 199, 90, 1);
  end if;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'تركيب رموش · Velvet Volume (فوليوم)', null, 259, 90, false, 840, 'lash-84' from public.salon_svc_cats where name = 'الرموش والحواجب'
  on conflict (rekaz_slug) do nothing returning id into sid;
  if sid is not null then insert into public.salon_service_options (service_id, name, price, duration_min, sort) values
    (sid, 'تركيب', 469, 90, 0),
    (sid, 'إعادة تعبئة', 259, 90, 1);
  end if;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'رفع الرموش · Lash Lift', null, 329, 40, false, 850, 'lift-85' from public.salon_svc_cats where name = 'الرموش والحواجب'
  on conflict (rekaz_slug) do nothing returning id into sid;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'رفع الحواجب · Brow Lift', null, 269, 40, false, 860, 'lift-86' from public.salon_svc_cats where name = 'الرموش والحواجب'
  on conflict (rekaz_slug) do nothing returning id into sid;
  sid := null;
  insert into public.salon_services (cat_id, name, description, price, duration_min, popular, sort, rekaz_slug)
  select id, 'رفع الرموش والحواجب', null, 569, 60, false, 870, 'lift-87' from public.salon_svc_cats where name = 'الرموش والحواجب'
  on conflict (rekaz_slug) do nothing returning id into sid;
  sid := null;
end $$;
