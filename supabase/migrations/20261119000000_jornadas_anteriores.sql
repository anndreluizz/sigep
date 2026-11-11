-- SIGEP · vigência do horário. Antes, trocar o turno (ou a escala) de um servidor recalculava também os meses
-- passados com o horário novo: quem passou de Matutino para Vespertino em novembro ganhava faltas e atrasos em
-- outubro, inclusive em mês já enviado ao RH.
-- Agora, quando o horário de um servidor muda, o horário antigo fica guardado com a data até quando valeu
-- (ontem: a troca vale a partir de hoje). A folha de cada dia usa o horário que valia naquele dia.
-- Horário cadastrado errado? O RH ou a secretaria da unidade apaga o horário anterior no cadastro do servidor,
-- e os dias voltam a ser calculados com o horário seguinte.
-- Não guarda: a primeira definição de horário (quem estava "sem horário" passa a ter o novo desde o começo)
-- nem a 2ª troca no mesmo dia (vale o que estava em vigor até ontem).
-- ponytail: cobre a troca de turno/escala do SERVIDOR. Editar as horas de um turno em Horários ainda recalcula
-- o passado de quem usa aquele turno (a tela avisa: criar turno novo). Versão de turno se isso virar problema.

create table jornadas_anteriores (
  servidor_id   uuid not null references servidores,
  ate           date not null,                      -- último dia em que este horário valeu
  turno_id      uuid references turnos,
  turnos_extra  uuid[] not null default '{}',
  escala_id     uuid references escalas,
  escala_inicio date,
  trocado_por   uuid default auth.uid(),
  trocado_em    timestamptz not null default now(),
  primary key (servidor_id, ate)
);

create function guardar_jornada_anterior() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.turno_id is not null or old.escala_id is not null then
    insert into jornadas_anteriores (servidor_id, ate, turno_id, turnos_extra, escala_id, escala_inicio)
    values (old.id, dia_local(now()) - 1, old.turno_id, old.turnos_extra, old.escala_id, old.escala_inicio)
    on conflict do nothing;
  end if;
  return new;
end $$;
create trigger guardar_jornada_anterior after update on servidores for each row
  when ((old.turno_id, old.turnos_extra, old.escala_id, old.escala_inicio) is distinct from (new.turno_id, new.turnos_extra, new.escala_id, new.escala_inicio))
  execute function guardar_jornada_anterior();
revoke execute on function guardar_jornada_anterior() from public, anon, authenticated;

alter table jornadas_anteriores enable row level security;
create policy ler on jornadas_anteriores for select to authenticated using (pode_ver_servidor(servidor_id));
-- apagar = "o horário antigo estava errado": RH qualquer servidor; secretaria/chefe os da própria unidade
create policy gestor_apaga on jornadas_anteriores for delete to authenticated using (pode_decidir(servidor_id));
revoke all on jornadas_anteriores from anon, authenticated;
grant select, delete on jornadas_anteriores to authenticated;
