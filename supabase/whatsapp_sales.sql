-- Tabela das vendas do WhatsApp (lib/sales.ts). Rode uma vez no SQL Editor do
-- projeto Supabase escolhido. RLS ligado sem policies: só a service_role entra.
create table whatsapp_sales (
  id uuid primary key default gen_random_uuid(),
  account_id text not null,
  campaign_id text not null,
  campaign_name text not null,
  sold_on date not null,
  amount numeric(12,2) not null check (amount > 0),
  note text,
  created_at timestamptz not null default now()
);
create index on whatsapp_sales (account_id, sold_on);
alter table whatsapp_sales enable row level security;
