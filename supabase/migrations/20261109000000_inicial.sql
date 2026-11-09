-- SIGEP · Sistema de Gestão de Ponto · banco de dados (Supabase / Postgres)
-- Regra geral: cada perfil só lê e altera o que pode (RLS). Batida não é gravada "na mão":
-- o totem chama registrar_batida(), que confere o crachá, o setor e o intervalo mínimo.
-- Toda mudança em servidor e batida vai para o histórico (quem, quando, o quê).
-- Fuso: America/Manaus (sem horário de verão). "Dia" é sempre o dia local.

/* ============================== cadastros base ============================== */
create table setores (
  id        uuid primary key default gen_random_uuid(),
  nome      text not null unique check (length(nome) between 2 and 80),
  criado_em timestamptz not null default now()
);

create table turnos (
  id                   uuid primary key default gen_random_uuid(),
  nome                 text not null check (length(nome) between 2 and 40),
  entrada              time not null,
  saida                time not null,             -- saida <= entrada: passa da meia-noite (plantão)
  saida_almoco         time,
  retorno_almoco       time,
  tolerancia_min       smallint not null default 10 check (tolerancia_min between 0 and 120),
  tolerancia_saida_min smallint not null default 10 check (tolerancia_saida_min between 0 and 120),
  dias_semana          smallint[] not null default '{1,2,3,4,5}',   -- 0 = domingo … 6 = sábado
  check ((saida_almoco is null) = (retorno_almoco is null))
);

create table escalas (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null check (length(nome) between 2 and 40),   -- ex.: Vigia 24×72
  turno_id      uuid not null references turnos,
  dias_trabalho smallint not null check (dias_trabalho between 1 and 30),
  dias_descanso smallint not null check (dias_descanso between 0 and 30)
);

create table servidores (
  id           uuid primary key default gen_random_uuid(),
  matricula    text not null unique check (length(matricula) between 1 and 20),
  nome         text not null check (length(nome) between 3 and 80),
  cargo        text not null default '',
  setor_id     uuid not null references setores,
  turno_id     uuid references turnos,
  escala_id    uuid references escalas,
  escala_inicio date,                              -- primeiro dia de trabalho do ciclo da escala
  situacao     text not null default 'ativo' check (situacao in ('ativo', 'ferias', 'afastado', 'desligado')),
  desligado_em date,
  vinculo      text check (vinculo in ('efetivo', 'contratado', 'comissionado')),
  cpf          text check (cpf ~ '^\d{11}$'),
  telefone     text,
  admissao     date,
  -- conteúdo do QR do crachá: aleatório, não dá para adivinhar pela matrícula
  codigo       text not null unique default replace(gen_random_uuid()::text, '-', ''),
  criado_em    timestamptz not null default now(),
  check (turno_id is null or escala_id is null),
  check ((escala_id is null) = (escala_inicio is null)),
  check ((situacao = 'desligado') = (desligado_em is not null))
);
create index on servidores (setor_id);

create table feriados (
  data date primary key,
  nome text not null check (length(nome) between 2 and 60)
);

/* ============================== perfis e acesso ============================== */
create type papel as enum ('rh', 'prefeito', 'chefe', 'servidor', 'totem');

create table perfis (
  id          uuid primary key references auth.users on delete cascade,
  nome        text not null check (length(nome) between 2 and 80),
  papel       papel not null,
  setor_id    uuid references setores,             -- chefe e totem
  servidor_id uuid unique references servidores,   -- servidor
  ativo       boolean not null default true,
  check ((papel in ('chefe', 'totem')) = (setor_id is not null)),
  check ((papel = 'servidor') = (servidor_id is not null))
);

create function meu_perfil() returns perfis language sql stable security definer set search_path = public
as $$ select * from perfis where id = auth.uid() and ativo $$;
create function meu_papel() returns papel language sql stable security definer set search_path = public
as $$ select (meu_perfil()).papel $$;
create function e_rh() returns boolean language sql stable security definer set search_path = public
as $$ select coalesce(meu_papel() = 'rh', false) $$;

