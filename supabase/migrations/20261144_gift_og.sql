-- معاينة رابط الهدية (واتساب وغيره): الاسم والمناسبة والتصميم بس، وبدون ما تنحسب «انفتحت»
create or replace function public.gift_og(p_token uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('to', split_part(coalesce(v.to_name, ''), ' ', 1), 'from', split_part(coalesce(v.from_name, ''), ' ', 1),
    'occasion', v.occasion, 'theme', coalesce(v.design->>'theme', 'oud'))
  from public.gift_vouchers v where v.token = p_token and v.status not in ('pending', 'cancelled')
$$;
revoke all on function public.gift_og(uuid) from public;
grant execute on function public.gift_og(uuid) to anon, authenticated;
