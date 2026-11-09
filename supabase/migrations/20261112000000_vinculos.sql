-- SIGEP · servidor com mais de um vínculo (ex.: efetivo de manhã e contratado à tarde).
-- Cada vínculo continua sendo um cadastro com matrícula própria (a folha fecha por vínculo).
-- Cadastros com o MESMO CPF são a mesma pessoa: qualquer um dos crachás serve, e o totem decide o vínculo:
--   1) se algum vínculo está com entrada aberta, a batida é a saída dele;
--   2) senão, é a entrada do vínculo cujo turno começa mais perto da hora da batida.
-- O servidor vê, no Meu ponto, todos os vínculos dele e pode pedir justificativa em qualquer um.

-- última batida que decide entrada/saída de um vínculo (mesmo dia; plantão: entrada aberta de até 26 h)
create function ultima_batida(sid uuid, agora timestamptz) returns batidas
language plpgsql stable security definer set search_path = public as $$
declare u batidas; turno turnos; s servidores;
begin
  select * into u from batidas b where b.servidor_id = sid and dia_local(b.em) = dia_local(agora) and b.em <= agora
    order by b.em desc limit 1;
  if u is null then
    select * into s from servidores where id = sid;
    select * into turno from turnos where id = coalesce(s.turno_id, (select turno_id from escalas where id = s.escala_id));
    if turno.saida <= turno.entrada then
      select * into u from batidas b where b.servidor_id = sid and b.em < agora
        and b.em >= agora - make_interval(hours => limite_plantao_horas()) order by b.em desc limit 1;
      if u.tipo is distinct from 'entrada' then u := null; end if;
    end if;
  end if;
  return u;
end $$;
revoke execute on function ultima_batida(uuid, timestamptz) from public, anon, authenticated;

create or replace function registrar_batida(p_codigo text, p_idade_segundos int default 0) returns json
language plpgsql security definer set search_path = public as $$
declare t perfis; b servidores; s servidores; c servidores; ultimo batidas; u batidas; agora timestamptz; novo batidas;
  turno turnos; dist int; melhor int := 99999; n int := 0; outro servidores;
begin
  t := meu_perfil();
  if t.papel is distinct from 'totem' then
    raise exception 'Este aparelho não está autorizado como totem.' using errcode = 'SG401';
  end if;
  if p_idade_segundos is null or p_idade_segundos not between 0 and limite_offline_segundos() then
    raise exception 'Batida guardada há tempo demais.' using errcode = '23514';
  end if;
  select * into b from servidores where codigo = trim(p_codigo);
  if b is null then raise exception 'Crachá não reconhecido.' using errcode = 'P0002'; end if;
  agora := date_trunc('second', now()) - make_interval(secs => p_idade_segundos);

  -- vínculos ativos da mesma pessoa neste setor (trava: dois totens ao mesmo tempo)
  for c in select * from servidores v where v.setor_id = t.setor_id and v.situacao = 'ativo'
           and (v.id = b.id or (b.cpf is not null and v.cpf = b.cpf)) order by v.matricula for update loop
    n := n + 1;
    u := ultima_batida(c.id, agora);
    if u.tipo = 'entrada' then s := c; ultimo := u; exit; end if;   -- 1) entrada aberta: é a saída dela
    select * into turno from turnos where id = coalesce(c.turno_id, (select turno_id from escalas where id = c.escala_id));
    dist := coalesce(least(abs(extract(epoch from ((agora at time zone 'America/Manaus')::time - turno.entrada)) / 60)::int,
                           1440 - abs(extract(epoch from ((agora at time zone 'America/Manaus')::time - turno.entrada)) / 60)::int), 9999);
    if dist < melhor then melhor := dist; s := c; ultimo := u; end if;   -- 2) turno que começa mais perto
  end loop;

  if s is null then   -- nenhum vínculo ativo aqui: explica o porquê
    select * into outro from servidores v where v.setor_id = t.setor_id and (v.id = b.id or (b.cpf is not null and v.cpf = b.cpf)) limit 1;
    if outro is null then raise exception 'Este crachá é de outro setor.' using errcode = '42501'; end if;
    raise exception '%', case outro.situacao when 'ferias' then 'Servidor em férias.'
      when 'afastado' then 'Servidor afastado. Procure o RH.' else 'Crachá bloqueado. Procure o RH.' end
      using errcode = '42501';
  end if;

  if ultimo is not null and agora - ultimo.em < make_interval(secs => cooldown_segundos()) then
    raise exception 'Ponto já registrado agora há pouco.' using errcode = '23505';
  end if;

  insert into batidas (servidor_id, tipo, em, origem, totem_id, motivo, criado_por)
  values (s.id, case when ultimo.tipo = 'entrada' then 'saida' else 'entrada' end, agora, 'totem', t.id,
          case when p_idade_segundos > 0 then format('Batida feita sem internet; chegou %s min depois', p_idade_segundos / 60) end,
          auth.uid())
  returning * into novo;
  select * into turno from turnos where id = coalesce(s.turno_id, (select turno_id from escalas where id = s.escala_id));
  return json_build_object('nome', s.nome, 'cargo', s.cargo, 'tipo', novo.tipo, 'em', novo.em, 'offline', p_idade_segundos > 0,
    'vinculo', case when n > 1 then turno.nome || ' · mat. ' || s.matricula end, 'servidor_id', s.id);
end $$;

-- o servidor enxerga também os outros vínculos dele (mesmo CPF)
create or replace function pode_ver_servidor(sid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(case p.papel
    when 'rh' then true
    when 'prefeito' then true
    when 'chefe' then exists (select 1 from servidores s where s.id = sid and s.setor_id = p.setor_id)
    when 'servidor' then p.servidor_id = sid or exists (select 1 from servidores a join servidores o on o.cpf = a.cpf
                                                        where a.id = p.servidor_id and o.id = sid and a.cpf is not null)
    else false end, false)
  from (select (meu_perfil()).*) p
$$;

-- pedir justificativa: o servidor pode pedir em qualquer vínculo dele
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
  insert into justificativas (servidor_id, tipo, inicio, fim, motivo, batida_tipo, batida_em)
  values (p_servidor, p_tipo, p_inicio, p_fim, trim(p_motivo), case when p_tipo = 'batida' then p_batida_tipo end,
          case when p_tipo = 'batida' then p_batida_em end)
  returning * into j;
  if pode_decidir(p_servidor) then j := decidir_justificativa(j.id, true, null); end if;
  return j;
end $$;
