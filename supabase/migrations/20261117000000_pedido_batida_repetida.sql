-- SIGEP · "esqueci de bater" repetido é recusado já no pedido (antes só na aprovação: o servidor pedia,
-- ficava "em análise" e a chefia é que descobria que a batida já existia).
-- A regra fica num lugar só e vale nas duas horas: ao pedir e ao aprovar (a batida pode ter surgido no meio).
-- Pode rodar a qualquer hora: não muda parâmetros.

-- ponytail: janela fixa de 30 min; se um dia existir turno com entrada e saída mais próximas que isso, vira parâmetro
create function confere_batida_repetida(p_servidor uuid, p_tipo text, p_em timestamptz) returns void
language plpgsql stable security definer set search_path = public as $$
declare perto batidas;
begin
  select * into perto from batidas b where b.servidor_id = p_servidor and b.tipo = p_tipo
    and b.em between p_em - interval '30 minutes' and p_em + interval '30 minutes' order by b.em limit 1;
  if perto.id is not null then
    raise exception 'Já existe uma % registrada às % nesse dia. Se a hora está errada, o RH corrige a batida.',
      case p_tipo when 'entrada' then 'entrada' else 'saída' end,
      to_char(perto.em at time zone 'America/Manaus', 'HH24:MI') using errcode = '23505';
  end if;
end $$;
revoke execute on function confere_batida_repetida(uuid, text, timestamptz) from public, anon, authenticated;

create or replace function pedir_justificativa(p_servidor uuid, p_tipo text, p_inicio date, p_fim date, p_motivo text,
  p_batida_tipo text default null, p_batida_em timestamptz default null) returns justificativas
language plpgsql security definer set search_path = public as $$
declare p perfis := meu_perfil(); j justificativas;
begin
  if p_tipo = 'batida' then
    if p_batida_em is null or p_batida_em > now() then raise exception 'Informe o dia e a hora em que você chegou ou saiu (não pode ser no futuro).'; end if;
    p_inicio := dia_local(p_batida_em); p_fim := p_inicio;
  end if;
  if not (pode_decidir(p_servidor) or (p.papel = 'servidor' and pode_ver_servidor(p_servidor))) then
    raise exception 'Sem permissão para pedir justificativa para este servidor.' using errcode = '42501';
  end if;
  if exists (select 1 from justificativas x where x.servidor_id = p_servidor and x.status = 'pendente' and x.tipo = p_tipo
             and x.inicio <= p_fim and x.fim >= p_inicio and (p_tipo <> 'batida' or x.batida_tipo = p_batida_tipo)) then
    raise exception 'Já existe um pedido igual esperando resposta.';
  end if;
  if p_tipo = 'batida' then perform confere_batida_repetida(p_servidor, p_batida_tipo, p_batida_em); end if;
  insert into justificativas (servidor_id, tipo, inicio, fim, motivo, batida_tipo, batida_em)
  values (p_servidor, p_tipo, p_inicio, p_fim, trim(p_motivo), case when p_tipo = 'batida' then p_batida_tipo end,
          case when p_tipo = 'batida' then p_batida_em end)
  returning * into j;
  if pode_decidir(p_servidor) then j := decidir_justificativa(j.id, true, null); end if;
  return j;
end $$;

create or replace function decidir_justificativa(p_id uuid, p_aprovar boolean, p_resposta text default null) returns justificativas
language plpgsql security definer set search_path = public as $$
declare j justificativas;
begin
  select * into j from justificativas where id = p_id for update;
  if j is null or not pode_decidir(j.servidor_id) then raise exception 'Sem permissão para decidir este pedido.' using errcode = '42501'; end if;
  if j.status <> 'pendente' then raise exception 'Este pedido já foi decidido.'; end if;
  if exists (select 1 from meses_fechados m where m.mes between date_trunc('month', j.inicio)::date and j.fim) then
    raise exception 'O mês desse pedido já foi fechado pelo RH.' using errcode = '23514';
  end if;
  if p_aprovar and j.tipo = 'batida' then perform confere_batida_repetida(j.servidor_id, j.batida_tipo, j.batida_em); end if;
  update justificativas set status = case when p_aprovar then 'aprovada' else 'recusada' end,
    decidido_por = auth.uid(), decidido_em = now(), resposta = nullif(trim(p_resposta), '')
    where id = p_id returning * into j;
  if p_aprovar and j.tipo = 'batida' then
    insert into batidas (servidor_id, tipo, em, origem, motivo, criado_por)
    values (j.servidor_id, j.batida_tipo, j.batida_em, 'ajuste', 'Pedido aprovado: ' || j.motivo, auth.uid());
  end if;
  return j;
end $$;
