-- Cadastro de e-mails para os alertas do painel (função alertas). Todas as tabelas têm RLS ligado e nenhuma política:
-- só a função (chave de serviço) lê e escreve; a chave pública não enxerga nada.
create table if not exists public.alertas_assinantes (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  estado text not null default 'pendente' check (estado in ('pendente', 'confirmado', 'saiu')),
  token_confirmar text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  token_sair text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  criado_em timestamptz not null default now(),
  confirmacao_enviada_em timestamptz,
  confirmado_em timestamptz,
  saiu_em timestamptz,
  constraint alertas_email_formato check (email = lower(email) and length(email) <= 254 and email ~ '^[^@\s<>",;]+@[^@\s<>",;]+\.[^@\s<>",;]+$')
);
create unique index if not exists alertas_assinantes_email on public.alertas_assinantes (email);
create unique index if not exists alertas_assinantes_token_confirmar on public.alertas_assinantes (token_confirmar);
create unique index if not exists alertas_assinantes_token_sair on public.alertas_assinantes (token_sair);
create index if not exists alertas_assinantes_estado on public.alertas_assinantes (estado);

create table if not exists public.alertas_config (
  chave text primary key,
  valor text not null
);

create table if not exists public.alertas_log (
  id bigint generated always as identity primary key,
  evento text not null,
  criado_em timestamptz not null default now()
);
create index if not exists alertas_log_evento on public.alertas_log (evento, criado_em);

alter table public.alertas_assinantes enable row level security;
alter table public.alertas_config enable row level security;
alter table public.alertas_log enable row level security;
revoke all on public.alertas_assinantes, public.alertas_config, public.alertas_log from anon, authenticated;

-- convite: gerado uma vez, ao criar (para trocar: update public.alertas_config set valor = ... where chave = 'codigo_convite')
insert into public.alertas_config (chave, valor)
values ('codigo_convite', substr(replace(gen_random_uuid()::text, '-', ''), 1, 16))
on conflict (chave) do nothing;
