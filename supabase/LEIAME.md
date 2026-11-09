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
4. Daqui em diante o RH dá os acessos pelo próprio sistema: gera um **código de convite**
   (chefe de setor, Prefeito, servidor ou totem); a pessoa cria a conta e informa o código.

## Quem pode o quê
| Perfil | Pode | Não pode |
|---|---|---|
| RH | Cadastrar e desligar servidores, setores, turnos, escalas e feriados; gerar convites; ajustar batidas (sempre com motivo); fechar e reabrir o mês | Apagar o histórico |
| Prefeito | Ver todos os setores, servidores e batidas | Alterar qualquer coisa |
| Chefe de setor | Ver a equipe e as batidas do seu setor | Ver outros setores; cadastrar; ajustar batidas |
| Servidor | Ver o próprio cadastro, batidas e histórico | Ver colegas; bater ponto pelo celular |
| Totem | Registrar entrada e saída dos servidores do seu setor (`registrar_batida`) | Ler qualquer dado |

- CPF, telefone e o código do crachá só o RH vê (`dados_pessoais`).
- Servidor desligado, em férias ou afastado: o crachá para de funcionar em todos os totens na hora.
- Mês fechado não aceita batida nova, alteração nem exclusão.
- Toda mudança em servidores, batidas e perfis vai para o `historico` (quem, quando, antes e depois).

As regras ficam no banco, não no app: mesmo alguém mexendo no navegador não consegue burlá-las.
