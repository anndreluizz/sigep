// npm run telas — abre todas as telas em todos os perfis sobre o banco de verdade (PGlite + migrações)
// e faz os fluxos principais do RH: cadastrar, desligar, convite, importar planilha.
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const raiz = new URL('../', import.meta.url)
const ler = f => readFileSync(new URL(f, raiz), 'utf8')
let falhas = 0, total = 0
const ok = (c, msg) => { total++; if (!c) { falhas++; console.error('  FALHOU:', msg) } }

const el = () => ({innerHTML: '', classList: {add() {}, remove() {}}, insertAdjacentHTML() {}})
const els = {}
// formulário de mentira: FormData(f) lê f.campos
class FormData { constructor(f) { this.c = f.campos } [Symbol.iterator]() { return this.c[Symbol.iterator]() } getAll(k) { return this.c.filter(x => x[0] === k).map(x => x[1]) } }
const ctx = vm.createContext({console, Promise, Date, Intl, Set, Object, JSON, String, Array, Number, RegExp, Error,
  FormData, confirm: () => true, print() {}, scrollTo() {}, addEventListener() {}, location: {hash: ''},
  document: {querySelector: s => els[s] ??= el(), querySelectorAll: () => [], addEventListener() {}, body: el()},
  qrcode: () => ({addData() {}, make() {}, createSvgTag: () => '<svg/>'})})
for (const f of ['js/config.js', 'js/local.js', 'js/app.js']) vm.runInContext(ler(f), ctx, {filename: f})
const run = c => vm.runInContext(c, ctx)

const cliente = await run('criarClienteLocal')(PGlite, m => ler('supabase/migrations/' + m))
await run('semearDemo')(cliente)
ctx.cliente = cliente
run('sb = cliente')
const tela = () => els['#app'].innerHTML
const entrar = async email => {
  const {data, error} = await cliente.auth.signInWithPassword({email, password: 'demo1234'})
  ok(!error, 'login ' + email); await run('entrou')(data.session.user)
}
const form = (nome, campos, id) => run(`executar(() => FORMS['${nome}'](${JSON.stringify({campos, dataset: id ? {id} : {}})}, {}))`)
const acao = (nome, dataset = {}) => run(`executar(() => ACOES['${nome}'](${JSON.stringify({dataset})}))`)
const msg = () => run('S.msg')

