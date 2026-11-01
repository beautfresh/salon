-- ترتيب أسماء الخدمات (من ركاز): بدون حروف كبيرة صارخة وبدون شرطات
update public.salon_services set name = replace(name, ' - ', ' · ') where name like '% - %';
update public.salon_services set name = 'Refresh Scrub' where name = 'REFRESH SCRUB';
update public.salon_services set name = 'Refresh Scrub · سدر' where name = 'REFRESH SCRUB SIDER';
update public.salon_services set name = 'Beautfresh Magic Oil' where name = 'BEAUTFRESH MAGIC OIL';
update public.salon_services set name = 'قص أطراف بالآلة' where name = 'قص أطراف بالالة';
update public.salon_services set name = 'لون واحد أساسي · Breathable' where name in ('لون واحد أساسي · BREATHABLE', 'لون واحد أساسي - BREATHABLE');
update public.salon_services set name = 'استشوار Beautfresh Signature' where name in ('استشوار شعر · Beautfresh Signature', 'استشوار شعر - Beautfresh Signature');
update public.salon_services set name = 'استشوار كلاسيك' where name = 'استشوار شعر كلاسيك';
update public.salon_services set name = 'كومبو بيوتفريش' where name = 'كومبو بيوتفرش';
update public.salon_services set name = 'أظافر بلاستيك + لون أساسي جيل' where name = 'أظافر بلاستيك + لون اساسي جيل';
update public.salon_services set name = 'أظافر بلاستيك + لون أومبري جيل' where name = 'أظافر بلاستيك +لون أومبري جيل';
update public.salon_services set name = 'أظافر بلاستيك + لون فرنسي جيل' where name = 'أظافر بلاستيك +لون فرنسي جيل';
update public.salon_services set name = 'قص أطفال' where name = 'قص اطفال';
update public.salon_service_options set name = replace(replace(name, 'استشوار شعر - BEAUTFRESH SIGNATURE -', 'Signature'), 'استشوار شعر - BEAUTFRESH SIGNATURE', 'Signature');
update public.salon_service_options set name = replace(name, 'استشوار شعر كلاسيك - ', 'كلاسيك ');
update public.salon_service_options set name = replace(name, 'BB CREAM', 'BB Cream');
update public.salon_service_options set name = replace(name, ' - ', ' ') where name like '% - %';
