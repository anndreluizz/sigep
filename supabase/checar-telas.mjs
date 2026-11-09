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

console.log(`\n${total - falhas}/${total} verificações das telas ok`)
process.exit(falhas ? 1 : 0)