-- quem enxerga o ponto de um servidor: RH e Prefeito todos; chefe o próprio setor; servidor só ele
create function pode_ver_servidor(sid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(case p.papel
    when 'rh' then true
    when 'prefeito' then true
    when 'chefe' then exists (select 1 from servidores s where s.id = sid and s.setor_id = p.setor_id)
    when 'servidor' then p.servidor_id = sid
    else false end, false)
  from (select (meu_perfil()).*) p
$$;

-- Convite: o RH gera um código; a pessoa cria a conta (e-mail e senha) e informa o código.
-- Assim o RH dá acesso a chefes, Prefeito, servidores e totens sem depender de quem fez o sistema.
create table convites (
  codigo      text primary key default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
  nome        text not null check (length(nome) between 2 and 80),
  papel       papel not null,
  setor_id    uuid references setores,
  servidor_id uuid references servidores,
  criado_por  uuid not null default auth.uid() references auth.users,
  criado_em   timestamptz not null default now(),
  expira_em   timestamptz not null default now() + interval '7 days',
  usado_por   uuid references auth.users,
  usado_em    timestamptz,
  check ((papel in ('chefe', 'totem')) = (setor_id is not null)),
  check ((papel = 'servidor') = (servidor_id is not null))
);

create function aceitar_convite(p_codigo text) returns perfis language plpgsql security definer set search_path = public as $$
declare c convites; r perfis;
begin
  if auth.uid() is null then raise exception 'Entre na sua conta primeiro.' using errcode = '42501'; end if;
  if exists (select 1 from perfis where id = auth.uid()) then raise exception 'Esta conta já tem acesso.'; end if;
  select * into c from convites where codigo = upper(trim(p_codigo)) for update;
  if c is null or c.usado_por is not null or c.expira_em < now() then
    raise exception 'Código inválido, já usado ou vencido. Peça um novo ao RH.';
  end if;
  update convites set usado_por = auth.uid(), usado_em = now() where codigo = c.codigo;
  insert into perfis (id, nome, papel, setor_id, servidor_id)
  values (auth.uid(), c.nome, c.papel, c.setor_id, c.servidor_id) returning * into r;
  return r;
end $$;

/* ============================== batidas ============================== */
create table batidas (
  id          uuid primary key default gen_random_uuid(),
  servidor_id uuid not null references servidores,
  tipo        text not null check (tipo in ('entrada', 'saida')),
  em          timestamptz not null,
  origem      text not null check (origem in ('totem', 'ajuste')),
  totem_id    uuid references perfis,
  motivo      text,                                -- obrigatório em ajuste; batida feita sem internet
  criado_por  uuid references auth.users default auth.uid(),
  criado_em   timestamptz not null default now(),
  check (origem = 'totem' or coalesce(length(trim(motivo)), 0) >= 5)
);
create index on batidas (servidor_id, em);

create table meses_fechados (
  mes        date primary key check (extract(day from mes) = 1),
  fechado_por uuid references auth.users default auth.uid(),
  fechado_em timestamptz not null default now()
);

create function dia_local(t timestamptz) returns date language sql immutable
as $$ select (t at time zone 'America/Manaus')::date $$;

-- mês fechado pelo RH não aceita batida nova, alteração nem exclusão
create function batida_mes_aberto() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from meses_fechados m where m.mes in (
        date_trunc('month', dia_local(case when tg_op = 'DELETE' then old.em else new.em end))::date,
        date_trunc('month', dia_local(case when tg_op = 'INSERT' then new.em else old.em end))::date)) then
    raise exception 'O mês dessa batida já foi fechado.' using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger batida_mes_aberto before insert or update or delete on batidas
  for each row execute function batida_mes_aberto();

-- Intervalo mínimo entre duas leituras do mesmo crachá (crachá passado duas vezes sem querer).
create function cooldown_segundos() returns int language sql immutable as $$ select 8 $$;
-- Totem sem internet guarda batidas por até 4 dias (feriado prolongado).
create function limite_offline_segundos() returns int language sql immutable as $$ select 4 * 24 * 3600 $$;
-- Plantão (ex.: vigia 07:00–07:00): a entrada de ontem fica aberta por até 26 h.
create function limite_plantao_horas() returns int language sql immutable as $$ select 26 $$;

