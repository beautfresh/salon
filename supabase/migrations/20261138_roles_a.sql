-- الصلاحيات ١: أدوار جديدة للاستقبال والأخصائيات (تنفّذ لحالها قبل ملف b)
alter type public.app_role add value if not exists 'reception';
alter type public.app_role add value if not exists 'specialist';
