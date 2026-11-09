// cd supabase && npm install && npm test
// Roda as migrações num Postgres de verdade (PGlite) e testa as regras com cada perfil, inclusive tentativas indevidas.
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { readFileSync, readdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

process.on('unhandledRejection', e => { console.error('ERRO:', e.message, '| em:', e.query); process.exit(1) })
const db = new PGlite({ extensions: { pgcrypto } })
// o que o Supabase já traz pronto: schema auth, auth.uid() e os papéis anon/authenticated
await db.exec(`
  create schema auth; create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create role anon nologin; create role authenticated nologin;
  grant usage on schema public, auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;`)
for (const f of readdirSync(new URL('migrations', import.meta.url)).sort().filter(f => !f.includes('_storage')))
  await db.exec(readFileSync(new URL('migrations/' + f, import.meta.url), 'utf8'))

let falhas = 0, total = 0
const ok = (cond, msg) => { total++; if (!cond) { falhas++; console.error('  FALHOU:', msg) } }
const como = async (uid) => db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid || ''}', false); set role ${uid ? 'authenticated' : 'anon'};`)
const q = async (sql, p) => (await db.query(sql, p)).rows
const erro = async (sql, p, trecho, msg) => {
  try { await db.query(sql, p); ok(false, msg + ' (deveria dar erro)') }
  catch (e) { ok(!trecho || e.message.includes(trecho), `${msg}: "${e.message}"`) }
}
const um = async (sql, p) => (await q(sql, p))[0]
const bater = (codigo, idade = 0) => um('select registrar_batida($1, $2) r', [codigo, idade]).then(x => x.r)

// ---------- dados: o primeiro RH entra pelo painel do Supabase (como no LEIAME) ----------
const [RH, CHEFE, PREF, SERV, TOTEM, TOTEM2, NOVO, ESTRANHO] = Array.from({ length: 8 }, randomUUID)
await db.exec('reset role')
for (const id of [RH, CHEFE, PREF, SERV, TOTEM, TOTEM2, NOVO, ESTRANHO]) await q('insert into auth.users values ($1, $2)', [id, id + '@x'])
await q(`insert into perfis (id, nome, papel) values ($1, 'Rita (RH)', 'rh')`, [RH])

await como(RH)
const [escola] = await q(`insert into setores (nome) values ('E.M. São Francisco') returning id`)
const [obras] = await q(`insert into setores (nome) values ('Secretaria de Obras') returning id`)
const [mat] = await q(`insert into turnos (nome, entrada, saida) values ('Matutino', '07:00', '11:30') returning id`)
const [plantao] = await q(`insert into turnos (nome, entrada, saida, dias_semana) values ('Plantão', '07:00', '07:00', '{0,1,2,3,4,5,6}') returning id`)
const [vigia] = await q(`insert into escalas (nome, turno_id, dias_trabalho, dias_descanso) values ('Vigia 24×72', $1, 1, 3) returning id`, [plantao.id])
const ana = await um(`insert into servidores (matricula, nome, cargo, setor_id, turno_id, cpf) values ('0101', 'Ana Paula Ferreira', 'Professora', $1, $2, '12345678901') returning id`, [escola.id, mat.id])
const marta = await um(`insert into servidores (matricula, nome, setor_id, escala_id, escala_inicio) values ('0105', 'Marta (vigia)', $1, $2, '2026-11-01') returning id`, [escola.id, vigia.id])
const paulo = await um(`insert into servidores (matricula, nome, setor_id) values ('0330', 'Paulo Henrique Dias', $1) returning id`, [obras.id])
const codigo = async id => (await um('select codigo from dados_pessoais() where id = $1', [id])).codigo
const [cAna, cMarta, cPaulo] = [await codigo(ana.id), await codigo(marta.id), await codigo(paulo.id)]
ok(cAna.length === 32, 'código do crachá aleatório')

// ---------- convites ----------
const convite = (nome, papel, setor = null, servidor = null) =>
  um('insert into convites (nome, papel, setor_id, servidor_id) values ($1, $2, $3, $4) returning codigo', [nome, papel, setor, servidor]).then(x => x.codigo)
const cvChefe = await convite('Gestora da escola', 'chefe', escola.id)
const cvPref = await convite('Prefeito', 'prefeito')
const cvServ = await convite('Ana Paula Ferreira', 'servidor', null, ana.id)
const cvTotem = await convite('Totem 1 – Escola', 'totem', escola.id)
const cvTotem2 = await convite('Totem Obras', 'totem', obras.id)
await erro(`insert into convites (nome, papel) values ('Chefe sem setor', 'chefe')`, [], 'check', 'chefe precisa de setor')

