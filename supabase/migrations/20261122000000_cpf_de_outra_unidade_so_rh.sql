-- SIGEP · auditoria de 21/11, achado 3. O vínculo do servidor com mais de uma unidade é feito pelo CPF (pode_ver_servidor):
-- se a secretaria de uma unidade cadastrasse um servidor com o CPF de alguém de OUTRA unidade, passaria a enxergar
-- (pela conta desse servidor) batidas e justificativas de lá. Decisão: CPF que já existe em outra unidade só o RH cadastra.
-- A mensagem não diz em qual unidade está, só manda falar com o RH.
create function cpf_so_rh_em_outra_unidade() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if meu_papel() = 'chefe' and new.cpf is not null
     and exists (select 1 from servidores s where s.cpf = new.cpf and s.setor_id <> new.setor_id and s.id <> new.id) then
    raise exception 'Esse CPF precisa ser cadastrado pelo RH. Fale com o RH.' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger cpf_so_rh_em_outra_unidade before insert or update of cpf, setor_id on servidores
  for each row execute function cpf_so_rh_em_outra_unidade();
revoke execute on function cpf_so_rh_em_outra_unidade() from public, anon, authenticated;
