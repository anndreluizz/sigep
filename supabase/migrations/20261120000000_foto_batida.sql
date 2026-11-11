-- SIGEP · foto na batida. O totem tira uma foto pequena (JPEG ~320 px, data URL) quando lê o crachá e a envia
-- DEPOIS da batida, por anexar_foto(): a foto nunca atrasa nem derruba o ponto, e sem internet ela vai na fila junto.
-- Só o RH vê (uma foto do rosto é dado pessoal: chefe, servidor e prefeito não têm acesso).
-- Retenção: 90 dias. Cada envio de foto apaga as vencidas; não depende de cron.
-- Não muda registrar_batida: o site atual continua funcionando.

create table batida_fotos (
  batida_id uuid primary key references batidas on delete cascade,
  foto      text not null check (foto like 'data:image/jpeg;base64,%' and length(foto) <= 80000),
  criada_em timestamptz not null default now()
);
create index on batida_fotos (criada_em);

alter table batida_fotos enable row level security;
grant select on batida_fotos to authenticated;
create policy rh_ve on batida_fotos for select to authenticated using (e_rh());

create function anexar_foto(p_id uuid, p_foto text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if meu_papel() is distinct from 'totem' then
    raise exception 'Este aparelho não está autorizado como totem.' using errcode = 'SG401';
  end if;
  delete from batida_fotos where criada_em < now() - interval '90 days';
  -- só a batida deste totem; reenvio da mesma foto não duplica
  insert into batida_fotos (batida_id, foto)
  select id, p_foto from batidas where id = p_id and totem_id = auth.uid()
  on conflict do nothing;
end $$;

revoke execute on function anexar_foto(uuid, text) from public, anon;
grant execute on function anexar_foto(uuid, text) to authenticated;