await como(ESTRANHO)
await erro(`insert into convites (nome, papel) values ('Eu mesmo', 'rh')`, [], 'row-level security', 'quem não é RH não cria convite')
await erro(`select aceitar_convite('NAOEXISTE')`, [], 'inválido', 'código errado')
ok((await q('select id from servidores')).length === 0, 'conta sem perfil não vê servidores')
ok((await q('select * from setores')).length === 0, 'conta sem perfil não vê setores')
await como(null)
await erro(`select aceitar_convite($1)`, [cvChefe], 'permission denied', 'sem login não aceita convite')

for (const [uid, cv] of [[CHEFE, cvChefe], [PREF, cvPref], [SERV, cvServ], [TOTEM, cvTotem], [TOTEM2, cvTotem2]]) {
  await como(uid); await q('select aceitar_convite($1)', [cv.toLowerCase()])
}
await como(NOVO)
await erro(`select aceitar_convite($1)`, [cvChefe], 'já usado', 'convite só vale uma vez')
await como(CHEFE)
await erro(`select aceitar_convite($1)`, [cvPref], 'já tem acesso', 'conta com acesso não pega outro convite')
await como(CHEFE)
await q(`update perfis set papel = 'rh' where id = $1`, [CHEFE])   // RLS: não dá erro, só não altera nada
await como(RH)
ok((await um(`select papel from perfis where id = $1`, [CHEFE])).papel === 'chefe', 'chefe continua chefe')

// ---------- quem vê o quê ----------
const nomes = async () => (await q('select nome from servidores order by nome')).map(r => r.nome).join(',')
await como(RH);    ok(await nomes() === 'Ana Paula Ferreira,Marta (vigia),Paulo Henrique Dias', 'RH vê todos')
await como(PREF);  ok(await nomes() === 'Ana Paula Ferreira,Marta (vigia),Paulo Henrique Dias', 'Prefeito vê todos')
await como(CHEFE); ok(await nomes() === 'Ana Paula Ferreira,Marta (vigia)', 'chefe da escola não vê a Obras')
await como(SERV);  ok(await nomes() === 'Ana Paula Ferreira', 'servidora vê só ela')
await como(TOTEM); ok(await nomes() === '', 'totem não lista servidores')
await como(CHEFE)
await erro('select cpf from servidores', [], 'permission denied', 'chefe não lê CPF')
await erro('select codigo from servidores', [], 'permission denied', 'chefe não lê o código do crachá')
// a secretaria da escola (chefe) cadastra e edita os servidores DA PRÓPRIA unidade
const pesChefe = (await q('select id, cpf from dados_pessoais()')).map(x => x.id).sort()
ok(pesChefe.join() === [ana.id, marta.id].sort().join(), 'dados pessoais: chefe vê só os da própria escola')
ok((await q(`update servidores set cargo = 'Professora II' where id = $1 returning id`, [ana.id])).length === 1, 'chefe edita servidor da escola')
ok((await q(`update servidores set cargo = 'X' where id = $1 returning id`, [paulo.id])).length === 0, 'chefe não edita servidor de outro setor')
await erro(`update servidores set setor_id = $1 where id = $2`, [obras.id, ana.id], 'row-level security', 'chefe não transfere servidor para outro setor')
const novoEsc = await um(`insert into servidores (matricula, nome, setor_id, turno_id) values ('0109', 'Josefa da Escola', $1, $2) returning id`, [escola.id, mat.id])
ok(!!novoEsc?.id, 'chefe cadastra servidor na própria escola')
await erro(`insert into servidores (matricula, nome, setor_id) values ('9', 'Fulano de Tal', $1)`, [obras.id], 'row-level security', 'chefe não cadastra em outro setor')
ok(!!(await um(`insert into convites (nome, papel, setor_id) values ('Totem 2 – Escola', 'totem', $1) returning codigo`, [escola.id])), 'chefe gera convite de totem da escola')
ok(!!(await um(`insert into convites (nome, papel, servidor_id) values ('Josefa', 'servidor', $1) returning codigo`, [novoEsc.id])), 'chefe gera convite de servidor da escola')
await erro(`insert into convites (nome, papel, setor_id) values ('Outro chefe', 'chefe', $1)`, [escola.id], 'row-level security', 'chefe não gera convite de chefe')
await erro(`insert into convites (nome, papel, setor_id) values ('Totem Obras', 'totem', $1)`, [obras.id], 'row-level security', 'chefe não gera convite de outro setor')
await erro(`insert into convites (nome, papel, servidor_id) values ('Paulo', 'servidor', $1)`, [paulo.id], 'row-level security', 'chefe não gera convite para servidor de outro setor')
ok((await q('select codigo from convites')).length === 2, 'chefe só vê os convites que ele criou')
await como(PREF)
await erro(`insert into servidores (matricula, nome, setor_id) values ('8', 'Pelo Prefeito', $1)`, [escola.id], 'row-level security', 'Prefeito não cadastra')
ok((await q('select * from dados_pessoais()')).length === 0, 'Prefeito não vê dados pessoais')
await como(CHEFE)
await como(PREF)
await erro(`insert into setores (nome) values ('Gabinete')`, [], 'row-level security', 'Prefeito é só leitura')
await como(RH)
await erro('delete from servidores where id = $1', [paulo.id], 'permission denied', 'ninguém apaga servidor: desliga')

