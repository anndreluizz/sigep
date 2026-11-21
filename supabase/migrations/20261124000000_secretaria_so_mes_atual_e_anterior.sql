-- SIGEP · auditoria de 21/11, achado 13. A secretaria lançava (e aprovava na hora) ajuste de batida de qualquer mês ainda não
-- enviado, até de meses muito antigos. Agora decide e lança só no mês atual e no anterior; antes disso, só o RH.
-- O resto de decidir_justificativa é igual ao de 20261118 (mês fechado pelo RH, mês enviado pela unidade).
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
  -- auditoria, achado 13: a secretaria (chefe) só decide e lança no mês atual e no anterior (o mês passado ela confere até o dia 5);
  -- mais antigo que isso, só o RH. Vale também para o que a própria secretaria lança (que se aprova na hora).
  if meu_papel() = 'chefe' and j.inicio < (date_trunc('month', dia_local(now())::timestamp) - interval '1 month')::date then
    raise exception 'A secretaria só decide pedidos do mês atual e do mês anterior. Meses mais antigos só o RH corrige.' using errcode = '23514';
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

