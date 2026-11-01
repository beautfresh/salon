-- بيوتفريش: بطاقة الولاء الرقمية للعميلة (رابط خاص لكل عميلة)

alter table public.clients add column if not exists card_token uuid not null default gen_random_uuid();
create unique index if not exists clients_card_token_idx on public.clients (card_token);

create or replace function public.bf_loyalty_card(p_token uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c public.clients; L public.loyalty_settings; v int; red int; k jsonb;
begin
  select * into c from public.clients where card_token = p_token;
  if c.id is null then return null; end if;
  select * into L from public.loyalty_settings where id = 1;
  select count(*) into v from public.client_visits where client_id = c.id;
  select count(*) into red from public.loyalty_redemptions where client_id = c.id;
  select data into k from public.kit_profile where id = 1;
  return jsonb_build_object(
    'name', split_part(trim(c.name), ' ', 1),
    'active', coalesce(L.active, false),
    'stamps_total', coalesce(L.stamps, 6),
    'stamps', greatest(0, v - red * coalesce(L.stamps, 6)),
    'reward', L.reward,
    'visits', v,
    'redeemed', red,
    'since', (select min(day) from public.client_visits where client_id = c.id),
    'last', (select max(day) from public.client_visits where client_id = c.id),
    'vip', c.vip,
    'recent', coalesce((select jsonb_agg(jsonb_build_object('day', day, 'services', services, 'home', channel = 'home') order by day desc) from (select * from public.client_visits where client_id = c.id order by day desc, id desc limit 5) x), '[]'::jsonb),
    'booking', k->>'booking', 'whatsapp', k->>'whatsapp', 'instagram', k->>'instagram'
  );
end $$;
revoke all on function public.bf_loyalty_card(uuid) from public;
grant execute on function public.bf_loyalty_card(uuid) to anon, authenticated;
