-- Siglas da folha de frequência da SEMED: LM (licença maternidade), LP (licença paternidade), SR (sem remuneração).
-- 'licenca' continua sendo a LE (licença especial / afastamento).
alter table justificativas drop constraint justificativas_tipo_check;
alter table justificativas add constraint justificativas_tipo_check check (tipo in
  ('atestado', 'ferias', 'licenca', 'licenca_maternidade', 'licenca_paternidade', 'sem_remuneracao', 'servico_externo', 'abono', 'batida'));
