// إعدادات الاتصال بقاعدة البيانات.
// المفتاح هنا مفتاح عام مصمم للاستخدام في الواجهة، والحماية الفعلية عبر صلاحيات قاعدة البيانات.
window.APP_CONFIG = {
  supabaseUrl: 'https://enrlujtrysrlzwbjexey.supabase.co',
  supabaseKey: 'sb_publishable_28HPaKcl04mJcGOx28vCWA_9_e14OOJ',
  appName: 'مخزون الصالون',
  loginDomain: 'salon.local',
  expiryWarningDays: 60,
  // مفتاح عام لإشعارات الجوال (Web Push)، والمفتاح الخاص محفوظ في قاعدة البيانات
  vapidPublicKey: 'BMZ4yzqerFd2J3t1R-9-H9AIw71fF4BqMA9R7avqxDqn5ctP7k-cxa5pjF6UB6XFPMU8d6L1TOthoXj5Q2I-TKI',
};
