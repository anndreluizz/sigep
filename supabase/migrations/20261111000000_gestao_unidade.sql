-- SIGEP · gestão pela unidade: a secretaria da escola (perfil "chefe") cadastra e edita os servidores
-- da própria unidade, vê os dados pessoais deles (para digitar e imprimir crachás) e gera convites
-- de servidor e de totem da unidade. Não mexe em outra unidade nem transfere servidor para outra.

create function meu_setor_gestao() returns uuid language sql stable security definer set search_path = public
as $$ select case when (meu_perfil()).papel = 'chefe' then (meu_perfil()).setor_id end $$;

-- leitura pelo setor da própria linha: vale também para a linha recém-inserida (insert ... returning)
create policy unidade_ler on servidores for select to authenticated using (setor_id = meu_setor_gestao());
create policy unidade_inclui on servidores for insert to authenticated with check (setor_id = meu_setor_gestao());
create policy unidade_altera on servidores for update to authenticated
  using (setor_id = meu_setor_gestao()) with check (setor_id = meu_setor_gestao());

-- dados pessoais (CPF, telefone, código do crachá): RH todos; secretaria só da própria unidade
create or replace function dados_pessoais() returns table (id uuid, cpf text, telefone text, codigo text)
language sql stable security definer set search_path = public as $$
  select id, cpf, telefone, codigo from servidores where e_rh() or setor_id = meu_setor_gestao()
$$;

-- convites: a secretaria gera para servidor e totem da própria unidade; vê e cancela os que ela criou
create policy unidade_convida on convites for insert to authenticated with check (
  meu_setor_gestao() is not null and (
    (papel = 'totem' and setor_id = meu_setor_gestao()) or
    (papel = 'servidor' and exists (select 1 from servidores s where s.id = servidor_id and s.setor_id = meu_setor_gestao()))));
create policy unidade_ve on convites for select to authenticated using (criado_por = auth.uid());
create policy unidade_cancela on convites for delete to authenticated using (criado_por = auth.uid() and usado_por is null);

revoke execute on function meu_setor_gestao() from public, anon;
grant execute on function meu_setor_gestao() to authenticated;
