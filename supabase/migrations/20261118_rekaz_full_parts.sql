-- المزامنة الكاملة الليلية مقسّمة على أربع دفعات عشان ما توقف الدالة من طول الوقت
select cron.unschedule(jobid) from cron.job where jobname in ('bf-rekaz-full', 'bf-rekaz-full-base', 'bf-rekaz-full-resv', 'bf-rekaz-full-orders', 'bf-rekaz-full-tx');
select cron.schedule('bf-rekaz-full-base', '20 0 * * *', $$select private.rekaz_kick('full_base')$$);
select cron.schedule('bf-rekaz-full-resv', '30 0 * * *', $$select private.rekaz_kick('full_resv')$$);
select cron.schedule('bf-rekaz-full-orders', '40 0 * * *', $$select private.rekaz_kick('full_orders')$$);
select cron.schedule('bf-rekaz-full-tx', '50 0 * * *', $$select private.rekaz_kick('full_tx')$$);
