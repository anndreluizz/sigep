// node checar-folha-semed.mjs — folha da SEMED sem banco: categorias, valores dos dias e páginas (não precisa de npm install)
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import assert from 'node:assert/strict'

const raiz = new URL('../', import.meta.url), ler = f => readFileSync(new URL(f, raiz), 'utf8')
const ctx = vm.createContext({console, Date, Intl, Set, Object, JSON, String, Array, Number, RegExp, Error, Math,
  addEventListener() {}, location: {hash: ''}, document: {querySelector: () => ({}), querySelectorAll: () => [], addEventListener() {}}})
for (const f of ['js/config.js', 'js/app.js']) vm.runInContext(ler(f), ctx, {filename: f})
const run = c => vm.runInContext(c, ctx)

const cat = (cargo, vinculo) => run(`categoriaSemed(${JSON.stringify({cargo, vinculo})})[0]`)
assert.equal(cat('Pedagoga'), '01'); assert.equal(cat('Apoio Pedagógico'), '08'); assert.equal(cat('Administrativo(a)'), '02')
assert.equal(cat('Secretário(a) escolar'), '02'); assert.equal(cat('Aux. Serv. Gerais'), '03'); assert.equal(cat('Gestora'), '04')
assert.equal(cat('Merendeira'), '05'); assert.equal(cat('Professor(a)', 'efetivo'), '06'); assert.equal(cat('Professor(a)', 'contratado'), '09')
assert.equal(cat('Professor'), '09'); assert.equal(cat('Vigia'), '07'); assert.equal(cat('AVE'), '10'); assert.equal(cat('Bibliotecária'), '11')
assert.equal(cat('Professor PACCET', 'efetivo'), '12'); assert.equal(cat('Motorista'), '13')
// textos reais da coluna APLICAÇÃO das 12 planilhas da E.M. São Francisco de Assis (set/2026) → número da planilha
for (const [cargo, vinculo, n] of [['APOIO PEDAGÓGICO', 'contratado', '08'], ['APOIO PEDAGÓGICO/MAT.', 'efetivo', '08'], ['APOIO PEDAGÓGICO/VESP.', 'contratado', '08'],
  ['ASSISTENTE ADM./MANHÃ', 'contratado', '02'], ['ASSISTENTE ADM./TARDE', 'contratado', '02'], ['AUX.SERV.GER.', 'contratado', '03'], ['AUX.SERV.GER.', 'efetivo', '03'],
  ['AUXILAR BIBLIOTECA', 'contratado', '11'], ['AUXILIAR ADMINISTRATIVO', 'contratado', '02'], ['GESTORA', 'efetivo', '04'], ['INSTRUTOR/PACCET', 'contratado', '12'],
  ['MERENDEIRA', 'contratado', '05'], ['MERENDEIRO', 'efetivo', '05'], ['PAE', 'contratado', '10'], ['PEDAGOGO', 'contratado', '01'], ['PEGAGOGO', 'efetivo', '01'],
  ['PROFESSOR', 'contratado', '09'], ['PROFESSOR', 'efetivo', '06'], ['PROFESSOR/AEE', 'efetivo', '06'], ['PROFESSOR/MAT.', 'contratado', '09'], ['PROFESSOR/NOT.', 'contratado', '09'],
  ['PROFESSOR/PACCET', 'contratado', '12'], ['PROFESSOR/PACCET', 'efetivo', '12'], ['PROFESSOR/VESP.', 'contratado', '09'], ['VIGIA', 'contratado', '07'], ['VIGIA', 'efetivo', '07']])
  assert.equal(cat(cargo, vinculo), n, cargo + ' / ' + vinculo)

// setembro/2026: turno seg–sex; ter 01 presente, qua 02 falta, qui 03 atestado, 07/09 feriado
const T = {id: 't', nome: 'Matutino', entrada: '07:00:00', saida: '11:00:00', dias_semana: [1, 2, 3, 4, 5], tolerancia_min: 10, tolerancia_saida_min: 10}
const sv = (id, nome, cargo, vinculo, situacao = 'ativo') => ({id, nome, cargo, vinculo, situacao, setor_id: 'e', turno_id: 't', matricula: id})
const bat = (id, dia) => [{servidor_id: id, tipo: 'entrada', em: dia + 'T11:00:00Z'}, {servidor_id: id, tipo: 'saida', em: dia + 'T15:00:00Z'}]
run(`S.d = ${JSON.stringify({setores: [{id: 'e', nome: 'E. M. São Francisco de Assis'}], turnos: [T], escalas: [], feriados: [{data: '2026-09-07', nome: 'Independência'}],
  servidores: [sv('a', 'Ana', 'Pedagoga', 'efetivo'), sv('b', 'Bia', 'Professor(a)', 'contratado'), sv('c', 'Caio', 'Professor(a)', 'efetivo', 'ferias')]})}`)
run(`S.bat = ${JSON.stringify([...bat('a', '2026-09-01'), ...bat('a', '2026-09-04'), ...bat('b', '2026-09-01')])}`)
run(`S.just = [{servidor_id: 'a', tipo: 'atestado', status: 'aprovada', inicio: '2026-09-03', fim: '2026-09-03'},
  {servidor_id: 'b', tipo: 'licenca_maternidade', status: 'aprovada', inicio: '2026-09-02', fim: '2026-09-30'}]`)
const dia = (id, d) => run(`(() => { const s = S.d.servidores.find(x => x.id === '${id}'); return valorSemed(s, espelhoMes(s, S.bat, '2026-09', {...S.d, justificativas: S.just}, hoje()).dias[${d - 1}]) })()`)
assert.equal(dia('a', 1), 1); assert.equal(dia('a', 2), 0); assert.equal(dia('a', 3), 'AM'); assert.equal(dia('a', 4), 1)
assert.equal(dia('b', 2), 'LM'); assert.equal(dia('b', 30), 'LM'); assert.equal(dia('a', 5), ''); assert.equal(dia('a', 7), ''); assert.equal(dia('c', 1), 'F')

const html = run(`htmlFolhaSemed('e', '2026-09')`)
assert.equal((html.match(/class="semed"/g) || []).length, 3)          // 01, 06 e 09, nessa ordem
assert.ok(html.indexOf('PLANILHA 01') < html.indexOf('PLANILHA 06') && html.indexOf('PLANILHA 06') < html.indexOf('PLANILHA 09'))
assert.ok(html.includes('MÊS/ANO: SETEMBRO/2026') && html.includes('PERÍODO: 01/09/2026 A 30/09/2026') && html.includes('E. M. SÃO FRANCISCO DE ASSIS'))
// toda linha tem 4 + 30 dias + total = 35 colunas
for (const tr of html.match(/<tr>\s*<td>\d+<\/td>[\s\S]*?<\/tr>/g)) assert.equal((tr.match(/<td/g) || []).length, 35)
// a secretaria confere na tela a mesma folha que imprime
run(`S.perfil = {papel: 'chefe', setor_id: 'e'}; S.mes = '2026-09'`)
const tela = run('telaSemed()')
assert.ok(tela.includes('semed-tela') && tela.includes('PLANILHA 09') && tela.includes('data-a="imprimir-semed"') && tela.includes('data-a="voltar-semed"'))
console.log('folha SEMED: ok')
