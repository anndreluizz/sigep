-- SIGEP · justificativas: o servidor pede, a chefia do setor ou o RH decide.
-- Abono (atestado, férias, licença, serviço externo, outro) tira a falta/atraso dos dias do período no espelho.
-- "Esqueci de bater" aprovado vira uma batida de ajuste, com o motivo.
-- Pedido lançado pela chefia ou pelo RH já nasce aprovado (é a própria chefia lançando).
-- ponytail: o atestado em si (arquivo) é entregue em papel ao RH; upload privado quando pedirem.

create table justificativas (
  id           uuid primary key default gen_random_uuid(),
  servidor_id  uuid not null references servidores,
  tipo         text not null check (tipo in ('atestado', 'ferias', 'licenca', 'servico_externo', 'abono', 'batida')),
  inicio       date not null,
  fim          date not null,
  batida_tipo  text check (batida_tipo in ('entrada', 'saida')),
  batida_em    timestamptz,
  motivo       text not null check (length(trim(motivo)) between 5 and 500),
  status       text not null default 'pendente' check (status in ('pendente', 'aprovada', 'recusada')),
  pedido_por   uuid not null default auth.uid() references auth.users,
  pedido_em    timestamptz not null default now(),
  decidido_por uuid references auth.users,
  decidido_em  timestamptz,
  resposta     text check (length(resposta) <= 300),
  check (fim >= inicio and fim - inicio <= 366),
  check ((tipo = 'batida') = (batida_tipo is not null and batida_em is not null))
);
create index on justificativas (servidor_id, inicio);
create index on justificativas (status) where status = 'pendente';
create trigger historico after insert or update or delete on justificativas for each row execute function registrar_historico();

-- quem decide: RH qualquer servidor; chefe os do próprio setor
create function pode_decidir(sid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(case p.papel
    when 'rh' then true
    when 'chefe' then exists (select 1 from servidores s where s.id = sid and s.setor_id = p.setor_id)
    else false end, false)
  from (select (meu_perfil()).*) p
$$;

create function decidir_justificativa(p_id uuid, p_aprovar boolean, p_resposta text default null) returns justificativas
language plpgsql security definer set search_path = public as $$
declare j justificativas;
begin
  select * into j from justificativas where id = p_id for update;
  if j is null or not pode_decidir(j.servidor_id) then raise exception 'Sem permissão para decidir este pedido.' using errcode = '42501'; end if;
  if j.status <> 'pendente' then raise exception 'Este pedido já foi decidido.'; end if;
  if exists (select 1 from meses_fechados m where m.mes between date_trunc('month', j.inicio)::date and j.fim) then
    raise exception 'O mês desse pedido já foi fechado pelo RH.' using errcode = '23514';
  end if;
  update justificativas set status = case when p_aprovar then 'aprovada' else 'recusada' end,
    decidido_por = auth.uid(), decidido_em = now(), resposta = nullif(trim(p_resposta), '')
    where id = p_id returning * into j;
  if p_aprovar and j.tipo = 'batida' then
    insert into batidas (servidor_id, tipo, em, origem, motivo, criado_por)
    values (j.servidor_id, j.batida_tipo, j.batida_em, 'ajuste', 'Pedido aprovado: ' || j.motivo, auth.uid());
  end if;
  return j;
end $$;

create function pedir_justificativa(p_servidor uuid, p_tipo text, p_inicio date, p_fim date, p_motivo text,
  p_batida_tipo text default null, p_batida_em timestamptz default null) returns justificativas
language plpgsql security definer set search_path = public as $$
declare p perfis := meu_perfil(); j justificativas;
begin
  if p_tipo = 'batida' then
    if p_batida_em is null or p_batida_em > now() then raise exception 'Informe o dia e a hora em que você chegou ou saiu (não pode ser no futuro).'; end if;
    p_inicio := dia_local(p_batida_em); p_fim := p_inicio;
  end if;
  if not (pode_decidir(p_servidor) or (p.papel = 'servidor' and p.servidor_id = p_servidor)) then
    raise exception 'Sem permissão para pedir justificativa para este servidor.' using errcode = '42501';
  end if;
  if exists (select 1 from justificativas x where x.servidor_id = p_servidor and x.status = 'pendente' and x.tipo = p_tipo
             and x.inicio <= p_fim and x.fim >= p_inicio and (p_tipo <> 'batida' or x.batida_tipo = p_batida_tipo)) then
    raise exception 'Já existe um pedido igual esperando resposta.';
  end if;
  insert into justificativas (servidor_id, tipo, inicio, fim, motivo, batida_tipo, batida_em)
  values (p_servidor, p_tipo, p_inicio, p_fim, trim(p_motivo), case when p_tipo = 'batida' then p_batida_tipo end,
          case when p_tipo = 'batida' then p_batida_em end)
  returning * into j;
  if pode_decidir(p_servidor) then j := decidir_justificativa(j.id, true, null); end if;   -- lançado pela chefia/RH
  return j;
end $$;

alter table justificativas enable row level security;
create policy ler on justificativas for select to authenticated using (pode_ver_servidor(servidor_id));
-- o servidor pode desistir do próprio pedido enquanto ninguém respondeu
create policy desiste on justificativas for delete to authenticated using (status = 'pendente' and pedido_por = auth.uid());
revoke all on justificativas from anon, authenticated;
grant select, delete on justificativas to authenticated;
revoke execute on function pode_decidir(uuid), decidir_justificativa(uuid, boolean, text),
  pedir_justificativa(uuid, text, date, date, text, text, timestamptz) from public, anon;
grant execute on function pode_decidir(uuid), decidir_justificativa(uuid, boolean, text),
  pedir_justificativa(uuid, text, date, date, text, text, timestamptz) to authenticated;
