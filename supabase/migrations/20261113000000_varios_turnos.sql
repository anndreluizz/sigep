-- SIGEP · vários turnos no MESMO contrato (ex.: contratada Matutino + Noturno, professor nos três turnos).
-- turno_id continua sendo o turno principal; turnos_extra são os outros períodos do mesmo vínculo.
-- (Dois CONTRATOS diferentes continuam sendo dois cadastros com o mesmo CPF: 20261112000000_vinculos.sql.)

alter table servidores add column turnos_extra uuid[] not null default '{}';
alter table servidores add constraint turnos_extra_so_com_turno check (cardinality(turnos_extra) = 0 or turno_id is not null);
grant select (turnos_extra) on servidores to authenticated;

create function confere_turnos_extra() returns trigger language plpgsql set search_path = public as $$
begin
  if new.turno_id = any(new.turnos_extra)
     or exists (select 1 from unnest(new.turnos_extra) x where not exists (select 1 from turnos t where t.id = x)) then
    raise exception 'Turno extra inválido (repetido ou inexistente).' using errcode = '23514';
  end if;
  new.turnos_extra := array(select distinct x from unnest(new.turnos_extra) x);
  return new;
end $$;
create trigger confere_turnos_extra before insert or update of turnos_extra, turno_id on servidores
  for each row execute function confere_turnos_extra();

-- totem: o vínculo é escolhido pelo turno (entre TODOS os do vínculo) que começa mais perto da hora
create or replace function registrar_batida(p_codigo text, p_idade_segundos int default 0) returns json
language plpgsql security definer set search_path = public as $$
declare t perfis; b servidores; s servidores; c servidores; ultimo batidas; u batidas; agora timestamptz; novo batidas;
  dist int; melhor int := 99999; n int := 0; outro servidores; nome_turno text; perto text;
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

  for c in select * from servidores v where v.setor_id = t.setor_id and v.situacao = 'ativo'
           and (v.id = b.id or (b.cpf is not null and v.cpf = b.cpf)) order by v.matricula for update loop
    n := n + 1;
    u := ultima_batida(c.id, agora);
    select x.nome, x.d into perto, dist from (
      select tt.nome, least(abs(extract(epoch from ((agora at time zone 'America/Manaus')::time - tt.entrada)) / 60)::int,
                            1440 - abs(extract(epoch from ((agora at time zone 'America/Manaus')::time - tt.entrada)) / 60)::int) d
      from turnos tt where tt.id = any(array_append(c.turnos_extra, coalesce(c.turno_id, (select turno_id from escalas where id = c.escala_id))))
      order by 2 limit 1) x;
    if u.tipo = 'entrada' then s := c; ultimo := u; nome_turno := perto; exit; end if;   -- entrada aberta: é a saída dela
    if coalesce(dist, 9999) < melhor then melhor := coalesce(dist, 9999); s := c; ultimo := u; nome_turno := perto; end if;
  end loop;

  if s is null then
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
  return json_build_object('nome', s.nome, 'cargo', s.cargo, 'tipo', novo.tipo, 'em', novo.em, 'offline', p_idade_segundos > 0,
    'vinculo', case when n > 1 then nome_turno || ' · mat. ' || s.matricula end, 'servidor_id', s.id);
end $$;
