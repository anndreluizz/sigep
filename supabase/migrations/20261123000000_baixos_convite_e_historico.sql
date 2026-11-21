-- SIGEP · auditoria de 21/11, achados Baixos 10 e 12.
-- 12) código de convite com 16 caracteres (64 bits) em vez de 10 (40 bits). Os convites já emitidos (7 dias de validade) continuam valendo.
alter table convites alter column codigo set default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16));

-- 10) o histórico das mudanças de perfil (quem recebeu acesso e com qual papel) era visível ao chefe do setor e ao próprio
-- servidor por causa do servidor_id; agora fica sem servidor_id e só o RH lê.
create or replace function registrar_historico() returns trigger language plpgsql security definer set search_path = public as $$
declare r record; a jsonb; d jsonb; mudou text[];
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  if tg_op <> 'INSERT' then a := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then d := to_jsonb(new); end if;
  if tg_table_name = 'servidores' then
    select array_agg(k) into mudou from unnest(array['cpf', 'telefone', 'codigo']) k where a ->> k is distinct from d ->> k;
    a := sem_dados_pessoais(a);
    d := sem_dados_pessoais(d) || case when mudou is not null then jsonb_build_object('dados_pessoais_alterados', to_jsonb(mudou)) else '{}' end;
  end if;
  insert into historico (tabela, registro_id, servidor_id, acao, antes, depois)
  values (tg_table_name, r.id,
          case tg_table_name when 'servidores' then r.id when 'perfis' then null else (to_jsonb(r) ->> 'servidor_id')::uuid end,
          tg_op, a, d);
  return r;
end $$;
