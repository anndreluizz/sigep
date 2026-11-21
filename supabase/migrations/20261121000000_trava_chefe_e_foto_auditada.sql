-- SIGEP · auditoria de 21/11. Quatro furos fechados, todos sem mudar o que a tela já faz de certo:
-- 1) a secretaria/chefe reescrevia a frequência de mês já enviado/fechado mudando criado_em, admissao ou desligado_em;
-- 2) a secretaria/chefe apagava o horário anterior (jornadas_anteriores) de mês já enviado/fechado;
-- 3) o RH via foto de rosto sem deixar rastro: agora só por ver_foto(), que grava quem viu e quando;
-- 4) a purga de 90 dias só rodava quando chegava foto nova: agora também roda todo dia (pg_cron, se o projeto tiver).
-- RH não é barrado em nada disto (corrige mês enviado; mês fechado tem a própria trava em batidas).

-- algum mês enviado pela unidade (ou fechado pelo RH) toca o intervalo [lo, hi]? infinity vale
create function mes_travado(p_setor uuid, lo date, hi date) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from meses_enviados e where e.setor_id = p_setor
                   and e.mes <= hi and (e.mes + interval '1 month')::date > lo)
      or exists (select 1 from meses_fechados m where m.mes <= hi and (m.mes + interval '1 month')::date > lo)
$$;
revoke execute on function mes_travado(uuid, date, date) from public, anon, authenticated;

-- 1) servidores: o que muda dias passados só o RH mexe quando o mês já saiu da unidade
create function trava_servidor_mes() returns trigger language plpgsql security definer set search_path = public as $$
declare lo date; hi date;
begin
  if meu_papel() is distinct from 'chefe' then return new; end if;
  if new.criado_em is distinct from old.criado_em then
    raise exception 'Só o RH altera a data de entrada do servidor no sistema.' using errcode = '42501';
  end if;
  if new.admissao is distinct from old.admissao then   -- antes da admissão não há dia útil: vazio = desde sempre
    lo := least(coalesce(old.admissao, '-infinity'), coalesce(new.admissao, '-infinity'));
    hi := greatest(coalesce(old.admissao, '-infinity'), coalesce(new.admissao, '-infinity'));
    lo := greatest(lo, dia_local(old.criado_em));   -- antes de entrar no sistema não há dia calculado
    if mes_travado(old.setor_id, lo, hi) then
      raise exception 'Essa mudança altera um mês já enviado ao RH (ou fechado). Agora só o RH corrige.' using errcode = '23514';
    end if;
  end if;
  if new.desligado_em is distinct from old.desligado_em then   -- depois do desligamento não há dia útil: vazio = para sempre
    lo := least(coalesce(old.desligado_em, 'infinity'), coalesce(new.desligado_em, 'infinity'));
    hi := greatest(coalesce(old.desligado_em, 'infinity'), coalesce(new.desligado_em, 'infinity'));
    hi := least(hi, dia_local(now()));   -- o futuro ainda não tem mês enviado
    lo := greatest(lo, dia_local(old.criado_em));
    if mes_travado(old.setor_id, lo, hi) then
      raise exception 'Essa mudança altera um mês já enviado ao RH (ou fechado). Agora só o RH corrige.' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger trava_servidor_mes before update on servidores for each row execute function trava_servidor_mes();
revoke execute on function trava_servidor_mes() from public, anon, authenticated;

-- 2) jornadas_anteriores: apagar o horário antigo recalcula os dias entre o horário anterior a ele e a data "ate"
create function trava_jornada_apagada() returns trigger language plpgsql security definer set search_path = public as $$
declare lo date; p_setor uuid; entrada date;
begin
  if meu_papel() is distinct from 'chefe' then return old; end if;
  select coalesce(max(j.ate) + 1, '-infinity') into lo from jornadas_anteriores j
    where j.servidor_id = old.servidor_id and j.ate < old.ate;
  -- antes de o servidor entrar no sistema (ou da admissão) não há dia calculado: não conta como mês afetado
  select setor_id, coalesce(admissao, dia_local(criado_em)) into p_setor, entrada from servidores where id = old.servidor_id;
  lo := greatest(lo, entrada);
  if mes_travado(p_setor, lo, old.ate) then
    raise exception 'Esse horário anterior vale para um mês já enviado ao RH (ou fechado). Agora só o RH corrige.' using errcode = '23514';
  end if;
  return old;
end $$;
create trigger trava_jornada_apagada before delete on jornadas_anteriores for each row execute function trava_jornada_apagada();
revoke execute on function trava_jornada_apagada() from public, anon, authenticated;

-- 3) foto: sem SELECT direto; o RH abre por ver_foto(), que deixa rastro (só o RH lê esse rastro: servidor_id nulo)
drop policy rh_ve on batida_fotos;
revoke select on batida_fotos from authenticated;
create function ver_foto(p_batida uuid) returns text language plpgsql security definer set search_path = public as $$
declare f text;
begin
  if not e_rh() then raise exception 'Só o RH vê a foto da batida.' using errcode = '42501'; end if;
  select foto into f from batida_fotos where batida_id = p_batida;
  if f is not null then
    insert into historico (tabela, registro_id, servidor_id, acao) values ('batida_fotos', p_batida, null, 'VIEW');
  end if;
  return f;
end $$;
revoke execute on function ver_foto(uuid) from public, anon;
grant execute on function ver_foto(uuid) to authenticated;

-- 4) purga diária das fotos com mais de 90 dias (a de anexar_foto continua). Só se o projeto tiver pg_cron.
do $$ begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('sigep-purga-fotos', '15 7 * * *', $c$delete from public.batida_fotos where criada_em < now() - interval '90 days'$c$);
  end if;
end $$;

-- achado menor: o anon não precisa nem enxergar essa função (ela já devolvia vazio sem perfil)
revoke execute on function dados_pessoais() from anon;