-- O totem manda o código lido e, se a batida ficou guardada sem internet, há quantos segundos
-- ela foi lida (medido no próprio tablet, não pelo relógio dele: atrasar o relógio não muda nada).
-- Entrada ou saída é decidido aqui: a anterior do dia (ou a entrada aberta do plantão) define.
create function registrar_batida(p_codigo text, p_idade_segundos int default 0) returns json
language plpgsql security definer set search_path = public as $$
declare t perfis; s servidores; ultimo batidas; agora timestamptz; turno turnos; novo batidas;
begin
  t := meu_perfil();
  if t.papel is distinct from 'totem' then
    raise exception 'Este aparelho não está autorizado como totem.' using errcode = '42501';
  end if;
  if p_idade_segundos is null or p_idade_segundos not between 0 and limite_offline_segundos() then
    raise exception 'Batida guardada há tempo demais.' using errcode = '23514';
  end if;
  select * into s from servidores where codigo = trim(p_codigo) for update;   -- trava: dois totens ao mesmo tempo
  if s is null then raise exception 'Crachá não reconhecido.' using errcode = 'P0002'; end if;
  if s.setor_id <> t.setor_id then raise exception 'Este crachá é de outro setor.' using errcode = '42501'; end if;
  if s.situacao <> 'ativo' then
    raise exception '%', case s.situacao when 'ferias' then 'Servidor em férias.'
      when 'afastado' then 'Servidor afastado. Procure o RH.' else 'Crachá bloqueado. Procure o RH.' end
      using errcode = '42501';
  end if;

  agora := date_trunc('second', now()) - make_interval(secs => p_idade_segundos);
  select * into ultimo from batidas b where b.servidor_id = s.id and dia_local(b.em) = dia_local(agora) and b.em <= agora
    order by b.em desc limit 1;
  if ultimo is null then
    select * into turno from turnos where id = coalesce(s.turno_id, (select turno_id from escalas where id = s.escala_id));
    if turno.saida <= turno.entrada then
      select * into ultimo from batidas b where b.servidor_id = s.id and b.em < agora
        and b.em >= agora - make_interval(hours => limite_plantao_horas()) order by b.em desc limit 1;
      if ultimo.tipo is distinct from 'entrada' then ultimo := null; end if;
    end if;
  end if;
  if ultimo is not null and agora - ultimo.em < make_interval(secs => cooldown_segundos()) then
    raise exception 'Ponto já registrado agora há pouco.' using errcode = '23505';
  end if;

  insert into batidas (servidor_id, tipo, em, origem, totem_id, motivo, criado_por)
  values (s.id, case when ultimo.tipo = 'entrada' then 'saida' else 'entrada' end, agora, 'totem', t.id,
          case when p_idade_segundos > 0 then format('Batida feita sem internet; chegou %s min depois', p_idade_segundos / 60) end,
          auth.uid())
  returning * into novo;
  return json_build_object('nome', s.nome, 'cargo', s.cargo, 'tipo', novo.tipo, 'em', novo.em, 'offline', p_idade_segundos > 0);
end $$;

/* ============================== histórico ============================== */
create table historico (
  id          bigint generated always as identity primary key,
  quem        uuid default auth.uid(),
  tabela      text not null,
  registro_id uuid not null,
  servidor_id uuid,
  acao        text not null,                       -- INSERT / UPDATE / DELETE
  antes       jsonb,
  depois      jsonb,
  em          timestamptz not null default now()
);
create index on historico (servidor_id, em);

