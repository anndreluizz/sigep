# Banco de dados do SIGEP (Supabase)

## Testar no computador
```
cd supabase
npm install
npm test
```
Roda o banco num Postgres de verdade (PGlite) e tenta o uso certo e o indevido com cada perfil.

## Colocar no ar
1. Crie um projeto em https://supabase.com com o e-mail institucional da Prefeitura, região **São Paulo (sa-east-1)**.
2. No painel, abra **SQL Editor** e rode os arquivos de `migrations/` em ordem.
3. Crie a conta do primeiro RH em **Authentication → Users → Add user**. Depois, no SQL Editor:
   ```sql
   insert into perfis (id, nome, papel)
   select id, 'Nome do RH', 'rh' from auth.users where email = 'rh@exemplo.am.gov.br';
   ```
4. Em **Setores**, o RH cria cada unidade (escola) e toca em **Gerar acesso da secretaria**: a secretaria cria a conta, digita o código e passa a cadastrar os servidores da unidade.
5. Daqui em diante o RH dá os outros acessos pelo próprio sistema: gera um **código de convite**
   (chefe de setor, Prefeito, servidor ou totem); a pessoa cria a conta e informa o código.

## Quem pode o quê
| Perfil | Pode | Não pode |
|---|---|---|
| RH | Cadastrar e desligar servidores, setores, turnos, escalas e feriados; gerar convites; ajustar batidas (sempre com motivo); decidir e lançar justificativas de qualquer setor; fechar e reabrir o mês | Apagar o histórico |
| Prefeito | Ver todos os setores, servidores, batidas, folhas de ponto e justificativas | Alterar qualquer coisa |
| Secretaria / chefe do setor | Cadastrar e editar os servidores da própria unidade (inclusive CPF, telefone e crachá); gerar convite de servidor e de totem da unidade; ver equipe, batidas e espelho; aprovar/recusar pedidos e lançar abonos | Ver ou mexer em outra unidade; transferir servidor; gerar acesso de chefe/RH; ajustar batidas direto |
| Servidor | Ver o próprio cadastro, folha de ponto e histórico; pedir justificativa ("esqueci de bater", atestado, etc.) e desistir enquanto ninguém respondeu | Ver colegas; bater ponto pelo celular; aprovar o próprio pedido |
| Totem | Registrar entrada e saída dos servidores do seu setor (`registrar_batida`) | Ler qualquer dado |

- CPF, telefone e o código do crachá: o RH vê de todos; a secretaria/chefe só os da própria unidade (`dados_pessoais`). Prefeito e servidor não veem.
- Servidor desligado, em férias ou afastado: o crachá para de funcionar em todos os totens na hora.
- Enviar o mês ao RH: até o dia 5 a secretaria/chefe envia a frequência do mês anterior (Frequência → Enviar ao RH). Depois do envio a unidade não aprova, não recusa e não lança justificativa naquele mês; só o RH corrige, e pode devolver o mês à unidade. Cadastro de servidores continua liberado.
- Troca de horário: quando o turno ou a escala de um servidor muda, o horário antigo fica guardado até a véspera e a folha dos dias passados continua usando o horário da época. Se o horário antigo estava errado, o RH ou a secretaria apaga o "horário anterior" no cadastro do servidor. Editar as horas de um turno em Horários ainda recalcula o passado: se o horário mudou de verdade, crie um turno novo.
- Mês fechado não aceita batida nova, alteração nem exclusão, nem justificativa.
- Justificativa: pedido do servidor fica "em análise"; lançada pela chefia ou RH já nasce aprovada. "Esqueci de bater" aprovado vira batida de ajuste (o pedido é recusado se já houver batida do mesmo tipo a menos de 30 min); abono aprovado tira falta e atraso dos dias no espelho.
- Toda mudança em servidores, batidas e perfis vai para o `historico` (quem, quando, antes e depois).

As regras ficam no banco, não no app: mesmo alguém mexendo no navegador não consegue burlá-las.