// ---------- totem ----------
await como(TOTEM)
let r = await bater(cAna, 3600)                         // chegou há 1 h (estava sem internet)
ok(r.tipo === 'entrada' && r.offline && r.nome === 'Ana Paula Ferreira', 'primeira batida do dia = entrada')
await erro('select registrar_batida($1, 3598)', [cAna], 'agora há pouco', 'crachá passado duas vezes')
r = await bater(cAna, 1800); ok(r.tipo === 'saida', 'segunda batida = saída')
r = await bater(cAna); ok(r.tipo === 'entrada' && !r.offline, 'terceira = entrada de novo')
await erro('select registrar_batida($1)', ['nao-existe'], 'não reconhecido', 'crachá desconhecido')
await erro('select registrar_batida($1)', [cPaulo], 'outro setor', 'totem da escola não bate ponto da Obras')
await erro('select registrar_batida($1, $2)', [cAna, 5 * 24 * 3600], 'tempo demais', 'batida guardada há mais de 4 dias')
await erro('select registrar_batida($1, $2)', [cAna, -10], 'tempo demais', 'idade negativa')
await erro(`insert into batidas (servidor_id, tipo, em, origem) values ($1, 'entrada', now(), 'totem')`, [ana.id], 'row-level security', 'totem não grava direto na tabela')
const motivo = await um(`select motivo from batidas where origem = 'totem' order by em limit 1`).catch(() => null)
ok(motivo === undefined || motivo === null, 'totem não lê batidas')
await como(TOTEM2); r = await bater(cPaulo); ok(r.tipo === 'entrada', 'totem da Obras bate o Paulo')
await como(SERV)
await erro('select registrar_batida($1)', [cAna], 'não está autorizado', 'servidor não bate ponto pelo celular')
ok((await q('select * from batidas')).length === 3, 'servidora vê as próprias 3 batidas')
await como(CHEFE); ok((await q('select * from batidas')).length === 3, 'chefe vê as batidas da escola, não da Obras')
await como(PREF);  ok((await q('select * from batidas')).length === 4, 'Prefeito vê todas')

// plantão: entrada ontem 07:00, saída hoje 07:00 (24 h depois) fecha o plantão em vez de abrir outro
await como(TOTEM)
r = await bater(cMarta, 25 * 3600); ok(r.tipo === 'entrada', 'vigia entra no plantão')
r = await bater(cMarta, 3600); ok(r.tipo === 'saida', 'plantão que passa da meia-noite: dia seguinte é saída')
r = await bater(cMarta); ok(r.tipo === 'entrada', 'depois da saída, nova entrada')

// desligado: crachá bloqueado na hora, em todos os totens
await como(RH); await q(`update servidores set situacao = 'desligado', desligado_em = current_date where id = $1`, [paulo.id])
await como(TOTEM2); await erro('select registrar_batida($1)', [cPaulo], 'bloqueado', 'desligado não bate ponto')
await como(RH); await q(`update servidores set situacao = 'ferias' where id = $1`, [ana.id])
await como(TOTEM); await erro('select registrar_batida($1)', [cAna], 'férias', 'em férias não bate ponto')
await como(RH); await q(`update servidores set situacao = 'ativo' where id = $1`, [ana.id])