create function registrar_historico() returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  insert into historico (tabela, registro_id, servidor_id, acao, antes, depois)
  values (tg_table_name, r.id, case when tg_table_name = 'servidores' then r.id else (to_jsonb(r) ->> 'servidor_id')::uuid end,
          tg_op, case when tg_op <> 'INSERT' then to_jsonb(old) end, case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return r;
end $$;
create trigger historico after insert or update or delete on servidores for each row execute function registrar_historico();
create trigger historico after insert or update or delete on batidas    for each row execute function registrar_historico();
create trigger historico after insert or update or delete on perfis     for each row execute function registrar_historico();

/* ============================== permissões (RLS) ============================== */
alter table setores        enable row level security;
alter table turnos         enable row level security;
alter table escalas        enable row level security;
alter table feriados       enable row level security;
alter table servidores     enable row level security;
alter table perfis         enable row level security;
alter table convites       enable row level security;
alter table batidas        enable row level security;
alter table meses_fechados enable row level security;
alter table historico      enable row level security;

-- cadastros base: qualquer pessoa logada lê; só o RH muda
create policy ler on setores        for select to authenticated using (meu_papel() is not null);
create policy ler on turnos         for select to authenticated using (meu_papel() is not null);
create policy ler on escalas        for select to authenticated using (meu_papel() is not null);
create policy ler on feriados       for select to authenticated using (meu_papel() is not null);
create policy ler on meses_fechados for select to authenticated using (meu_papel() is not null);
create policy rh  on setores        for all to authenticated using (e_rh()) with check (e_rh());
create policy rh  on turnos         for all to authenticated using (e_rh()) with check (e_rh());
create policy rh  on escalas        for all to authenticated using (e_rh()) with check (e_rh());
create policy rh  on feriados       for all to authenticated using (e_rh()) with check (e_rh());
create policy rh  on meses_fechados for insert to authenticated with check (e_rh());
create policy rh_reabre on meses_fechados for delete to authenticated using (e_rh());

-- servidores: cada um vê quem pode; só o RH cadastra e altera; ninguém apaga (desliga)
create policy ler on servidores for select to authenticated using (pode_ver_servidor(id));
create policy rh_inclui on servidores for insert to authenticated with check (e_rh());
create policy rh_altera on servidores for update to authenticated using (e_rh()) with check (e_rh());

-- perfis: cada um lê o seu; RH lê todos e pode desativar/alterar
create policy ler on perfis for select to authenticated using (id = auth.uid() or e_rh());
create policy rh_altera on perfis for update to authenticated using (e_rh()) with check (e_rh());

create policy rh on convites for all to authenticated using (e_rh()) with check (e_rh());

-- batidas: lê quem vê o servidor; totem só pela função; ajuste manual só RH, sempre com motivo
create policy ler on batidas for select to authenticated using (pode_ver_servidor(servidor_id));
create policy rh_ajusta on batidas for insert to authenticated with check (e_rh() and origem = 'ajuste');
create policy rh_corrige on batidas for update to authenticated using (e_rh()) with check (e_rh() and origem = 'ajuste');
create policy rh_exclui on batidas for delete to authenticated using (e_rh());

create policy ler on historico for select to authenticated using (e_rh() or (servidor_id is not null and pode_ver_servidor(servidor_id)));

-- CPF e telefone: só RH (chefe e Prefeito leem o resto do cadastro)
revoke all on all tables in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
grant select, insert, update, delete on setores, turnos, escalas, feriados, convites, batidas to authenticated;
grant select, insert, delete on meses_fechados to authenticated;
grant select, update on perfis to authenticated;
grant select on historico to authenticated;
grant insert, update on servidores to authenticated;
grant select (id, matricula, nome, cargo, setor_id, turno_id, escala_id, escala_inicio, situacao, desligado_em,
              vinculo, admissao, criado_em) on servidores to authenticated;
create function dados_pessoais(sid uuid) returns table (cpf text, telefone text, codigo text)
language sql stable security definer set search_path = public as $$
  select cpf, telefone, codigo from servidores where id = sid and e_rh()
$$;
revoke execute on function dados_pessoais(uuid) from public;
grant execute on function meu_perfil(), meu_papel(), e_rh(), pode_ver_servidor(uuid), dia_local(timestamptz),
  aceitar_convite(text), registrar_batida(text, int), dados_pessoais(uuid) to authenticated;
