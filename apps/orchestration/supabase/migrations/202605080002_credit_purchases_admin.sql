create table if not exists public.credit_packages (
  id text primary key,
  name text not null,
  credits integer not null check (credits > 0),
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'usd',
  stripe_price_id text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.credit_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  package_id text references public.credit_packages(id),
  credits integer not null check (credits > 0),
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'usd',
  status text not null default 'pending' check (status in ('pending', 'completed', 'failed', 'canceled', 'refunded')),
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.admin_credit_adjustments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  amount integer not null check (amount <> 0),
  reason text not null,
  admin_actor text not null,
  created_at timestamptz not null default now()
);

alter table public.credit_packages enable row level security;
alter table public.credit_purchases enable row level security;
alter table public.admin_credit_adjustments enable row level security;

drop policy if exists "Active credit packages are readable" on public.credit_packages;
create policy "Active credit packages are readable"
on public.credit_packages for select to authenticated
using (active = true);

drop policy if exists "Users read own credit purchases" on public.credit_purchases;
create policy "Users read own credit purchases"
on public.credit_purchases for select to authenticated
using ((select auth.uid()) = user_id);

create index if not exists credit_purchases_user_created_idx
on public.credit_purchases(user_id, created_at desc);

create index if not exists admin_credit_adjustments_user_created_idx
on public.admin_credit_adjustments(user_id, created_at desc);

insert into public.credit_packages (id, name, credits, amount_cents, currency)
values
  ('starter_100', 'Starter', 100, 900, 'usd'),
  ('growth_500', 'Growth', 500, 3900, 'usd'),
  ('pro_1500', 'Pro', 1500, 9900, 'usd')
on conflict (id) do update set
  name = excluded.name,
  credits = excluded.credits,
  amount_cents = excluded.amount_cents,
  currency = excluded.currency,
  active = true,
  updated_at = now();

create or replace function public.complete_credit_purchase(
  p_purchase_id uuid,
  p_checkout_session_id text,
  p_payment_intent_id text
)
returns public.credit_purchases
language plpgsql
security definer
set search_path = public
as $$
declare
  v_purchase public.credit_purchases;
begin
  select *
  into v_purchase
  from public.credit_purchases
  where (p_purchase_id is not null and id = p_purchase_id)
     or (p_checkout_session_id is not null and stripe_checkout_session_id = p_checkout_session_id)
  for update;

  if not found then
    return null;
  end if;

  if v_purchase.status = 'completed' then
    return v_purchase;
  end if;

  update public.credit_purchases
  set
    status = 'completed',
    stripe_checkout_session_id = coalesce(p_checkout_session_id, stripe_checkout_session_id),
    stripe_payment_intent_id = coalesce(p_payment_intent_id, stripe_payment_intent_id),
    completed_at = now(),
    updated_at = now()
  where id = v_purchase.id
  returning * into v_purchase;

  insert into public.credit_transactions (user_id, amount, reason, metadata)
  values (
    v_purchase.user_id,
    v_purchase.credits,
    'credit_purchase',
    jsonb_build_object(
      'purchaseId', v_purchase.id,
      'checkoutSessionId', v_purchase.stripe_checkout_session_id
    )
  );

  update public.user_credit_accounts
  set paid_credits = paid_credits + v_purchase.credits,
      updated_at = now()
  where user_id = v_purchase.user_id;

  return v_purchase;
end;
$$;
