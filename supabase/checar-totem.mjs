// npm run totem — a fila do totem sem internet, sobre o banco de verdade (PGlite + migrações).
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {criarClienteLocal, semearDemo} = require('../js/local.js')
const {criarFila} = require('../js/totem.js')
const ler = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8')
let falhas = 0, total = 0
const ok = (c, msg) => { total++; if (!c) { falhas++; console.error('  FALHOU:', msg) } }

const banco = await criarClienteLocal(PGlite, m => ler('supabase/migrations/' + m))
await semearDemo(banco)
await banco.auth.signInWithPassword({email: 'totem@demo', password: 'demo1234'})

// internet que cai: com `fora` ligado, o rpc falha como o supabase-js falha sem rede (erro sem código)
let fora = false, perdida = false, relogio = Date.now()
// `perdida`: o banco grava, mas a resposta nao chega ao totem (internet lenta, tempo esgotado)
const sb = {rpc: (f, a) => perdida ? banco.rpc(f, a).then(() => ({data: null, error: {message: 'tempo esgotado'}})) : fora ? Promise.resolve({data: null, error: {message: 'TypeError: Failed to fetch', code: ''}}) : banco.rpc(f, a)}
const mem = {}, armazenamento = {getItem: k => mem[k] ?? null, setItem: (k, v) => { mem[k] = v }}
const fila = criarFila(sb, armazenamento, () => relogio)
const batidas = async () => (await banco._db.query(`select s.matricula, b.tipo, b.em, b.motivo from batidas b join servidores s on s.id = b.servidor_id order by b.em, s.matricula`)).rows
const passar = seg => { relogio += seg * 1000 }

// relógio do tablet (de mentira) e do banco (real) andam separados: o banco grava agora menos a idade
let r = await fila.bater('DEMO-0105')
ok(r.ok && !r.guardada && r.dados.tipo === 'entrada' && r.dados.nome === 'Marta Oliveira', 'com internet: registra na hora')
r = await fila.bater('DEMO-0330'); ok(!r.ok && r.erro.includes('outro setor'), 'recusa do banco aparece: ' + r.erro)
ok(fila.pendentes() === 0, 'recusa não vai para a fila')

fora = true
passar(60); r = await fila.bater('DEMO-0102'); ok(r.ok && r.guardada, 'sem internet: guarda')
passar(3600); r = await fila.bater('DEMO-0101'); ok(r.ok && r.guardada, 'guarda a entrada da Ana')
passar(30); r = await fila.bater('DEMO-0330'); ok(r.ok && r.guardada, 'guarda até crachá de outro setor (sem rede, o totem não sabe)')
ok(fila.pendentes() === 3, '3 na fila')
await fila.enviar(); ok(fila.pendentes() === 3, 'ainda sem internet: nada sai da fila')

fora = false
passar(600)
r = await fila.bater('DEMO-0102'); ok(r.ok && r.guardada, 'internet voltou mas há fila: a nova vai para o fim (ordem certa)')
await fila.enviar()
ok(fila.pendentes() === 0, 'fila esvaziada (a recusada também sai)')
const b = await batidas(), de = m => b.filter(x => x.matricula === m)
ok(b.length === 4 && de('0102').map(x => x.tipo).join() === 'entrada,saida' && de('0101')[0]?.tipo === 'entrada', 'tipos: ' + b.map(x => x.matricula + x.tipo).join())
const seg = (new Date(de('0102')[1].em) - new Date(de('0102')[0].em)) / 1000
ok(Math.abs(seg - 4230) <= 2, `hora vem da idade medida no tablet (${seg}s entre entrada e saída, esperado 4230)`)
ok(de('0102')[0].motivo?.includes('sem internet') && !de('0105')[0].motivo, 'só a batida guardada fica marcada no motivo')

const linhas = async () => (await banco._db.query('select count(*)::int n from batidas')).rows[0].n
// totem desativado com fila: as batidas guardadas não se perdem (horários de 2 dias atrás: longe das de agora)
let antes = await linhas()
fora = true; await fila.bater('DEMO-0102'); passar(2 * 24 * 3600); fora = false
await banco._db.query(`update perfis set ativo = false where papel = 'totem'`)
await fila.enviar(); ok(fila.pendentes() === 1, 'totem desativado: batida guardada continua na fila')
r = await fila.bater('DEMO-0101'); ok(r.guardada && fila.pendentes() === 2, 'com fila parada, a leitura nova vai para a fila (nada se perde)')
await banco._db.query(`update perfis set ativo = true where papel = 'totem'`)
passar(3600); await fila.enviar(); ok(fila.pendentes() === 0 && await linhas() === antes + 2, 'reativado: envia as duas guardadas')

// batida guardada há mais de 4 dias: o banco recusa e ela sai da fila (não trava as outras)
antes = await linhas()
fora = true; await fila.bater('DEMO-0101'); passar(5 * 24 * 3600); fora = false
await fila.bater('DEMO-0105')   // internet voltou: vai para o fim da fila e o envio começa
await fila.enviar(); ok(fila.pendentes() === 0 && await linhas() === antes + 1, 'velha demais é descartada e a seguinte é enviada')

// resposta perdida (internet lenta): o banco gravou mas o totem não soube; o reenvio não pode duplicar
antes = await linhas()
passar(3600); perdida = true
r = await fila.bater('DEMO-0105'); ok(r.ok && r.guardada, 'resposta perdida: o totem guarda para reenviar')
perdida = false
passar(40); await fila.enviar()
ok(fila.pendentes() === 0 && await linhas() === antes + 1, `reenvio da mesma leitura não duplica (${await linhas() - antes} batida(s) gravada(s))`)

// batida guardada que o banco recusou depois: fica anotada para o totem avisar (antes sumia calada)
const motivos = fila.recusadas().map(x => x.motivo).join(' | ')
ok(motivos.includes('outro setor') && motivos.includes('tempo demais'), 'recusadas ficam anotadas com o motivo: ' + motivos)
fila.limparRecusadas(); ok(fila.recusadas().length === 0, 'aviso dispensado zera a lista')

console.log(`\n${total - falhas}/${total} verificações do totem ok`)
process.exit(falhas ? 1 : 0)
