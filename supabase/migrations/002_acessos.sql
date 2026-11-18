-- Contagem de logins do painel (função alertas, ação "acesso"): quantas pessoas entraram em cada dia e quantas vezes.
-- Não guarda nome nem e-mail: "pessoa" é um código de 12 caracteres calculado no servidor do painel a partir do usuário e de um segredo
-- (o mesmo usuário gera sempre o mesmo código, mas o código não leva de volta ao usuário). RLS ligado e sem política: só a função lê e escreve.
create table if not exists public.acessos_login (
  dia date not null,
  pessoa text not null check (pessoa ~ '^[0-9a-f]{12}$'),
  logins integer not null default 1,
  primary key (dia, pessoa)
);
alter table public.acessos_login enable row level security;
revoke all on public.acessos_login from anon, authenticated;

-- soma um login ao dia (de Brasília) da pessoa; só a chave de serviço executa
create or replace function public.registrar_login(p_pessoa text) returns void
language sql security definer set search_path = public as $$
  insert into public.acessos_login (dia, pessoa, logins)
  values ((now() at time zone 'America/Sao_Paulo')::date, p_pessoa, 1)
  on conflict (dia, pessoa) do update set logins = public.acessos_login.logins + 1;
$$;
revoke all on function public.registrar_login(text) from public, anon, authenticated;
grant execute on function public.registrar_login(text) to service_role;

-- para consultar: select dia, count(*) as pessoas, sum(logins) as logins from public.acessos_login group by dia order by dia desc;
