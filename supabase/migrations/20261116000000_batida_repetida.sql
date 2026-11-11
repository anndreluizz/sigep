-- SIGEP · batida repetida (dois defeitos achados na revisão de 10/11/2026, os dois reproduzidos em testar.mjs)
-- 1) Quem tem dois vínculos (mesmo CPF) e passava o crachá duas vezes na saída: a 1ª leitura fechava o vínculo
--    da manhã e a 2ª, segundos depois, abria uma entrada no vínculo da tarde. O intervalo mínimo entre leituras
--    olhava só o vínculo escolhido; agora olha a pessoa. De quebra, a saída volta a mostrar de qual vínculo foi.
-- 2) "Esqueci de bater" aprovado gravava a batida de ajuste sem olhar se ela já existia (pedido repetido, ou
--    a pessoa tinha batido e não lembrava): ficavam duas entradas ou duas saídas seguidas.
--    Agora recusa se já houver batida do mesmo tipo a menos de 30 min da hora pedida.
-- 3) Achado ao corrigir o 1: o intervalo mínimo (8 s) nunca valeu para batida feita com internet. O teste era
--    "ultimo is not null", que em linha inteira só é verdadeiro se TODAS as colunas estiverem preenchidas, e a
--    batida com internet tem motivo vazio. Crachá lido duas vezes seguidas virava entrada + saída.
-- Pode rodar a qualquer hora: não muda parâmetros, o site atual continua funcionando.

create or replace function registrar_batida(p_codigo text, p_idade_segundos int default 0, p_id uuid default null) returns json
language plpgsql security definer set search_path = public as $$
declare t perfis; b servidores; s servidores; c servidores; ultimo batidas; u batidas; agora timestamptz; novo batidas;
  dist int; melhor int := 99999; n int := 0; outro servidores; nome_turno text; perto text;
begin
  t := meu_perfil();
  if t.papel is distinct from 'totem' then
    raise exception 'Este aparelho não está autorizado como totem.' using errcode = 'SG401';
  end if;
  -- reenvio de uma leitura que já foi gravada: devolve a mesma batida, sem gravar outra
  if p_id is not null then
    select * into novo from batidas where id = p_id and totem_id = t.id;
    if novo.id is not null then
      select * into s from servidores where id = novo.servidor_id;
      return json_build_object('nome', s.nome, 'cargo', s.cargo, 'tipo', novo.tipo, 'em', novo.em, 'offline', p_idade_segundos > 0,
        'vinculo', null, 'servidor_id', s.id);
    end if;
  end if;
  if p_idade_segundos is null or p_idade_segundos not between 0 and limite_offline_segundos() then
    raise exception 'Batida guardada há tempo demais.' using errcode = '23514';
  end if;
  select * into b from servidores where codigo = trim(p_codigo);
  if b is null then raise exception 'Crachá não reconhecido.' using errcode = 'P0002'; end if;
  agora := date_trunc('second', now()) - make_interval(secs => p_idade_segundos);

  select count(*) into n from servidores v where v.setor_id = t.setor_id and v.situacao = 'ativo'
    and (v.id = b.id or (b.cpf is not null and v.cpf = b.cpf));
  for c in select * from servidores v where v.setor_id = t.setor_id and v.situacao = 'ativo'
           and (v.id = b.id or (b.cpf is not null and v.cpf = b.cpf)) order by v.matricula for update loop
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

  -- crachá passado duas vezes: vale para a pessoa (todos os vínculos dela no setor), não só para o vínculo escolhido
  if exists (select 1 from batidas x join servidores v on v.id = x.servidor_id
             where v.setor_id = t.setor_id and (v.id = b.id or (b.cpf is not null and v.cpf = b.cpf))
               and x.em <= agora and x.em > agora - make_interval(secs => cooldown_segundos())) then
    raise exception 'Ponto já registrado agora há pouco.' using errcode = '23505';
  end if;

  insert into batidas (id, servidor_id, tipo, em, origem, totem_id, motivo, criado_por)
  values (coalesce(p_id, gen_random_uuid()), s.id, case when ultimo.tipo = 'entrada' then 'saida' else 'entrada' end, agora, 'totem', t.id,
          case when p_idade_segundos > 0 then format('Batida feita sem internet; chegou %s min depois', p_idade_segundos / 60) end,
          auth.uid())
  returning * into novo;
  return json_build_object('nome', s.nome, 'cargo', s.cargo, 'tipo', novo.tipo, 'em', novo.em, 'offline', p_idade_segundos > 0,
    'vinculo', case when n > 1 then nome_turno || ' · mat. ' || s.matricula end, 'servidor_id', s.id);
end $$;

create or replace function decidir_justificativa(p_id uuid, p_aprovar boolean, p_resposta text default null) returns justificativas
language plpgsql security definer set search_path = public as $$
declare j justificativas; perto batidas;
begin
  select * into j from justificativas where id = p_id for update;
  if j is null or not pode_decidir(j.servidor_id) then raise exception 'Sem permissão para decidir este pedido.' using errcode = '42501'; end if;
  if j.status <> 'pendente' then raise exception 'Este pedido já foi decidido.'; end if;
  if exists (select 1 from meses_fechados m where m.mes between date_trunc('month', j.inicio)::date and j.fim) then
    raise exception 'O mês desse pedido já foi fechado pelo RH.' using errcode = '23514';
  end if;
  if p_aprovar and j.tipo = 'batida' then
    -- ponytail: janela fixa de 30 min; se um dia existir turno com entrada e saída mais próximas que isso, vira parâmetro
    select * into perto from batidas b where b.servidor_id = j.servidor_id and b.tipo = j.batida_tipo
      and b.em between j.batida_em - interval '30 minutes' and j.batida_em + interval '30 minutes' order by b.em limit 1;
    if perto.id is not null then
      raise exception 'Já existe uma % registrada às % nesse dia. Se a hora está errada, o RH corrige a batida.',
        case j.batida_tipo when 'entrada' then 'entrada' else 'saída' end,
        to_char(perto.em at time zone 'America/Manaus', 'HH24:MI') using errcode = '23505';
    end if;
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