// ---------- ajustes e fechamento do mês ----------
await como(CHEFE)
await erro(`insert into batidas (servidor_id, tipo, em, origem, motivo) values ($1, 'saida', now(), 'ajuste', 'Esqueceu a saída')`, [ana.id], 'row-level security', 'chefe não ajusta direto (aprova pedido)')
await como(RH)
await erro(`insert into batidas (servidor_id, tipo, em, origem) values ($1, 'saida', now(), 'ajuste')`, [ana.id], 'check', 'ajuste sem motivo')
await q(`insert into batidas (servidor_id, tipo, em, origem, motivo) values ($1, 'entrada', '2026-10-05 07:00-04', 'ajuste', 'Esqueceu de bater')`, [ana.id])
await q(`insert into meses_fechados (mes) values ('2026-10-01')`)
await erro(`insert into batidas (servidor_id, tipo, em, origem, motivo) values ($1, 'saida', '2026-10-05 11:30-04', 'ajuste', 'Esqueceu a saída')`, [ana.id], 'fechado', 'mês fechado não aceita batida')
await erro(`delete from batidas where em = '2026-10-05 07:00-04'`, [], 'fechado', 'mês fechado não apaga batida')
await erro(`update batidas set em = '2026-11-02 07:00-04' where em = '2026-10-05 07:00-04'`, [], 'fechado', 'não tira batida de mês fechado')
await erro(`insert into batidas (servidor_id, tipo, em, origem, motivo) values ($1, 'entrada', '2026-10-31 23:30-04', 'ajuste', 'Fuso: ainda é outubro')`, [ana.id], 'fechado', 'dia conta no fuso de Manaus (03:30 UTC = 31/10)')
await q(`delete from meses_fechados where mes = '2026-10-01'`)
await q(`insert into batidas (servidor_id, tipo, em, origem, motivo) values ($1, 'saida', '2026-10-05 11:30-04', 'ajuste', 'Esqueceu a saída')`, [ana.id])

// ---------- histórico ----------
ok((await q(`select * from historico where tabela = 'batidas' and acao = 'INSERT'`)).length >= 9, 'toda batida vai pro histórico')
const h = await um(`select quem, antes->>'situacao' a, depois->>'situacao' d from historico where tabela = 'servidores' and registro_id = $1 and acao = 'UPDATE' order by id limit 1`, [paulo.id])
ok(h.quem === RH && h.a === 'ativo' && h.d === 'desligado', 'desligamento registrado com quem fez')
await erro('delete from historico', [], 'permission denied', 'histórico não se apaga')
await como(CHEFE)
const hChefe = (await q(`select antes, depois from historico where tabela = 'servidores'`)).map(x => JSON.stringify(x)).join()
ok(hChefe.includes('Ana Paula') && !hChefe.includes('12345678901') && !hChefe.includes(cAna) && !/"(cpf|telefone|codigo)":/.test(hChefe),
   'histórico não vaza CPF, telefone nem código do crachá')
ok(hChefe.includes('"dados_pessoais_alterados":["cpf","codigo"]'), 'histórico registra que os dados pessoais mudaram, sem o valor')
await como(SERV)
ok((await q('select distinct servidor_id from historico')).every(x => x.servidor_id === ana.id), 'servidora vê só o próprio histórico')

// ---------- justificativas ----------
const pedir = (sid, tipo, ini, fim, motivo, bt = null, em = null) =>
  um('select * from pedir_justificativa($1, $2, $3, $4, $5, $6, $7)', [sid, tipo, ini, fim, motivo, bt, em])
