-- SIGEP · enviar o mês ao RH. Até o dia 5 a secretaria da unidade confere a frequência do mês anterior e envia.
-- Depois de enviado, a secretaria/chefe não mexe mais no ponto daquele mês (não aprova, não recusa e não lança
-- justificativa); só o RH corrige. O RH pode devolver o mês à unidade, e aí ela volta a mexer.
-- O resto continua liberado para a secretaria: cadastrar e editar servidores, crachás, convites.
-- O servidor ainda pode pedir justificativa de um mês enviado: quem responde é o RH.
-- Diferente de meses_fechados (fecha o mês para todo mundo, inclusive o RH): aqui é por unidade.
-- ponytail: devolver apaga a linha do envio (não fica histórico de envios devolvidos); tabela de histórico se pedirem.

create table meses_enviados (
  setor_id    uuid not null references setores,
  mes         date not null check (extract(day from mes) = 1),
  enviado_por uuid not null default auth.uid() references auth.users,
  enviado_em  timestamptz not null default now(),
  primary key (setor_id, mes)
);
alter table meses_enviados enable row level security;
create policy ler on meses_enviados for select to authenticated
  using (meu_papel() in ('rh', 'prefeito') or setor_id = meu_setor_gestao());
-- a secretaria envia só a própria unidade e só mês que já terminou
create policy unidade_envia on meses_enviados for insert to authenticated
  with check (setor_id = meu_setor_gestao() and enviado_por = auth.uid() and mes < date_trunc('month', dia_local(now()))::date);
create policy rh_devolve on meses_enviados for delete to authenticated using (e_rh());
revoke all on meses_enviados from anon, authenticated;
grant select, insert, delete on meses_enviados to authenticated;

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
  -- mês já enviado ao RH pela unidade: a secretaria/chefe não decide nem lança mais nada nele
  if meu_papel() = 'chefe' and exists (select 1 from meses_enviados e join servidores s on s.setor_id = e.setor_id
       where s.id = j.servidor_id and e.mes between date_trunc('month', j.inicio)::date and j.fim) then
    raise exception 'O mês desse pedido já foi enviado ao RH. Agora só o RH corrige.' using errcode = '23514';
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