// todas as telas em todos os perfis
for (const email of ['rh@demo', 'chefe@demo', 'prefeito@demo', 'servidor@demo', 'totem@demo']) {
  await entrar(email)
  for (const [aba] of run('ABAS[S.perfil.papel]')) {
    run(`S.aba = '${aba}'; render()`)
    ok(tela().length > 150 && !/undefined|NaN|\[object/.test(tela()), `tela ${email}/${aba}: ${tela().match(/.{0,60}(undefined|NaN|\[object).{0,60}/)?.[0] || 'vazia'}`)
  }
}
await entrar('chefe@demo'); run(`S.aba = 'servidores'; render()`)
ok(tela().includes('Ana Paula') && !tela().includes('Paulo Henrique'), 'chefe vê só a escola')
await entrar('servidor@demo'); run('render()'); ok(tela().includes('0101') && run('S.d.servidores.length') === 1, 'servidora vê só o próprio cadastro')

// RH: cadastrar, editar, desligar
await entrar('rh@demo'); run(`S.aba = 'servidores'`)
const escola = '10000000-0000-4000-8000-000000000001', matutino = '20000000-0000-4000-8000-000000000001', vigia = '30000000-0000-4000-8000-000000000001'
run(`S.edit = 'novo'`)
await form('servidor', [['matricula', '0200'], ['nome', 'João Batista Rocha'], ['cargo', 'Merendeiro'], ['setor_id', escola], ['jornada', 't:' + matutino],
  ['escala_inicio', ''], ['vinculo', 'contratado'], ['admissao', '2026-02-01'], ['cpf', '123.456.789-01'], ['telefone', ''], ['situacao', 'ativo']])
ok(msg()?.[0] === 'ok', 'cadastra servidor: ' + msg()?.[1])
const joao = run(`S.d.servidores.find(s => s.matricula === '0200')`)
ok(joao?.cpf === '12345678901' && joao.turno_id === matutino && joao.codigo?.length === 32, 'CPF só números, turno e código do crachá')
run(`S.edit = 'novo'`)
await form('servidor', [['matricula', '0200'], ['nome', 'Outro Nome'], ['setor_id', escola], ['jornada', '']])
ok(msg()?.[1]?.includes('repetido'), 'matrícula repetida: ' + msg()?.[1])
run(`S.edit = '${joao.id}'`)
await form('servidor', [['matricula', '0200'], ['nome', 'João Batista Rocha'], ['setor_id', escola], ['jornada', 'e:' + vigia], ['escala_inicio', '']])
ok(msg()?.[1]?.includes('início da escala'), 'escala sem data de início')
await form('servidor', [['matricula', '0200'], ['nome', 'João Batista Rocha'], ['setor_id', escola], ['jornada', 'e:' + vigia], ['escala_inicio', '2026-11-02']])
ok(run(`S.d.servidores.find(s => s.matricula === '0200').escala_id`) === vigia, 'passa para a escala do vigia')
await acao('desligar', {id: joao.id})
ok(run(`S.d.servidores.find(s => s.matricula === '0200').situacao`) === 'desligado', 'desliga')
run(`S.filtro.sit = 'ativos'; S.msg = null; render()`); ok(!tela().includes('João Batista'), 'desligado sai da lista de ativos')
run(`S.filtro.sit = 'todos'`)

// setores, turnos
run(`S.aba = 'setores'`)
await form('setor', [['nome', 'Gabinete do Prefeito']]); ok(run(`S.d.setores.some(s => s.nome === 'Gabinete do Prefeito')`), 'cria setor')
await acao('excluir-setor', {id: escola}); ok(msg()?.[1]?.includes('ligados'), 'não exclui setor com servidores: ' + msg()?.[1])
await form('turno', [['nome', 'Vespertino'], ['entrada', '13:00'], ['saida', '17:30'], ['saida_almoco', ''], ['retorno_almoco', ''], ['tolerancia_min', '10'], ['tolerancia_saida_min', '10'], ['dia', '1'], ['dia', '3']])
ok(JSON.stringify(run(`S.d.turnos.find(t => t.nome === 'Vespertino')?.dias_semana`)) === '[1,3]', 'cria turno com dias: ' + msg()?.[1])

// convite: RH gera, pessoa nova cria conta e entra como chefe da escola
run(`S.aba = 'acessos'`)
await form('convite-novo', [['papel', 'chefe'], ['nome', 'Diretor da UBS'], ['setor_id', '10000000-0000-4000-8000-000000000002']])
const codigo = run('S.convite?.codigo'); ok(codigo?.length === 10, 'gera código de convite')
run('render()'); ok(tela().includes(codigo), 'código aparece na tela')
await acao('sair')
const {data: nova} = await cliente.auth.signUp({email: 'diretor@ubs', password: 'senha-forte-1'})
await run('entrou')(nova.session.user); run('render()')
ok(tela().includes('Código de convite'), 'conta nova sem perfil pede o código')
await form('convite', [['codigo', codigo.toLowerCase()]])
ok(run('S.perfil?.papel') === 'chefe' && run('S.d.servidores.every(s => s.setor_id === "10000000-0000-4000-8000-000000000002")'), 'convite aceito: chefe da UBS vê só a UBS')

// RH desativa o totem
await entrar('rh@demo')
await acao('ativar', {id: '00000000-0000-4000-8000-000000000005', v: 'false'})
const {data: tt} = await cliente.auth.signInWithPassword({email: 'totem@demo', password: 'demo1234'})
try { await run('entrou')(tt.session.user); ok(false, 'totem desativado não entra') } catch (e) { ok(e.message.includes('desativado'), 'totem desativado não entra') }

// planilha
await entrar('rh@demo')
const conf = run('conferirPlanilha')([
  {'Matrícula': '0300', 'Nome': 'Maria das Dores', 'Setor': 'Secretaria de Assistência Social', 'Cargo': 'Assistente', 'Turno': 'matutino', 'Vínculo': 'Efetivo', 'CPF': '111.222.333-44', 'Admissão': '05/03/2024'},
  {'Matrícula': '0301', 'Nome': 'José Lima', 'Setor': 'Secretaria de Obras', 'Cargo': '', 'Turno': '', 'Vínculo': '', 'CPF': '', 'Admissão': new Date('2025-01-10T12:00:00Z')},
  {'Matrícula': '0101', 'Nome': 'Ana Paula Ferreira', 'Setor': 'E.M. São Francisco de Assis'},
  {'Matrícula': '0300', 'Nome': 'Repetida', 'Setor': 'Obras'},
  {'Matrícula': '0302', 'Nome': 'Sem Turno', 'Setor': 'Obras', 'Turno': 'Noturno'},
  {'Matrícula': '0303', 'Nome': 'CPF curto', 'Setor': 'Obras', 'CPF': '123'},
  {'Matrícula': '', 'Nome': '', 'Setor': ''},
  {'Matrícula': '0304', 'Nome': '', 'Setor': 'Obras'}])
ok(conf.ok.length === 2 && conf.repetidas === 1 && conf.erros.length === 4, `planilha: ${conf.ok.length} ok, ${conf.repetidas} repetidas, erros: ${conf.erros.join(' | ')}`)
ok(conf.ok[0].cpf === '11122233344' && conf.ok[0].admissao === '2024-03-05' && conf.ok[0].vinculo === 'efetivo' && conf.ok[1].admissao === '2025-01-10', 'planilha: CPF, datas e vínculo normalizados')
run('S.imp = conferirPlanilha')
ctx.conf = conf; run('S.imp = conf'); run(`S.aba = 'importar'; render()`); ok(tela().includes('Importar 2 servidor'), 'prévia da importação')
await acao('importar')
ok(msg()?.[1] === '2 servidor(es) importado(s).' && run(`S.d.setores.some(s => s.nome === 'Secretaria de Assistência Social')`), 'importa e cria o setor novo: ' + msg()?.[1])
ok(run(`S.d.servidores.find(s => s.matricula === '0300').turno_id`) === matutino, 'turno pelo nome, sem diferenciar maiúsculas')

// ---------- espelho de ponto: regras (função pura) ----------
const esp = run('espelhoMes'), mat = {id: 'T1', entrada: '07:00:00', saida: '11:30:00', tolerancia_min: 10, tolerancia_saida_min: 10, dias_semana: [1, 2, 3, 4, 5]}
const plant = {id: 'T2', entrada: '07:00:00', saida: '07:00:00', tolerancia_min: 10, tolerancia_saida_min: 10, dias_semana: [0, 1, 2, 3, 4, 5, 6]}
const cad = {turnos: [mat, plant], escalas: [{id: 'E1', turno_id: 'T2', dias_trabalho: 1, dias_descanso: 3}], feriados: [{data: '2026-10-12', nome: 'Nossa Senhora Aparecida'}]}
const bt = (sid, tipo, quando) => ({servidor_id: sid, tipo, em: quando + ':00-04:00'})
const outubro = esp({id: 'A', turno_id: 'T1'}, [
  bt('A', 'entrada', '2026-10-01T07:05'), bt('A', 'saida', '2026-10-01T11:30'),   // dentro da tolerância
  bt('A', 'entrada', '2026-10-02T07:30'), bt('A', 'saida', '2026-10-02T11:30'),   // atraso de 30 min
  bt('A', 'entrada', '2026-10-03T08:00'), bt('A', 'saida', '2026-10-03T10:00'),   // sábado
  bt('A', 'entrada', '2026-10-05T07:00'),                                          // esqueceu a saída
  bt('A', 'entrada', '2026-10-06T07:00'), bt('A', 'saida', '2026-10-06T10:00'),   // saiu antes
  bt('OUTRO', 'entrada', '2026-10-07T07:00')], '2026-10', cad, '2026-11-09')
const dia = d => outubro.dias.find(x => x.dia === d), ocs = d => dia(d).oc.map(o => o[0]).join(',')
ok(outubro.dias.length === 31 && outubro.tot.previsto === 21 * 270, 'outubro: 21 dias úteis de 4h30 (feriado de 12/10 não conta): ' + outubro.tot.previsto)
ok(outubro.tot.trabalhado === 265 + 240 + 120 + 180 && outubro.tot.saldo === outubro.tot.trabalhado - outubro.tot.previsto, 'trabalhado e saldo: ' + outubro.tot.trabalhado)
ok(ocs('2026-10-01') === '' && ocs('2026-10-02') === 'Atraso 0h30', 'tolerância de 10 min; atraso de 30 min: ' + ocs('2026-10-02'))
ok(ocs('2026-10-03') === 'Fora da escala' && ocs('2026-10-05') === 'Sem saída' && ocs('2026-10-06') === 'Saiu antes', 'sábado, sem saída, saiu antes')
ok(ocs('2026-10-07') === 'Falta' && ocs('2026-10-12') === '' && ocs('2026-10-04') === '', 'falta (batida de outro servidor não conta), feriado e domingo sem falta')
ok(outubro.tot.faltas === 17 && outubro.tot.atrasos === 1 && outubro.tot.pendencias === 1, `totais: ${outubro.tot.faltas} faltas, ${outubro.tot.atrasos} atraso, ${outubro.tot.pendencias} pendência`)
const vig = esp({id: 'V', escala_id: 'E1', escala_inicio: '2026-11-01'}, [bt('V', 'entrada', '2026-11-01T07:00'), bt('V', 'saida', '2026-11-02T07:02')], '2026-11', cad, '2026-11-09')
const vd = d => vig.dias.find(x => x.dia === d)
ok(vd('2026-11-01').trab === 1442 && !vd('2026-11-01').oc.length && !vd('2026-11-02').pares.length, 'plantão 24 h: conta no dia da entrada, sem pendência')
ok(!vd('2026-11-02').prev && !vd('2026-11-04').oc.length && vd('2026-11-05').oc[0]?.[0] === 'Falta' && vd('2026-11-09').prev && !vd('2026-11-09').oc.length,
   'escala 24×72: folga sem falta, falta no próximo plantão, hoje ainda não é falta')
ok(vig.tot.previsto === 2 * 1440, 'plantão previsto: 2 × 24 h até ontem')
const agora = Math.round(Date.parse('2026-11-09T09:00:00-04:00') / 6e4)
ok(esp({id: 'A', turno_id: 'T1'}, [bt('A', 'entrada', '2026-11-09T07:00')], '2026-11', cad, '2026-11-09', agora).dias[8].oc[0][0] === 'Em andamento', 'entrada de hoje sem saída: em andamento')
const integral = {id: 'T3', entrada: '07:00:00', saida: '17:00:00', saida_almoco: '11:00:00', retorno_almoco: '13:00:00', tolerancia_min: 10, tolerancia_saida_min: 10, dias_semana: [1, 2, 3, 4, 5]}
const alm = esp({id: 'R', turno_id: 'T3'}, [bt('R', 'entrada', '2026-10-01T07:00'), bt('R', 'saida', '2026-10-01T17:00'),
  bt('R', 'entrada', '2026-10-02T07:00'), bt('R', 'saida', '2026-10-02T11:00'), bt('R', 'entrada', '2026-10-02T12:00'), bt('R', 'saida', '2026-10-02T17:00')],
  '2026-10', {...cad, turnos: [integral]}, '2026-11-09').dias
ok(alm[0].esperado === 480 && alm[0].trab === 480 && alm[1].trab === 540, `almoço: 2 batidas descontam o intervalo (${alm[0].trab}); 4 batidas contam o que bateu (${alm[1].trab})`)
ok(esp({id: 'A', turno_id: 'T1', admissao: '2026-10-20'}, [], '2026-10', cad, '2026-11-09').tot.faltas === 9, 'antes da admissão não é falta')

// ---------- espelho de ponto: telas, com batidas de verdade no banco ----------
await cliente._db.query(`insert into batidas (servidor_id, tipo, em, origem, motivo) values
  ('40000000-0000-4000-8000-000000000001', 'entrada', '2026-08-03 07:02-04', 'ajuste', 'teste do espelho'),
  ('40000000-0000-4000-8000-000000000001', 'saida',   '2026-08-03 11:31-04', 'ajuste', 'teste do espelho'),
  ('40000000-0000-4000-8000-000000000003', 'entrada', '2026-08-03 07:00-04', 'ajuste', 'teste do espelho')`)
await entrar('rh@demo'); run(`S.mes = '2026-08'; S.aba = 'horarios'`)
await form('feriado', [['data', '2026-08-12'], ['nome', 'Nossa Senhora Aparecida']]); ok(run('S.d.feriados.length') === 1, 'RH cadastra feriado: ' + msg()?.[1])
run(`S.aba = 'espelho'; S.filtro.setor = ''`); await run('executar(async () => {})')
ok(run('S.bat.length') === 3 && tela().includes('Frequência do mês') && tela().includes('Rita de Cássia'), 'RH: frequência de todos os setores')
await acao('ver-espelho', {id: '40000000-0000-4000-8000-000000000001'})
ok(tela().includes('07:02–11:31') && tela().includes('agosto de 2026') && tela().includes('Feriado: Nossa Senhora'), 'espelho da Ana: batidas, mês e feriado')
await acao('imprimir-espelho', {id: '40000000-0000-4000-8000-000000000001'}); ok(els['#impressao'].innerHTML.includes('Chefia imediata'), 'impressão com assinaturas')
await entrar('chefe@demo'); run(`S.mes = '2026-08'; S.aba = 'espelho'; S.esp = null`); await run('executar(async () => {})')
ok(run('S.bat.length') === 2 && !tela().includes('Rita de Cássia'), 'chefe: só batidas e servidores da escola')
await entrar('servidor@demo'); run(`S.mes = '2026-08'; S.aba = 'ponto'`); await run('executar(async () => {})')
ok(run('S.bat.length') === 2 && tela().includes('Ana Paula') && tela().includes('07:02–11:31'), 'servidora: Meu ponto com as próprias batidas')
for (const email of ['rh@demo', 'chefe@demo', 'prefeito@demo', 'servidor@demo']) {
  await entrar(email); run(`S.mes = '2026-08'; S.esp = null`)
  for (const aba of ['espelho', 'ponto'].filter(a => run('ABAS[S.perfil.papel]').some(x => x[0] === a))) {
    run(`S.aba = '${aba}'`); await run('executar(async () => {})')
    ok(!/undefined|NaN|\[object/.test(tela()) && !run('S.msg'), `tela ${email}/${aba}: ${run('S.msg')?.[1] || tela().match(/.{0,60}(undefined|NaN|\[object).{0,60}/)?.[0]}`)
  }
}

// ---------- RH cria a escola e o acesso da secretaria; a secretaria cadastra os servidores dela ----------
await entrar('rh@demo'); run(`S.aba = 'setores'; S.convite = null`)
await form('setor', [['nome', 'E.M. Nova Esperança']])
ok(msg()?.[1]?.includes('Gerar acesso da secretaria'), 'criou o setor e sugere gerar o acesso: ' + msg()?.[1])
const novaEsc = run(`S.d.setores.find(s => s.nome === 'E.M. Nova Esperança').id`)
await acao('acesso-setor', {id: novaEsc})
const codSec = run('S.convite?.codigo'); run('render()')
ok(codSec?.length === 10 && tela().includes(codSec) && tela().includes('Acesso da secretaria'), 'código da secretaria aparece em Setores')
await acao('sair')
const {data: sec} = await cliente.auth.signUp({email: 'secretaria@novaesperanca', password: 'senha-forte-2'})
await run('entrou')(sec.session.user); await form('convite', [['codigo', codSec]])
ok(run('S.perfil?.papel') === 'chefe' && run('S.perfil.setor_id') === novaEsc, 'secretaria entrou como gestão da Nova Esperança')
run(`S.aba = 'servidores'; S.edit = 'novo'; render()`)
ok(tela().includes('+ Novo servidor') && (tela().match(/<option value="[^"]+"/g) || []).filter(o => o.includes(novaEsc)).length === 1 && !tela().includes('E.M. São Francisco de Assis</option>'), 'secretaria: botão de cadastrar e só a própria escola no formulário')
await form('servidor', [['matricula', '0501'], ['nome', 'Raimunda Souza'], ['cargo', 'Merendeira'], ['setor_id', novaEsc], ['jornada', 't:' + matutino],
  ['escala_inicio', ''], ['vinculo', 'contratado'], ['admissao', ''], ['cpf', '987.654.321-00'], ['telefone', '(97) 9 9111-2222'], ['situacao', 'ativo']])
ok(msg()?.[0] === 'ok' && run(`S.d.servidores.find(s => s.matricula === '0501')?.cpf`) === '98765432100', 'secretaria cadastra servidora e vê o CPF dela: ' + msg()?.[1])
ok(run('S.d.servidores.every(s => s.setor_id === "' + novaEsc + '")'), 'secretaria só vê os servidores da própria escola')
run(`S.edit = 'novo'`); await form('servidor', [['matricula', '0502'], ['nome', 'Fora da Escola'], ['setor_id', escola], ['jornada', '']])
ok(msg()?.[0] === 'erro', 'secretaria não cadastra em outra escola: ' + msg()?.[1])
run(`S.aba = 'acessos'; S.edit = null; S.convite = null; render()`)
ok(tela().includes('Totem (tablet') && !tela().includes('>RH<') && !tela().includes('Quem tem acesso'), 'acessos da secretaria: só servidor e totem')
await form('convite-novo', [['papel', 'totem'], ['nome', 'Totem – Nova Esperança'], ['setor_id', novaEsc]])
ok(run('S.convite?.codigo')?.length === 10, 'secretaria gera o convite do totem: ' + msg()?.[1])

// ---------- justificativas: servidora pede, chefe decide, espelho muda ----------
const ANA = '40000000-0000-4000-8000-000000000001', CARLOS = '40000000-0000-4000-8000-000000000002'
const decidir = (id, aprovar, resposta = '') => run(`executar(() => FORMS.decidir(${JSON.stringify({campos: [['resposta', resposta]], dataset: {id}})}, {submitter: {value: '${aprovar ? 1 : 0}'}}))`)
await entrar('servidor@demo'); run(`S.mes = '2026-08'; S.aba = 'ponto'; S.jtipo = 'atestado'`); await run('executar(async () => {})')
ok(tela().includes('Pedir justificativa') && tela().includes('Entregue o atestado'), 'servidora: formulário de pedido')
await form('justificativa', [['tipo', 'atestado'], ['inicio', '2026-08-04'], ['fim', '2026-08-05'], ['motivo', 'Consulta e repouso']], ANA)
ok(msg()?.[1]?.includes('Pedido enviado') && tela().includes('Em análise'), 'servidora envia atestado: ' + msg()?.[1])
run(`S.jtipo = 'batida'; render()`); ok(tela().includes('Hora em que chegou'), 'esqueci de bater: pede dia e hora')
await form('justificativa', [['tipo', 'batida'], ['dia', '2026-08-06'], ['hora', '07:00'], ['batida_tipo', 'entrada'], ['motivo', 'Totem estava sem bateria']], ANA)
await form('justificativa', [['tipo', 'abono'], ['inicio', '2026-08-07'], ['fim', '2026-08-07'], ['motivo', 'Pedido que vou retirar']], ANA)
ok(run(`S.pedidos.filter(j => j.status === 'pendente').length`) === 3 && tela().includes('Desistir'), 'três pedidos em análise, com botão de desistir')
await acao('desistir', {id: run(`S.pedidos.find(j => j.tipo === 'abono').id`)}); ok(run('S.pedidos.length') === 2, 'servidora desiste de um pedido')
ok(tela().includes('Pedido em análise'), 'espelho avisa do pedido em análise')
await form('justificativa', [['tipo', 'abono'], ['inicio', '2026-08-01'], ['fim', '2026-08-01'], ['motivo', 'Pedido pelo colega']], CARLOS)
ok(msg()?.[0] === 'erro', 'servidora não pede pelo colega: ' + msg()?.[1])

await entrar('chefe@demo'); run(`S.mes = '2026-08'; S.aba = 'pedidos'; S.msg = null; render()`)
ok(tela().includes('Esperando resposta <small>2') && els['#tabs'].innerHTML.includes('pill amber">2'), 'chefe: 2 pedidos esperando, com aviso na aba')
await decidir(run(`S.pedidos.find(j => j.tipo === 'batida').id`), true, 'Confirmado com a portaria')
await decidir(run(`S.pedidos.find(j => j.tipo === 'atestado').id`), true)
ok(msg()?.[1] === 'Pedido aprovado.' && tela().includes('Esperando resposta <small>0') && tela().includes('Confirmado com a portaria'), 'chefe aprova os dois')
run(`S.aba = 'espelho'; S.esp = '${ANA}'`); await run('executar(async () => {})')
const totAna = run(`espelhoMes(S.d.servidores.find(s => s.id === '${ANA}'), S.bat, '2026-08', {...S.d, justificativas: S.just}, hoje()).tot`)
ok(tela().includes('Atestado médico') && tela().includes('✎') && totAna.faltas === 16 && totAna.pendencias === 1, `espelho: atestado abona 2 dias e a batida aprovada aparece com ✎ (${totAna.faltas} faltas, ${totAna.pendencias} pendência)`)
ok(tela().includes('Lançar justificativa'), 'chefe pode lançar pelo espelho')
await form('justificativa', [['tipo', 'ferias'], ['inicio', '2026-08-10'], ['fim', '2026-08-14'], ['motivo', 'Férias regulamentares']], CARLOS)
ok(msg()?.[1] === 'Justificativa lançada e aprovada.', 'chefe lança férias já aprovadas: ' + msg()?.[1])
await entrar('prefeito@demo'); run(`S.mes = '2026-08'; S.aba = 'espelho'; S.esp = '${ANA}'`); await run('executar(async () => {})')
ok(tela().includes('Ana Paula') && !tela().includes('Lançar justificativa') && !tela().includes('Pedir justificativa'), 'Prefeito só olha o espelho')

// ---------- painel "Hoje" ----------
await cliente._db.query(`insert into batidas (servidor_id, tipo, em, origem, totem_id) values ($1, 'entrada', now() - interval '5 minutes', 'totem', '00000000-0000-4000-8000-000000000005')`, [ANA])
await entrar('chefe@demo'); run(`S.aba = 'painel'; S.mes = '2026-08'`); await run('executar(async () => {})')
ok(run('S.mes') === null && tela().includes('Últimas batidas de hoje') && tela().includes('Ana Paula') && tela().includes('pelo totem: hoje'), 'painel da secretaria: mês de hoje, batida de agora e status do totem')
ok(tela().includes('Pendências do mês') && !tela().includes('Por unidade') && !/undefined|NaN/.test(tela()), 'painel da secretaria: pendências, sem a tabela por unidade')
await entrar('rh@demo'); run(`S.aba = 'painel'`); await run('executar(async () => {})')
ok(tela().includes('Por unidade') && tela().includes('Todas as unidades') && !/undefined|NaN/.test(tela()), 'painel do RH: todas as unidades')

// batidas de exemplo da demo.html: o SQL roda e o mês passado tem espelho com ocorrências
await run('semearBatidasDemo')(cliente)
await entrar('rh@demo'); run(`S.mes = null; S.esp = null; S.aba = 'espelho'`)
const mesPassado = run('addDia(hoje().slice(0, 7) + "-01", -1).slice(0, 7)'); run(`S.mes = '${mesPassado}'`); await run('executar(async () => {})')
ok(run('S.bat.length') > 100 && tela().includes('Carlos Eduardo') && /pill red">[1-9]/.test(tela()), `demo: batidas do mês passado (${run('S.bat.length')}) e faltas do Carlos`)

console.log(`\n${total - falhas}/${total} verificações das telas ok`)
process.exit(falhas ? 1 : 0)