await como(SERV)
const pAt = await pedir(ana.id, 'atestado', '2026-11-03', '2026-11-04', 'Consulta médica, atestado entregue ao RH')
ok(pAt.status === 'pendente' && pAt.pedido_por === SERV, 'servidora pede: fica pendente')
await erro('select pedir_justificativa($1, $2, $3, $4, $5)', [ana.id, 'atestado', '2026-11-04', '2026-11-04', 'Mesmo dia de novo'], 'pedido igual', 'não repete pedido pendente')
await erro('select pedir_justificativa($1, $2, $3, $4, $5)', [marta.id, 'abono', '2026-11-03', '2026-11-03', 'Pedindo pela colega'], 'Sem permissão', 'servidora não pede pelos outros')
await erro('select decidir_justificativa($1, true)', [pAt.id], 'Sem permissão', 'servidora não aprova o próprio pedido')
await erro(`update justificativas set status = 'aprovada' where id = $1`, [pAt.id], 'permission denied', 'ninguém muda status na mão')
const pBat = await pedir(ana.id, 'batida', null, null, 'Esqueci de bater a saída', 'saida', '2026-11-05 11:35-04')
ok((await um('select inicio::text i, fim::text f from justificativas where id = $1', [pBat.id])).f === '2026-11-05', 'esqueci de bater: dia vem da hora informada')
await erro('select pedir_justificativa($1, $2, null, null, $3, $4, $5)', [ana.id, 'batida', 'Batida no futuro', 'entrada', '2099-01-01 07:00-04'], 'futuro', 'batida no futuro')
const pDes = await pedir(ana.id, 'abono', '2026-11-06', '2026-11-06', 'Vou desistir deste')
await q('delete from justificativas where id = $1', [pDes.id]); ok(!(await q('select id from justificativas where id = $1', [pDes.id])).length, 'servidora desiste do pedido pendente')
await como(PREF)
await erro('select decidir_justificativa($1, true)', [pAt.id], 'Sem permissão', 'Prefeito não decide')
await erro('select pedir_justificativa($1, $2, $3, $4, $5)', [ana.id, 'abono', '2026-11-03', '2026-11-03', 'Prefeito tentando'], 'Sem permissão', 'Prefeito não lança')
ok((await q('select id from justificativas')).length === 2, 'Prefeito vê os pedidos')
await como(CHEFE)
await erro('select pedir_justificativa($1, $2, $3, $4, $5)', [paulo.id, 'abono', '2026-11-03', '2026-11-03', 'Outro setor'], 'Sem permissão', 'chefe não lança para outro setor')
const nBat = (await q(`select count(*)::int n from batidas where servidor_id = $1 and origem = 'ajuste'`, [ana.id]))[0].n
r = await um('select * from decidir_justificativa($1, true, $2)', [pBat.id, 'Ok, confirmado com a portaria'])
const nova = await um(`select tipo, motivo, criado_por from batidas where servidor_id = $1 and origem = 'ajuste' and em = '2026-11-05 11:35-04'`, [ana.id])
ok(r.status === 'aprovada' && r.decidido_por === CHEFE && nova?.tipo === 'saida' && nova.motivo.includes('Esqueci') && nova.criado_por === CHEFE, 'chefe aprova "esqueci de bater": vira batida de ajuste')
await erro('select decidir_justificativa($1, false)', [pBat.id], 'já foi decidido', 'não decide duas vezes')
r = await um('select * from decidir_justificativa($1, false, $2)', [pAt.id, 'Traga o atestado ao RH'])
ok(r.status === 'recusada' && r.resposta === 'Traga o atestado ao RH', 'chefe recusa com resposta')
r = await pedir(ana.id, 'servico_externo', '2026-11-06', '2026-11-06', 'Reunião na Secretaria de Educação')
ok(r.status === 'aprovada' && r.decidido_por === CHEFE, 'chefe lança: já nasce aprovado')
await como(SERV)
await q('delete from justificativas where id = $1', [r.id])   // RLS: não dá erro, só não apaga
ok((await q('select id from justificativas where id = $1', [r.id])).length === 1, 'pedido decidido continua lá')
await como(RH)
await q(`insert into meses_fechados (mes) values ('2026-09-01')`)
await erro('select pedir_justificativa($1, $2, $3, $4, $5)', [ana.id, 'ferias', '2026-09-20', '2026-10-05', 'Férias de setembro'], 'fechado', 'mês fechado não aceita justificativa')
r = await pedir(paulo.id, 'ferias', '2026-11-16', '2026-11-30', 'Férias regulamentares'); ok(r.status === 'aprovada', 'RH lança férias de qualquer setor')
ok((await q(`select * from historico where tabela = 'justificativas'`)).length >= 5, 'justificativas vão pro histórico')
await como(TOTEM); ok((await q('select id from justificativas')).length === 0, 'totem não vê justificativas')

// desativar acesso
await como(RH); await q('update perfis set ativo = false where id = $1', [TOTEM])
await como(TOTEM); await erro('select registrar_batida($1)', [cMarta], 'não está autorizado', 'totem desativado pelo RH para na hora')

console.log(`\n${total - falhas}/${total} verificações ok`)
process.exit(falhas ? 1 : 0)
