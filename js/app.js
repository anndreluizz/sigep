// SIGEP · telas. Tudo passa pelo banco (Supabase); as permissões são conferidas lá (RLS),
// a tela só esconde o que o perfil não usa. `sb` é o cliente do Supabase (ou o local, na demonstração).
let sb
const S = {perfil: null, email: null, aba: null, d: {}, msg: null, edit: null, sel: new Set(), imp: null, filtro: {setor: '', busca: '', sit: 'ativos'}, convite: null,
  mes: null, esp: null, semed: false, bat: [],   // espelho: mês 'aaaa-mm', servidor aberto, batidas do mês
  just: [], pedidos: [], jtipo: 'atestado'}   // justificativas do mês, pedidos recentes, tipo escolhido no formulário
const $ = s => document.querySelector(s)
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]))
const hoje = () => new Date().toLocaleDateString('sv-SE', {timeZone: 'America/Manaus'})   // aaaa-mm-dd
const dataBR = d => d ? d.split('-').reverse().join('/') : ''

const ABAS = {
  rh: [['painel', 'Painel'], ['servidores', 'Servidores'], ['espelho', 'Frequência'], ['pedidos', 'Pedidos'], ['setores', 'Setores'], ['horarios', 'Horários'], ['acessos', 'Acessos'], ['importar', 'Importar planilha']],
  prefeito: [['painel', 'Painel'], ['servidores', 'Servidores'], ['espelho', 'Frequência']],
  chefe: [['painel', 'Painel'], ['servidores', 'Minha equipe'], ['espelho', 'Frequência'], ['pedidos', 'Pedidos'], ['acessos', 'Acessos']],
  servidor: [['ponto', 'Meu ponto'], ['meu', 'Meu cadastro']],
  totem: [['totem', 'Totem']],
}
const PAPEIS = {rh: 'RH', prefeito: 'Prefeito / Gabinete', chefe: 'Secretaria / chefe do setor', servidor: 'Servidor', totem: 'Totem'}
const SITUACAO = {ativo: ['Ativo', 'green'], ferias: ['Férias', 'blue'], afastado: ['Afastado', 'amber'], desligado: ['Desligado', 'red']}

// erros do banco em português (as mensagens das nossas funções já vêm em português)
const ERR = {'23505': 'Já existe um registro igual (matrícula ou nome repetido).', '42501': 'Sem permissão para isso.',
  '23503': 'Não dá para excluir: há cadastros ligados a isso.', '23514': 'Algum dado está fora do permitido.', '23502': 'Falta preencher um campo obrigatório.'}
const traduz = e => e.code === 'P0001' || /[áéíóúãõç]/i.test(e.message) ? e.message
  : /Invalid login/i.test(e.message) ? 'E-mail ou senha incorretos.'
  : /already registered/i.test(e.message) ? 'Já existe uma conta com esse e-mail. Use "Entrar".'
  : /at least/i.test(e.message) ? 'A senha precisa ter pelo menos 8 caracteres.'
  : ERR[e.code] || e.message
async function q(p) { const {data, error} = await p; if (error) throw new Error(traduz(error)); return data }

/* ============================== dados ============================== */
const COLS_SERV = 'id, matricula, nome, cargo, setor_id, turno_id, turnos_extra, escala_id, escala_inicio, situacao, desligado_em, vinculo, admissao, criado_em'
async function carregar() {
  if (S.aba === 'painel') S.mes = null   // o painel é sempre o mês de hoje
  const p = S.perfil.papel, rh = p === 'rh', gestor = rh || p === 'chefe'
  const [setores, turnos, escalas, feriados, servidores, pessoais, perfis, convites, bat, jornadas] = await Promise.all([
    q(sb.from('setores').select('*').order('nome')), q(sb.from('turnos').select('*').order('nome')), q(sb.from('escalas').select('*').order('nome')),
    q(sb.from('feriados').select('*').order('data')),
    p === 'totem' ? [] : q(sb.from('servidores').select(COLS_SERV).order('nome')),
    gestor ? q(sb.rpc('dados_pessoais')) : [], rh ? q(sb.from('perfis').select('*').order('nome')) : [],
    gestor ? q(sb.from('convites').select('*').order('criado_em', {ascending: false})) : [],
    ['espelho', 'ponto', 'painel'].includes(S.aba) ? batidasDoMes(mesAtual()) : [],
    p === 'totem' ? [] : q(sb.from('jornadas_anteriores').select('*').order('ate'))])
  const pes = Object.fromEntries(pessoais.map(x => [x.id, x]))
  // horários anteriores de cada servidor: a folha de um dia usa o horário que valia naquele dia (ver espelhoMes)
  servidores.forEach(s => Object.assign(s, pes[s.id] || {}, {jornadas: jornadas.filter(j => j.servidor_id === s.id)}))
  S.d = {setores, turnos, escalas, feriados, servidores, perfis, convites}
  S.bat = bat
  if (p !== 'totem') {   // justificativas que tocam o mês (para o espelho) e os pedidos recentes (aba Pedidos / Meu ponto)
    const [ini, fim] = limitesMes(mesAtual())
    ;[S.just, S.pedidos, S.env] = await Promise.all([q(sb.from('justificativas').select('*').gte('fim', ini).lte('inicio', fim)),
      q(sb.from('justificativas').select('*').order('pedido_em', {ascending: false}).range(0, 199)),
      q(sb.from('meses_enviados').select('*').eq('mes', ini))])   // unidades que já enviaram este mês ao RH
  }
}
// batidas do mês (com um dia de folga em cada ponta, por causa do plantão que passa da meia-noite).
// O Supabase devolve no máximo 1000 linhas por vez: busca em páginas. O banco só entrega o que o perfil pode ver.
const mesAtual = () => S.mes || hoje().slice(0, 7)
async function batidasDoMes(mes) {
  const [ini, fim] = limitesMes(mes), out = []
  for (let de = 0; ; de += 1000) {
    const pag = await q(sb.from('batidas').select('id, servidor_id, tipo, em, origem').gte('em', addDia(ini, -1) + 'T00:00:00-04:00')
      .lt('em', addDia(fim, 2) + 'T00:00:00-04:00').order('em').order('id').range(de, de + 999))
    out.push(...pag); if (pag.length < 1000) return out
  }
}
const setorNome = id => S.d.setores.find(s => s.id === id)?.nome || '—'
const jornada = s => s.escala_id ? S.d.escalas.find(e => e.id === s.escala_id)?.nome
  : [s.turno_id, ...(s.turnos_extra || [])].map(id => S.d.turnos.find(t => t.id === id)?.nome).filter(Boolean).join(' + ') || '—'
const hora = t => t?.slice(0, 5)
// vínculos da mesma pessoa = cadastros com o mesmo CPF (o banco usa a mesma regra no totem)
const outrosVinculos = s => s.cpf ? S.d.servidores.filter(x => x.id !== s.id && x.cpf === s.cpf) : []
function horariosSeCruzam(a, b) {   // dois turnos que trabalham no mesmo dia da semana e na mesma faixa de horário
  const ts = v => (v.escala_id ? [S.d.escalas.find(e => e.id === v.escala_id)?.turno_id] : [v.turno_id, ...(v.turnos_extra || [])]).map(id => S.d.turnos.find(x => x.id === id)).filter(Boolean)
  const faixa = x => { const e = toMin(x.entrada); let s = toMin(x.saida); if (s <= e) s += 1440; return [e, s] }
  return ts(a).some(ta => ts(b).some(tb => { if (!ta.dias_semana.some(d => tb.dias_semana.includes(d))) return false
    const [a0, a1] = faixa(ta), [b0, b1] = faixa(tb); return a0 < b1 && b0 < a1 }))
}
const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

/* ============================== espelho de ponto ============================== */
// Manaus é UTC-4 o ano todo (sem horário de verão): dá para converter sem biblioteca.
const FUSO_MIN = 4 * 60
const addDia = (dia, n) => new Date(Date.parse(dia + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10)
const limitesMes = mes => { const ini = mes + '-01', fim = addDia(addDia(ini, 32).slice(0, 7) + '-01', -1); return [ini, fim] }
const minAbs = em => Math.round(Date.parse(em) / 6e4)                         // minutos desde 1970 (UTC)
const inicioDia = dia => Math.round(Date.parse(dia + 'T00:00:00Z') / 6e4) + FUSO_MIN   // meia-noite em Manaus
const diaLocal = em => new Date(Date.parse(em) - FUSO_MIN * 6e4).toISOString().slice(0, 10)
const hhmm = abs => { const m = ((abs - FUSO_MIN) % 1440 + 1440) % 1440; return `${String(m / 60 | 0).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}` }
const toMin = t => t ? +t.slice(0, 2) * 60 + +t.slice(3, 5) : null
const duracao = m => `${m < 0 ? '−' : ''}${Math.abs(m) / 60 | 0}h${String(Math.abs(m) % 60).padStart(2, '0')}`
const LIMITE_PLANTAO_MIN = 26 * 60   // igual a limite_plantao_horas() no banco

// Um servidor, um mês → linhas por dia e totais. Função pura: não lê S nem o banco (testável).
// ponytail: férias/afastamento usam a situação atual, não um histórico por data; registrar períodos quando o RH pedir.
const TIPOS_J = {atestado: 'Atestado médico', ferias: 'Férias', licenca: 'Licença especial / afastamento', licenca_maternidade: 'Licença maternidade',
  licenca_paternidade: 'Licença paternidade', sem_remuneracao: 'Licença sem remuneração', servico_externo: 'Serviço externo',
  abono: 'Outro motivo (abono)', batida: 'Esqueci de bater o ponto'}
function espelhoMes(s, batidas, mes, {turnos, escalas, feriados, justificativas = []}, hojeStr, agoraAbs = Math.round(Date.now() / 6e4)) {
  const just = justificativas.filter(j => j.servidor_id === s.id && j.status !== 'recusada')
  // turnos do contrato: escala = o turno dela; senão o principal + os extras (ex.: Matutino + Noturno)
  const contrato = j => { const escala = j.escala_id && escalas.find(e => e.id === j.escala_id)
    return {escala, inicio: j.escala_inicio, meus: (escala ? [escala.turno_id] : [j.turno_id, ...(j.turnos_extra || [])]).map(id => turnos.find(t => t.id === id)).filter(Boolean)} }
  // vigência: s.jornadas são os horários anteriores, cada um valeu "até" uma data; depois da última vale o atual
  const atual = contrato(s), antigos = (s.jornadas || []).map(j => ({ate: j.ate, ...contrato(j)})).sort((a, b) => a.ate < b.ate ? -1 : 1)
  const noDia = dia => antigos.find(j => dia <= j.ate) || atual
  const meus = atual.meus, turno = meus[0]
  const feriado = Object.fromEntries(feriados.map(f => [f.data, f.nome]))
  const [ini, fim] = limitesMes(mes)
  const faixa = t => { const ent = toMin(t.entrada); let sai = toMin(t.saida); if (sai <= ent) sai += 1440
    return {t, ent, sai, min: sai - ent - (t.saida_almoco ? toMin(t.retorno_almoco) - toMin(t.saida_almoco) : 0)} }
  // o ponto só conta a partir do dia em que a pessoa entrou no SIGEP: antes disso não há batida para conferir
  const desde = s.criado_em && new Date(s.criado_em).toLocaleDateString('sv-SE', {timeZone: 'America/Manaus'})
  const periodos = dia => {   // períodos de trabalho previstos no dia
    const {escala, inicio, meus} = noDia(dia)
    if (!meus[0] || (s.admissao && dia < s.admissao) || (desde && dia < desde) || (s.desligado_em && dia > s.desligado_em)) return []
    if (escala) { const n = Math.round((Date.parse(dia) - Date.parse(inicio)) / 864e5)
      return n >= 0 && n % (escala.dias_trabalho + escala.dias_descanso) < escala.dias_trabalho ? [faixa(meus[0])] : [] }
    if (feriado[dia]) return []
    const dow = new Date(dia + 'T12:00:00Z').getUTCDay()
    return meus.filter(t => t.dias_semana.includes(dow)).map(faixa).sort((a, b) => a.ent - b.ent)
  }
  // pares entrada→saída, na ordem; o par conta no dia da entrada (plantão termina no dia seguinte)
  const pares = []; let aberto = null   // aj: alguma das batidas do par foi ajuste (lançada pelo RH / pedido aprovado)
  for (const b of batidas.filter(b => b.servidor_id === s.id).sort((a, b) => minAbs(a.em) - minAbs(b.em))) {
    const aj = b.origem === 'ajuste'
    if (b.tipo === 'entrada') { if (aberto) pares.push(aberto); aberto = {ent: minAbs(b.em), aj} }
    else { pares.push(aberto ? {...aberto, sai: minAbs(b.em), aj: aberto.aj || aj} : {sai: minAbs(b.em), aj}); aberto = null }
  }
  if (aberto) pares.push(aberto)
  const porDia = {}
  for (const p of pares) (porDia[diaLocal(new Date((p.ent ?? p.sai) * 6e4).toISOString())] ??= []).push(p)

  const dias = [], tot = {previsto: 0, trabalhado: 0, faltas: 0, atrasos: 0, pendencias: 0}
  for (let dia = ini; dia <= fim; dia = addDia(dia, 1)) {
    const ps = porDia[dia] || [], d0 = inicioDia(dia), oc = [], fechado = dia < hojeStr
    const pers = periodos(dia).map(f => ({nome: f.t.nome, ent: d0 + f.ent, sai: d0 + f.sai, min: f.min, t: f.t, pares: [],
      alm: f.t.saida_almoco ? [d0 + toMin(f.t.saida_almoco), d0 + toMin(f.t.retorno_almoco)] : null}))
    const prev = pers.length > 0
    // cada par vai para o período mais próximo (pela entrada; sem entrada, pela saída)
    for (const p of ps) { let m = null, dm = Infinity
      for (const pe of pers) { const d = p.ent ? Math.abs(p.ent - pe.ent) : Math.abs(p.sai - pe.sai); if (d < dm) { dm = d; m = pe } }
      m?.pares.push(p) }
    // intervalo pré-assinalado: quem não bate saída/volta do almoço tem o intervalo descontado do par que o cobre
    const trab = ps.reduce((t, p) => t + (p.ent && p.sai ? p.sai - p.ent - pers.reduce((a, pe) => a + (pe.alm && p.ent <= pe.alm[0] && p.sai >= pe.alm[1] ? pe.alm[1] - pe.alm[0] : 0), 0) : 0), 0)
    for (const p of ps) {
      if (!p.ent) oc.push(['Saída sem entrada', 'amber'])
      else if (!p.sai) oc.push(agoraAbs - p.ent < LIMITE_PLANTAO_MIN && dia >= addDia(hojeStr, -1) ? ['Em andamento', 'blue'] : ['Sem saída', 'red'])
    }
    const varios = noDia(dia).meus.length > 1, nm = pe => varios ? ` (${pe.nome})` : ''
    if (prev && fechado && !ps.length) oc.push(['Falta', 'red'])
    for (const pe of pers) {
      if (!pe.pares.length) { if (fechado && ps.length) oc.push([`Faltou no ${pe.nome}`, 'red']); continue }
      const primeira = pe.pares.find(p => p.ent)?.ent, ultima = [...pe.pares].reverse().find(p => p.sai)?.sai
      if (primeira && primeira > pe.ent + pe.t.tolerancia_min) oc.push([`Atraso ${duracao(primeira - pe.ent)}${nm(pe)}`, 'amber'])
      if (fechado && ultima && !pe.pares.some(p => p.ent && !p.sai) && ultima < pe.sai - pe.t.tolerancia_saida_min) oc.push([`Saiu antes${nm(pe)}`, 'amber'])
    }
    if (!prev && ps.length) oc.push([feriado[dia] ? 'Trabalhou no feriado' : 'Fora da escala', 'blue'])
    // abono aprovado: o dia não fica devendo (some falta, atraso e saída antecipada); pedido pendente só avisa
    const abono = just.find(j => j.tipo !== 'batida' && j.status === 'aprovada' && j.inicio <= dia && dia <= j.fim)
    let esperado = pers.reduce((t, pe) => t + pe.min, 0)
    const devendo = o => o[0] === 'Falta' || o[0].startsWith('Faltou no') || o[0].startsWith('Saiu antes') || o[0].startsWith('Atraso')
    if (abono) {
      for (let i = oc.length - 1; i >= 0; i--) if (devendo(oc[i])) oc.splice(i, 1)
      oc.push([TIPOS_J[abono.tipo], 'green']); esperado = Math.min(esperado, trab)
    }
    if (just.some(j => j.status === 'pendente' && j.inicio <= dia && dia <= j.fim)) oc.push(['Pedido em análise', 'blue'])
    const linha = {dia, prev, feriado: feriado[dia], pares: ps, trab, esperado, oc, fechado, periodos: pers}
    if (fechado) {
      tot.previsto += linha.esperado; tot.trabalhado += trab
      tot.faltas += oc.filter(o => o[0] === 'Falta' || o[0].startsWith('Faltou no')).length; tot.atrasos += oc.some(o => o[0].startsWith('Atraso'))
      tot.pendencias += oc.filter(o => ['Sem saída', 'Saída sem entrada'].includes(o[0])).length
    }
    dias.push(linha)
  }
  tot.saldo = tot.trabalhado - tot.previsto
  return {dias, tot, turno, turnos: meus}
}

/* ============================== telas ============================== */
function render() {
  const p = S.perfil
  $('#who').innerHTML = p ? `<b>${esc(p.nome)}</b>${PAPEIS[p.papel]} · <button data-a="sair">Sair</button>`
    : S.email ? `<b>${esc(S.email)}</b><button data-a="sair">Sair</button>` : ''
  const pend = S.pedidos.filter(j => j.status === 'pendente').length
  $('#tabs').innerHTML = p ? ABAS[p.papel].map(([k, t]) => `<a href="#${k}" class="${k === S.aba ? 'on' : ''}">${t}${k === 'pedidos' && pend ? ` <span class="pill amber">${pend}</span>` : ''}</a>`).join('') : ''
  const msg = S.msg ? `<div class="msg ${S.msg[0]}" role="status">${esc(S.msg[1])}</div>` : ''
  $('#app').innerHTML = msg + (!S.email ? telaEntrar() : !p ? telaConvite() : (TELAS[S.aba] || TELAS[ABAS[p.papel][0][0]])())
}

function telaEntrar() {
  return `<div class="entrar">${typeof DICA_ENTRAR === 'string' ? `<div class="msg info">${DICA_ENTRAR}</div>` : ''}<div class="card"><h3>Entrar no SIGEP</h3>
    <form class="f" data-f="entrar">
      <label class="span2">E-mail<input name="email" type="email" required autocomplete="username"></label>
      <label class="span2">Senha<input name="senha" type="password" required autocomplete="current-password"></label>
      <div class="acoes span2"><button class="btn">Entrar</button><button class="btn ghost" name="criar" value="1">Criar conta</button></div>
    </form>
    <p class="sub">Primeiro acesso? Crie a conta com seu e-mail e uma senha de pelo menos 8 caracteres e depois informe o código de convite que o RH te passou.</p>
    <p class="sub"><a href="privacidade.html">Como o SIGEP usa os seus dados (LGPD)</a></p>
  </div></div>`
}

function telaConvite() {
  return `<div class="entrar"><div class="card"><h3>Código de convite</h3>
    <p>Sua conta ainda não tem acesso. Digite o código que o RH te passou.</p>
    <form class="f" data-f="convite">
      <label class="span2">Código<input name="codigo" required autocomplete="off" style="text-transform:uppercase;letter-spacing:.1em"></label>
      <div class="acoes span2"><button class="btn">Confirmar</button></div>
    </form></div></div>`
}

function cabecalho(eyebrow, titulo, botoes = '') {
  return `<div class="head"><div><div class="eyebrow">${esc(eyebrow)}</div><h2>${esc(titulo)}</h2></div><div class="acoes">${botoes}</div></div>`
}
const opcoes = (lista, sel, vazio) => (vazio != null ? `<option value="">${esc(vazio)}</option>` : '') +
  lista.map(([v, t]) => `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(t)}</option>`).join('')

const TELAS = {
  servidores() {
    const rh = ['rh', 'chefe'].includes(S.perfil.papel), f = S.filtro, busca = f.busca.toLowerCase()   // rh aqui = quem gerencia o cadastro
    const lista = S.d.servidores.filter(s => (!f.setor || s.setor_id === f.setor) &&
      (f.sit === 'todos' || (f.sit === 'ativos') === (s.situacao !== 'desligado')) &&
      (!busca || s.nome.toLowerCase().includes(busca) || s.matricula.includes(busca)))
    const titulo = S.perfil.papel === 'chefe' ? setorNome(S.perfil.setor_id) : 'Servidores'
    const botoes = rh ? `<button class="btn" data-a="novo">+ Novo servidor</button>
      <button class="btn gold" data-a="crachas" ${S.sel.size ? '' : 'disabled'}>Imprimir crachás (${S.sel.size})</button>` : ''
    return cabecalho(S.perfil.papel === 'rh' ? 'Recursos Humanos' : rh ? 'Secretaria da unidade' : 'Somente leitura', titulo, botoes) + (S.edit ? formServidor() : '') +
      `<div class="card"><div class="filtros">
        <input type="search" placeholder="Buscar por nome ou matrícula" data-filtro="busca" value="${esc(f.busca)}">
        ${S.perfil.papel === 'chefe' ? '' : `<select data-filtro="setor">${opcoes(S.d.setores.map(s => [s.id, s.nome]), f.setor, 'Todos os setores')}</select>`}
        <select data-filtro="sit">${opcoes([['ativos', 'Em atividade'], ['desligados', 'Desligados'], ['todos', 'Todos']], f.sit)}</select>
      </div><div class="tabela"><table><thead><tr>
        ${rh ? `<th><input type="checkbox" data-a="todos" aria-label="Selecionar todos" ${lista.length && lista.every(s => S.sel.has(s.id)) ? 'checked' : ''}></th>` : ''}
        <th>Matrícula</th><th>Nome</th><th>Setor</th><th>Cargo</th><th>Horário</th><th>Situação</th>${rh ? '<th></th>' : ''}</tr></thead><tbody>
        ${lista.map(s => `<tr class="${s.situacao === 'desligado' ? 'off' : ''}">
          ${rh ? `<td><input type="checkbox" data-a="sel" data-id="${s.id}" aria-label="Selecionar ${esc(s.nome)}" ${S.sel.has(s.id) ? 'checked' : ''}></td>` : ''}
          <td>${esc(s.matricula)}</td><td>${esc(s.nome)}${outrosVinculos(s).length ? ` <span class="pill blue" title="Mesmo CPF: um crachá serve para os vínculos">${outrosVinculos(s).length + 1} vínculos</span>` : ''}</td><td>${esc(setorNome(s.setor_id))}</td><td>${esc(s.cargo)}</td><td>${esc(jornada(s))}</td>
          <td><span class="pill ${SITUACAO[s.situacao][1]}">${SITUACAO[s.situacao][0]}${s.desligado_em ? ' ' + dataBR(s.desligado_em) : ''}</span></td>
          ${rh ? `<td><button class="btn ghost sm" data-a="editar" data-id="${s.id}">Editar</button></td>` : ''}</tr>`).join('')}
      </tbody></table>${lista.length ? '' : '<div class="vazio">Nenhum servidor encontrado.</div>'}</div>
      <p class="sub">${lista.length} servidor(es).${rh ? ' Desligou o servidor → o crachá dele para de funcionar em todos os totens na hora.' : ''}</p></div>`
  },

  // Painel "Hoje": quem devia vir, quem chegou, quem falta, o totem e as pendências. Mesmas regras do espelho.
  painel() {
    const hj = hoje(), agora = Math.round(Date.now() / 6e4), d0 = inicioDia(hj), papel = S.perfil.papel, cad = {...S.d, justificativas: S.just}
    // cada pessoa: o período que importa agora (o atrasado, o que está por vir, ou o que já faltou)
    const linhas = S.d.servidores.filter(s => s.situacao === 'ativo').map(s => {
      const e = espelhoMes(s, S.bat, hj.slice(0, 7), cad, hj, agora), d = e.dias.find(x => x.dia === hj)
      const abono = d?.oc.find(o => o[1] === 'green')?.[0], pers = abono ? [] : d?.periodos || []
      const sem = pers.filter(p => !p.pares.length), faltou = sem.filter(p => agora > p.sai), porVir = sem.filter(p => agora <= p.sai)
      const atrasoNa = porVir.find(p => agora > p.ent + p.t.tolerancia_min)
      const veio = pers.some(p => p.pares.length), chegouAtrasado = d?.oc.some(o => o[0].startsWith('Atraso'))
      const foco = atrasoNa || faltou[0] || porVir[0], varios = pers.length > 1
      return {s, tot: e.tot, abono, previsto: pers.length > 0, foco, varios,
        chegou: pers.length > 0 && !atrasoNa && !faltou.length && (veio || !porVir.length),   // todos os períodos que já começaram têm batida
        faltou: !atrasoNa && faltou.length > 0, atrasado: !!atrasoNa || (!!chegouAtrasado && !faltou.length)}
    })
    const prev = linhas.filter(l => l.previsto), chegaram = prev.filter(l => l.chegou), faltam = prev.filter(l => !l.chegou).sort((a, b) => a.foco.ent - b.foco.ent)
    const atrasados = prev.filter(l => l.atrasado), abonados = linhas.filter(l => l.abono), fora = S.d.servidores.filter(s => ['ferias', 'afastado'].includes(s.situacao))
    const nome = Object.fromEntries(S.d.servidores.map(s => [s.id, s]))
    const hojeBat = S.bat.filter(b => diaLocal(b.em) === hj).sort((a, b) => minAbs(b.em) - minAbs(a.em))
    const ultTotem = S.bat.filter(b => b.origem === 'totem').reduce((m, b) => Math.max(m, minAbs(b.em)), 0)
    const minLocal = agora - d0, horario = minLocal >= 7 * 60 && minLocal <= 18 * 60
    const semTotem = prev.length && horario && (!ultTotem || agora - ultTotem > 180)
    const pend = S.pedidos.filter(j => j.status === 'pendente').length, semSaida = linhas.reduce((t, l) => t + l.tot.pendencias, 0)
    const faltasMes = linhas.reduce((t, l) => t + l.tot.faltas, 0), dia = +hj.slice(8)
    const mesPassado = new Date(Date.UTC(+hj.slice(0, 4), +hj.slice(5, 7) - 2, 15)).toLocaleDateString('pt-BR', {month: 'long', timeZone: 'UTC'})
    const stat = (n, t, cls = '') => `<div class="card stat ${cls}"><b>${n}</b><span>${t}</span></div>`
    const ha = m => m < 60 ? `há ${m} min` : m < 1440 ? `há ${Math.floor(m / 60)} h ${m % 60} min` : `há ${Math.floor(m / 1440)} dia${m >= 2880 ? 's' : ''}`
    const quando = m => { const d = diaLocal(new Date(m * 6e4).toISOString()); return (d === hj ? 'hoje' : dataBR(d)) + ' às ' + hhmm(m) }
    const unidade = papel === 'chefe' ? setorNome(S.perfil.setor_id) : 'Todas as unidades'
    const porSetor = papel === 'chefe' ? '' : (() => {
      const g = S.d.setores.map(st => { const ls = prev.filter(l => l.s.setor_id === st.id)
        return {st, prev: ls.length, ok: ls.filter(l => l.chegou).length, falta: ls.filter(l => !l.chegou).length, atraso: ls.filter(l => l.atrasado).length,
          pedidos: S.pedidos.filter(j => j.status === 'pendente' && nome[j.servidor_id]?.setor_id === st.id).length} })
        .filter(x => x.prev || x.pedidos).sort((a, b) => b.falta - a.falta)
      const n = (v, c) => v ? `<span class="pill ${c}">${v}</span>` : '0'
      return `<div class="card" style="margin-top:14px"><h3>Por unidade <small>${g.length}</small></h3><div class="tabela"><table><thead><tr><th>Unidade</th><th>Previstos</th><th>Chegaram</th><th>Não chegaram</th><th>Atrasados</th><th>Pedidos</th></tr></thead><tbody>
        ${g.map(x => `<tr><td>${esc(x.st.nome)}</td><td>${x.prev}</td><td>${x.ok}</td><td>${n(x.falta, 'red')}</td><td>${n(x.atraso, 'amber')}</td><td>${n(x.pedidos, 'blue')}</td></tr>`).join('')}
        </tbody></table>${g.length ? '' : '<div class="vazio">Ninguém previsto hoje.</div>'}</div></div>`
    })()
    const titulo = 'Hoje, ' + new Date(Date.parse(hj + 'T12:00:00Z')).toLocaleDateString('pt-BR', {weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC'})
    return cabecalho(unidade, titulo, `<span class="sub">Atualiza sozinho a cada minuto · ${hhmm(agora)}</span>`) +
      (semTotem ? `<div class="msg erro">O totem ${ultTotem ? `não envia batida ${ha(agora - ultTotem)}` : 'ainda não enviou nenhuma batida'}. Confira se o tablet está ligado, com bateria e internet.</div>` : '') +
      `<div class="grid g4">${stat(prev.length, 'previstos hoje')}${stat(chegaram.length, 'já chegaram', 'ok')}
        ${stat(atrasados.length, 'atrasados', atrasados.length ? 'warn' : 'ok')}${stat(faltam.length, faltam.some(l => !l.faltou) ? 'ainda não chegaram' : 'não vieram hoje', faltam.length ? 'bad' : 'ok')}</div>
      <div class="grid g2" style="margin-top:14px">
        <div class="card"><h3>Ainda não chegou <small>${faltam.length}</small></h3>
          ${faltam.map(l => `<div class="row"><div><b>${esc(l.s.nome)}</b><div class="sub">${papel === 'chefe' ? '' : esc(setorNome(l.s.setor_id)) + ' · '}${esc(jornada(l.s))} · ${l.faltou ? 'era às' : 'entra'} ${hhmm(l.foco.ent)}${l.varios ? ` (${esc(l.foco.nome)})` : ''}</div></div>
            ${l.faltou ? `<span class="pill red">${l.varios ? 'faltou no ' + esc(l.foco.nome) : 'faltou hoje'}</span>` : l.atrasado ? `<span class="pill amber">atrasado${l.varios ? ' no ' + esc(l.foco.nome) : ''}</span>` : '<span class="pill">ainda no horário</span>'}</div>`).join('') || '<div class="vazio">Todo mundo que devia vir já chegou.</div>'}
          ${abonados.length || fora.length ? `<p class="sub" style="margin-top:10px">Não contam hoje: ${[...abonados.map(l => `${esc(l.s.nome)} (${esc(l.abono)})`), ...fora.map(s => `${esc(s.nome)} (${SITUACAO[s.situacao][0].toLowerCase()})`)].join(', ')}.</p>` : ''}</div>
        <div class="card"><h3>Últimas batidas de hoje <small>${hojeBat.length}</small></h3>
          ${hojeBat.slice(0, 8).map(b => `<div class="row"><div><b>${hhmm(minAbs(b.em))}</b> ${esc(nome[b.servidor_id]?.nome || '')}${b.origem === 'ajuste' ? ' <span class="sub">✎</span>' : ''}${b.origem === 'totem' && papel === 'rh' ? ` <button class="btn ghost sm" data-a="foto" data-id="${b.id}" title="Foto tirada no totem">📷</button>` : ''}</div>
            <span class="pill ${b.tipo === 'entrada' ? 'green' : 'blue'}">${b.tipo === 'entrada' ? 'entrada' : 'saída'}</span></div>`).join('') || '<div class="vazio">Nenhuma batida hoje ainda.</div>'}
          <p class="sub" style="margin-top:10px">${ultTotem ? `Última batida pelo totem: ${quando(ultTotem)} (${ha(agora - ultTotem)}).` : 'O totem ainda não enviou batidas neste mês.'}</p></div></div>
      <div class="card" style="margin-top:14px"><h3>Pendências do mês</h3>
        <div class="row"><div><b>Pedidos de justificativa esperando resposta</b></div>${papel === 'prefeito' ? `<b>${pend}</b>` : `<a class="btn ${pend ? '' : 'ghost'} sm" href="#pedidos">${pend} · ver</a>`}</div>
        <div class="row"><div><b>Batidas sem saída</b><div class="sub">alguém esqueceu de bater a saída</div></div><a class="btn ${semSaida ? '' : 'ghost'} sm" href="#espelho">${semSaida} · ver</a></div>
        <div class="row"><div><b>Faltas no mês</b><div class="sub">sem justificativa aprovada</div></div><a class="btn ${faltasMes ? '' : 'ghost'} sm" href="#espelho">${faltasMes} · ver</a></div>
        ${dia <= 5 && papel !== 'prefeito' ? `<div class="msg info" style="margin:10px 0 0">Até o dia 5: confira a frequência de <b>${mesPassado}</b> (justificativas e batidas sem saída) e envie ao RH.</div>` : ''}
      </div>${porSetor}`
  },

  espelho() {
    const s = S.esp && S.d.servidores.find(x => x.id === S.esp)
    if (s) return telaEspelho(s, true)
    if (S.semed) return telaSemed()
    const f = S.filtro, mes = mesAtual(), lista = S.d.servidores.filter(x => x.situacao !== 'desligado' && (!f.setor || x.setor_id === f.setor))
    const linhas = lista.map(x => ({s: x, ...espelhoMes(x, S.bat, mes, {...S.d, justificativas: S.just}, hoje())}))
      .sort((a, b) => b.tot.faltas + b.tot.pendencias - (a.tot.faltas + a.tot.pendencias) || a.s.nome.localeCompare(b.s.nome))
    const n = (v, cor) => v ? `<span class="pill ${cor}">${v}</span>` : '<span class="sub">0</span>'
    return cabecalho(S.perfil.papel === 'chefe' ? setorNome(S.perfil.setor_id) : 'Frequência', 'Frequência do mês') + `<div class="card"><div class="filtros">
        <input type="month" data-mes value="${mes}" aria-label="Mês">
        ${S.perfil.papel === 'chefe' ? '' : `<select data-filtro="setor">${opcoes(S.d.setores.map(x => [x.id, x.nome]), f.setor, 'Todos os setores')}</select>`}
        <button class="btn ghost" data-a="ver-semed" title="Uma folha por categoria (01 Pedagogo … 12 PACCET), no modelo da SEMED">Folha SEMED</button>
      </div>${envioMes(mes)}<div class="tabela"><table><thead><tr><th>Servidor</th><th>Setor</th><th>Previsto</th><th>Trabalhado</th><th>Saldo</th><th>Faltas</th><th>Atrasos</th><th>Pendências</th><th></th></tr></thead><tbody>
      ${linhas.map(({s, tot, turno}) => `<tr><td>${esc(s.nome)}<div class="sub">mat. ${esc(s.matricula)}${turno ? '' : ' · sem horário definido'}</div></td><td>${esc(setorNome(s.setor_id))}</td>
        <td>${duracao(tot.previsto)}</td><td>${duracao(tot.trabalhado)}</td><td><b style="color:var(${tot.saldo < 0 ? '--red' : '--goldink'})">${duracao(tot.saldo)}</b></td>
        <td>${n(tot.faltas, 'red')}</td><td>${n(tot.atrasos, 'amber')}</td><td>${n(tot.pendencias, 'red')}</td>
        <td><button class="btn ghost sm" data-a="ver-espelho" data-id="${s.id}">Folha de ponto</button></td></tr>`).join('')}
      </tbody></table>${linhas.length ? '' : '<div class="vazio">Nenhum servidor em atividade.</div>'}</div>
      <p class="sub">Conta até ontem; hoje ainda está em andamento. Quem tem falta ou pendência aparece primeiro.</p></div>`
  },

  pedidos() {
    const pend = S.pedidos.filter(j => j.status === 'pendente'), dec = S.pedidos.filter(j => j.status !== 'pendente').slice(0, 30)
    return cabecalho(S.perfil.papel === 'chefe' ? setorNome(S.perfil.setor_id) : 'Recursos Humanos', 'Pedidos de justificativa') +
      `<div class="card"><h3>Esperando resposta <small>${pend.length}</small></h3>${listaPedidos(pend, true) || '<div class="vazio">Nenhum pedido esperando resposta.</div>'}
        <p class="sub">Aprovou "esqueci de bater" → vira batida na folha de ponto, marcada com ✎. Aprovou um abono → os dias do período deixam de contar falta e atraso.
        Para lançar férias ou licença, abra a folha de ponto do servidor em Frequência.</p></div>
      <div class="card" style="margin-top:14px"><h3>Respondidos recentemente</h3>${listaPedidos(dec, true) || '<div class="vazio">Nada ainda.</div>'}</div>`
  },

  ponto() {
    const vs = S.d.servidores, s = vs.find(x => x.id === S.esp) || vs[0]
    if (!s) return '<div class="card vazio">Cadastro não encontrado. Procure o RH.</div>'
    const escolha = vs.length < 2 ? '' : `<div class="card" style="margin-bottom:14px"><b>Você tem ${vs.length} vínculos.</b> O mesmo crachá serve para todos; o totem sabe qual é pelo horário.
      <div class="et-chips">${vs.map(v => `<button class="et-chip" data-a="ver-espelho" data-id="${v.id}" aria-checked="${v.id === s.id}">${esc(jornada(v))} · mat. ${esc(v.matricula)}${v.vinculo ? ' · ' + esc(v.vinculo) : ''}</button>`).join('')}</div></div>`
    return escolha + telaEspelho(s, false)
  },

  meu() {
    const s = S.d.servidores[0]
    if (!s) return '<div class="card vazio">Cadastro não encontrado. Procure o RH.</div>'
    const linha = (k, v) => `<div class="row"><span class="sub">${k}</span><b>${esc(v)}</b></div>`
    return cabecalho('Meu cadastro', s.nome) + `<div class="card">${linha('Matrícula', s.matricula)}${linha('Cargo', s.cargo)}
      ${linha('Setor', setorNome(s.setor_id))}${linha('Horário', jornada(s))}${linha('Situação', SITUACAO[s.situacao][0])}
      <p class="sub">Suas batidas e o saldo do mês estão em <a href="#ponto">Meu ponto</a>.</p></div>`
  },

  totem() {
    return cabecalho('Totem', setorNome(S.perfil.setor_id)) +
      '<div class="card">Este acesso é de totem. A tela de leitura do crachá pela câmera chega na próxima etapa.</div>'
  },

  setores() {
    const qtd = id => S.d.servidores.filter(s => s.setor_id === id && s.situacao !== 'desligado').length
    const temChefe = id => S.d.perfis.some(p => p.papel === 'chefe' && p.setor_id === id && p.ativo)
    return cabecalho('Recursos Humanos', 'Setores') +
      (S.convite ? `<div class="msg ok">Acesso da secretaria de <b>${esc(setorNome(S.convite.setor_id))}</b>: <code class="cod">${esc(S.convite.codigo)}</code>
         <div class="sub">Entregue este código à secretaria. Ela abre o SIGEP, toca em <b>Criar conta</b> (e-mail e senha) e digita o código. Vale 7 dias, uma vez só.
         Depois ela mesma cadastra os servidores da unidade.</div></div>` : '') +
      `<div class="grid g2"><div class="card"><h3>Setores <small>${S.d.setores.length}</small></h3>
      ${S.d.setores.map(s => `<div class="row">${S.edit === s.id
        ? `<form class="acoes" data-f="setor" data-id="${s.id}" style="flex:1"><input name="nome" value="${esc(s.nome)}" required><button class="btn sm">Salvar</button><button type="button" class="btn ghost sm" data-a="cancelar">Cancelar</button></form>`
        : `<div><b>${esc(s.nome)}</b><div class="sub">${qtd(s.id)} servidor(es) em atividade</div></div>
           <div class="acoes">${temChefe(s.id) ? '<span class="pill green">secretaria com acesso</span>' : `<button class="btn sm" data-a="acesso-setor" data-id="${s.id}">Gerar acesso da secretaria</button>`}
             <button class="btn ghost sm" data-a="editar" data-id="${s.id}">Renomear</button><button class="btn ghost sm" data-a="excluir-setor" data-id="${s.id}">Excluir</button></div>`}</div>`).join('')
      || '<div class="vazio">Nenhum setor ainda.</div>'}</div>
      <div class="card"><h3>Novo setor</h3><form class="f" data-f="setor"><label class="span2">Nome<input name="nome" required placeholder="Ex.: Secretaria de Obras"></label>
      <div class="acoes"><button class="btn">Adicionar</button></div></form></div></div>`
  },

  horarios() {
    const t = S.edit && S.d.turnos.find(x => x.id === S.edit) || {}
    const dias = t.dias_semana || [1, 2, 3, 4, 5]
    return cabecalho('Recursos Humanos', 'Horários') + `<div class="grid g2">
      <div class="card"><h3>Turnos</h3><div class="tabela"><table><thead><tr><th>Nome</th><th>Horário</th><th>Dias</th><th>Tolerância</th><th></th></tr></thead><tbody>
        ${S.d.turnos.map(x => `<tr><td>${esc(x.nome)}</td><td>${hora(x.entrada)}–${hora(x.saida)}${x.saida_almoco ? `<div class="sub">intervalo ${hora(x.saida_almoco)}–${hora(x.retorno_almoco)}</div>` : ''}
          ${x.saida <= x.entrada ? '<div class="sub">passa da meia-noite</div>' : ''}</td><td>${x.dias_semana.map(d => DIAS[d]).join(' ')}</td><td>${x.tolerancia_min} min</td>
          <td><button class="btn ghost sm" data-a="editar" data-id="${x.id}">Editar</button></td></tr>`).join('')}
      </tbody></table></div>
      <h3 style="margin-top:16px">${t.id ? 'Editar turno' : 'Novo turno'}</h3>
      <form class="f" data-f="turno" data-id="${t.id || ''}">
        <label class="span2">Nome<input name="nome" required value="${esc(t.nome)}" placeholder="Ex.: Matutino"></label>
        <label>Entrada<input name="entrada" type="time" required value="${hora(t.entrada) || ''}" data-opcoes="07:00|13:00|19:00"></label>
        <label>Saída<input name="saida" type="time" required value="${hora(t.saida) || ''}" data-opcoes="11:00|11:30|17:00|19:00|07:00"></label>
        <label>Saída p/ almoço (opcional)<input name="saida_almoco" type="time" value="${hora(t.saida_almoco) || ''}"></label>
        <label>Volta do almoço<input name="retorno_almoco" type="time" value="${hora(t.retorno_almoco) || ''}"></label>
        <label>Tolerância de atraso (min)<input name="tolerancia_min" type="number" min="0" max="120" value="${t.tolerancia_min ?? 10}" data-opcoes="5|10|15"></label>
        <label>Tolerância de saída (min)<input name="tolerancia_saida_min" type="number" min="0" max="120" value="${t.tolerancia_saida_min ?? 10}" data-opcoes="5|10|15"></label>
        <fieldset class="span2 acoes" style="border:0;padding:0;margin:0"><legend class="sub">Dias de trabalho</legend>
          ${DIAS.map((n, i) => `<label style="flex-direction:row;align-items:center"><input type="checkbox" name="dia" value="${i}" style="width:auto" ${dias.includes(i) ? 'checked' : ''}>${n}</label>`).join('')}</fieldset>
        <div class="acoes span2"><button class="btn">${t.id ? 'Salvar' : 'Adicionar turno'}</button>${t.id ? '<button type="button" class="btn ghost" data-a="cancelar">Cancelar</button>' : ''}</div>
        <p class="sub span2">Saída igual ou antes da entrada (ex.: 07:00–07:00) é plantão que passa da meia-noite.${t.id ? ` Mudar as horas de um turno recalcula também os meses passados de quem o usa:
          se o horário mudou de verdade, crie um turno novo e troque no cadastro dos servidores.` : ''}</p>
      </form></div>
      <div class="card"><h3>Escalas</h3>
        ${S.d.escalas.map(e => `<div class="row"><div><b>${esc(e.nome)}</b><div class="sub">${e.dias_trabalho} dia(s) de trabalho, ${e.dias_descanso} de folga · turno ${esc(S.d.turnos.find(t => t.id === e.turno_id)?.nome)}</div></div></div>`).join('') || '<div class="vazio">Nenhuma escala.</div>'}
        <h3 style="margin-top:16px">Nova escala</h3>
        <form class="f" data-f="escala">
          <label class="span2">Nome<input name="nome" required placeholder="Ex.: Vigia 24×72"></label>
          <label class="span2">Turno do dia de trabalho<select name="turno_id" required>${opcoes(S.d.turnos.map(t => [t.id, `${t.nome} (${hora(t.entrada)}–${hora(t.saida)})`]), null, 'Escolha')}</select></label>
          <label>Dias de trabalho<input name="dias_trabalho" type="number" min="1" max="30" required value="1"></label>
          <label>Dias de folga<input name="dias_descanso" type="number" min="0" max="30" required value="3"></label>
          <div class="acoes span2"><button class="btn">Adicionar escala</button></div>
        </form></div>
      <div class="card"><h3>Feriados e pontos facultativos <small>${S.d.feriados.length}</small></h3>
        ${S.d.feriados.map(f => `<div class="row"><div><b>${dataBR(f.data)}</b> ${esc(f.nome)}</div>
          <button class="btn ghost sm" data-a="excluir-feriado" data-id="${f.data}">Excluir</button></div>`).join('') || '<div class="vazio">Nenhum feriado cadastrado.</div>'}
        <form class="f" data-f="feriado" style="margin-top:12px">
          <label>Data<input name="data" type="date" required></label>
          <label>Nome<input name="nome" required placeholder="Ex.: Aniversário da cidade"></label>
          <div class="acoes span2"><button class="btn">Adicionar feriado</button></div>
        </form>
        <p class="sub">No feriado ninguém de turno tem falta. Escala (plantão) segue normal.</p></div></div>`
  },

  acessos() {
    const serv = Object.fromEntries(S.d.servidores.map(s => [s.id, s]))
    const pend = S.d.convites.filter(c => !c.usado_por && new Date(c.expira_em) > new Date())
    // a secretaria da unidade só gera acesso de servidor e de totem da própria unidade (o banco confere)
    const unid = S.perfil.papel === 'chefe', papel = S.edit || (unid ? 'servidor' : 'chefe')
    const papeis = unid ? [['servidor', 'Servidor (ver o próprio ponto)'], ['totem', 'Totem (tablet de bater ponto)']] : Object.entries(PAPEIS)
    const setores = unid ? [[S.perfil.setor_id, setorNome(S.perfil.setor_id)]] : S.d.setores.map(s => [s.id, s.nome])
    return cabecalho(unid ? setorNome(S.perfil.setor_id) : 'Recursos Humanos', 'Acessos') +
      (S.convite ? `<div class="msg ok">Código para <b>${esc(S.convite.nome)}</b>: <code class="cod">${esc(S.convite.codigo)}</code>
         <div class="sub">Vale por 7 dias e uma vez só. A pessoa cria a conta com e-mail e senha e digita este código.</div></div>` : '') +
      `<div class="grid g2"><div class="card"><h3>Gerar código de convite</h3>
        <form class="f" data-f="convite-novo">
          <label class="span2">Perfil<select name="papel" required data-papel>${opcoes(papeis, papel)}</select></label>
          ${papel === 'servidor'
            ? `<label class="span2">Servidor<select name="servidor_id" required>${opcoes(S.d.servidores.filter(s => s.situacao !== 'desligado' && !S.d.perfis.some(p => p.servidor_id === s.id)).map(s => [s.id, `${s.nome} (${s.matricula})`]), null, 'Escolha')}</select></label>`
            : `<label class="span2">Nome<input name="nome" required placeholder="${papel === 'totem' ? 'Ex.: Totem 1 – Escola' : 'Nome da pessoa'}"></label>`}
          ${['chefe', 'totem'].includes(papel) ? `<label class="span2">Setor<select name="setor_id" required>${opcoes(setores, unid ? S.perfil.setor_id : null, 'Escolha')}</select></label>` : ''}
          <div class="acoes span2"><button class="btn">Gerar código</button></div>
        </form>
        ${pend.length ? `<h3 style="margin-top:16px">Códigos ainda não usados</h3>${pend.map(c => `<div class="row"><div><b>${esc(c.nome)}</b><div class="sub">${PAPEIS[c.papel]}${c.setor_id ? ' · ' + esc(setorNome(c.setor_id)) : ''} · vence ${new Date(c.expira_em).toLocaleDateString('pt-BR')}</div></div>
          <div class="acoes"><code class="cod">${esc(c.codigo)}</code><button class="btn ghost sm" data-a="cancelar-convite" data-id="${esc(c.codigo)}">Cancelar</button></div></div>`).join('')}` : ''}
      </div>
      ${unid ? '<div class="card"><h3>Como funciona</h3><p>Gere o código, entregue à pessoa e peça para ela abrir o SIGEP, tocar em <b>Criar conta</b> e digitar o código.</p><p class="sub">Para cortar o acesso de alguém ou de um totem perdido, fale com o RH.</p></div></div>' : `<div class="card"><h3>Quem tem acesso <small>${S.d.perfis.length}</small></h3>
        ${S.d.perfis.map(p => `<div class="row ${p.ativo ? '' : 'off'}"><div><b>${esc(p.nome)}</b><div class="sub">${PAPEIS[p.papel]}${p.setor_id ? ' · ' + esc(setorNome(p.setor_id)) : ''}${p.servidor_id ? ' · mat. ' + esc(serv[p.servidor_id]?.matricula) : ''}${p.ativo ? '' : ' · desativado'}</div></div>
          ${p.id === S.perfil.id ? '<span class="pill">você</span>' : `<button class="btn ghost sm" data-a="ativar" data-id="${p.id}" data-v="${!p.ativo}">${p.ativo ? 'Desativar' : 'Reativar'}</button>`}</div>`).join('')}
        <p class="sub">Desativar corta o acesso na hora (inclusive de um totem perdido ou roubado).</p></div></div>`}`
  },

  importar() {
    const i = S.imp
    return cabecalho('Recursos Humanos', 'Importar planilha') + `<div class="card">
      <p>Planilha do Excel (.xlsx) ou CSV, com uma linha de títulos. Colunas reconhecidas:
        <b>matricula</b>, <b>nome</b>, <b>setor</b> (obrigatórias), cargo, turno, vinculo (efetivo, contratado ou comissionado), cpf, telefone, admissao.</p>
      <p class="sub">Setor que ainda não existe é criado. O turno é pelo nome, igual ao cadastrado em Horários. Matrícula já cadastrada é ignorada.</p>
      <label>Arquivo<input type="file" accept=".xlsx,.xls,.csv" data-a="arquivo"></label></div>
      ${i ? `<div class="card" style="margin-top:14px"><h3>${i.ok.length} para importar <small>${i.erros.length} com problema · ${i.repetidas} já cadastrada(s)</small></h3>
        ${i.erros.length ? `<div class="msg erro">${i.erros.map(e => esc(e)).join('<br>')}</div>` : ''}
        <div class="tabela"><table><thead><tr><th>Matrícula</th><th>Nome</th><th>Setor</th><th>Cargo</th><th>Turno</th><th>Vínculo</th></tr></thead><tbody>
          ${i.ok.slice(0, 200).map(r => `<tr><td>${esc(r.matricula)}</td><td>${esc(r.nome)}</td><td>${esc(r.setor)}${S.d.setores.some(s => s.nome === r.setor) ? '' : ' <span class="pill blue">novo</span>'}</td>
            <td>${esc(r.cargo)}</td><td>${esc(r.turno)}</td><td>${esc(r.vinculo)}</td></tr>`).join('')}</tbody></table></div>
        <div class="acoes" style="margin-top:12px"><button class="btn" data-a="importar" ${i.ok.length ? '' : 'disabled'}>Importar ${i.ok.length} servidor(es)</button></div></div>` : ''}`
  },
}

// espelho de um servidor (tela e impressão usam o mesmo HTML)
function htmlEspelho(s) {
  const mes = mesAtual(), {dias, tot, turno} = espelhoMes(s, S.bat, mes, {...S.d, justificativas: S.just}, hoje())
  const [a, m] = mes.split('-'), nomeMes = new Date(Date.UTC(+a, +m - 1, 15)).toLocaleDateString('pt-BR', {month: 'long', year: 'numeric', timeZone: 'UTC'})
  const par = (p, dia) => `${p.ent ? hhmm(p.ent) : '?'}–${p.sai ? hhmm(p.sai) + (diaLocal(new Date(p.sai * 6e4).toISOString()) > dia ? ' <span class="sub">(+1)</span>' : '') : '…'}` +
    (p.aj ? ' <span class="sub" title="Batida de ajuste (lançada pelo RH ou pedido aprovado)">✎</span>' : '')
  return `<div class="espelho"><div class="esp-topo"><div><b>${esc(s.nome)}</b> · matrícula ${esc(s.matricula)}<div class="sub">${esc(s.cargo)}${s.cargo ? ' · ' : ''}${esc(setorNome(s.setor_id))} · ${esc(jornada(s) || 'sem horário definido')}${turno ? ` (${hora(turno.entrada)}–${hora(turno.saida)})` : ''}</div></div>
      <div class="sub" style="text-align:right">${esc(NOME_INSTITUICAO)}<br>Folha de ponto · ${nomeMes}</div></div>
    <div class="grid g4" style="margin:12px 0">
      <div class="stat"><b>${duracao(tot.previsto)}</b><span>previsto até ontem</span></div><div class="stat"><b>${duracao(tot.trabalhado)}</b><span>trabalhado</span></div>
      <div class="stat ${tot.saldo < 0 ? 'bad' : 'ok'}"><b>${duracao(tot.saldo)}</b><span>saldo</span></div>
      <div class="stat ${tot.faltas || tot.pendencias ? 'bad' : 'ok'}"><b>${tot.faltas} / ${tot.atrasos} / ${tot.pendencias}</b><span>faltas / atrasos / pendências</span></div></div>
    <div class="tabela"><table><thead><tr><th>Dia</th><th>Batidas</th><th>Previsto</th><th>Trabalhado</th><th>Ocorrências</th></tr></thead><tbody>
    ${dias.map(d => `<tr class="${d.prev || d.pares.length ? '' : 'off'}"><td>${dataBR(d.dia).slice(0, 5)} <span class="sub">${DIAS[new Date(d.dia + 'T12:00:00Z').getUTCDay()]}</span></td>
      <td>${d.pares.map(p => par(p, d.dia)).join('<br>') || (d.feriado ? `<span class="sub">Feriado: ${esc(d.feriado)}</span>` : d.prev ? '' : '<span class="sub">folga</span>')}</td>
      <td>${d.esperado ? duracao(d.esperado) : ''}</td><td>${d.trab ? duracao(d.trab) : ''}</td>
      <td>${d.oc.map(([t, c]) => `<span class="pill ${c}">${esc(t)}</span>`).join(' ')}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="assinaturas"><div>Servidor(a)</div><div>Chefia imediata</div></div></div>`
}
function telaEspelho(s, voltar) {
  const papel = S.perfil.papel, decide = ['rh', 'chefe'].includes(papel), meus = S.pedidos.filter(j => j.servidor_id === s.id)
  return cabecalho('Folha de ponto', s.nome, `${voltar ? '<button class="btn ghost" data-a="voltar-espelho">← Frequência</button>' : ''}
      <input type="month" data-mes value="${mesAtual()}" aria-label="Mês" style="width:auto"><button class="btn" data-a="imprimir-espelho" data-id="${s.id}">Imprimir</button>`) +
    (papel === 'prefeito' ? '' : `<div class="grid g2" style="margin-bottom:14px">${formJustificativa(s)}
      <div class="card"><h3>${decide ? 'Justificativas' : 'Meus pedidos'} <small>${meus.length}</small></h3>${listaPedidos(meus, decide) || '<div class="vazio">Nenhum pedido ainda.</div>'}</div></div>`) +
    `<div class="card">${htmlEspelho(s)}</div>`
}

/* ============================== justificativas ============================== */
function formJustificativa(s) {
  const t = S.jtipo, lanca = S.perfil.papel !== 'servidor'
  return `<div class="card"><h3>${lanca ? 'Lançar justificativa' : 'Pedir justificativa'}</h3>
    <form class="f" data-f="justificativa" data-id="${s.id}">
      <label class="span2">O que aconteceu<select name="tipo" data-jtipo>${opcoes(Object.entries(TIPOS_J), t)}</select></label>
      ${t === 'batida'
        ? `<label>Dia<input name="dia" type="date" required max="${hoje()}" data-opcoes="hoje|ontem"></label><label>Hora em que chegou ou saiu<input name="hora" type="time" required data-opcoes="07:00|11:00|13:00|17:00"></label>
           <label>Era a<select name="batida_tipo">${opcoes([['entrada', 'Entrada'], ['saida', 'Saída']], 'entrada')}</select></label>`
        : `<label>De<input name="inicio" type="date" required data-opcoes="hoje|ontem"></label><label>Até<input name="fim" type="date" required data-opcoes="hoje|ontem"></label>`}
      <label class="span2">Explique<textarea name="motivo" required minlength="5" maxlength="500" rows="2" placeholder="${t === 'batida' ? 'Ex.: o totem estava sem bateria' : 'Ex.: consulta no posto de saúde'}" data-opcoes="${t === 'batida' ? 'Esqueci de bater o ponto|Esqueci o crachá|Totem sem internet' : 'Consulta médica|Reunião na Secretaria|Curso de formação'}"></textarea></label>
      ${t === 'atestado' ? '<p class="sub span2">Entregue o atestado em papel ao RH.</p>' : ''}
      <div class="acoes span2"><button class="btn">${lanca ? 'Lançar (já aprovado)' : 'Enviar pedido'}</button></div>
    </form>${lanca ? '' : '<p class="sub">Sua chefia ou o RH responde. A resposta aparece aqui.</p>'}</div>`
}
const ST_J = {pendente: ['Em análise', 'blue'], aprovada: ['Aprovado', 'green'], recusada: ['Recusado', 'red']}
const periodoJ = j => j.tipo === 'batida' ? `${dataBR(diaLocal(j.batida_em))} às ${hhmm(minAbs(j.batida_em))} (${j.batida_tipo === 'entrada' ? 'entrada' : 'saída'})`
  : j.inicio === j.fim ? dataBR(j.inicio) : `${dataBR(j.inicio)} a ${dataBR(j.fim)}`
function listaPedidos(lista, decide) {
  return lista.map(j => `<div class="row"><div><b>${esc(TIPOS_J[j.tipo])}</b> · ${periodoJ(j)}${decide ? ` · ${esc(S.d.servidores.find(x => x.id === j.servidor_id)?.nome || '')}` : ''}
      <div class="sub">${esc(j.motivo)}${j.resposta ? ` · <b>Resposta:</b> ${esc(j.resposta)}` : ''}</div></div>
    <div class="acoes"><span class="pill ${ST_J[j.status][1]}">${ST_J[j.status][0]}</span>
      ${decide && j.status === 'pendente' ? `<form class="acoes" data-f="decidir" data-id="${j.id}"><input name="resposta" placeholder="Resposta (opcional)" maxlength="300" style="width:170px">
        <button class="btn sm" name="aprovar" value="1">Aprovar</button><button class="btn red sm" name="aprovar" value="0">Recusar</button></form>` : ''}
      ${!decide && j.status === 'pendente' && j.pedido_por === S.perfil.id ? `<button class="btn ghost sm" data-a="desistir" data-id="${j.id}">Desistir</button>` : ''}</div></div>`).join('')
}

function formServidor() {
  const novo = S.edit === 'novo', s = novo ? {situacao: 'ativo'} : S.d.servidores.find(x => x.id === S.edit)
  const jor = s.escala_id ? 'e:' + s.escala_id : s.turno_id ? 't:' + s.turno_id : ''
  const jornadas = [...S.d.turnos.map(t => ['t:' + t.id, `Turno: ${t.nome} (${hora(t.entrada)}–${hora(t.saida)})`]), ...S.d.escalas.map(e => ['e:' + e.id, 'Escala: ' + e.nome])]
  return `<div class="card" style="margin-bottom:14px"><h3>${novo ? 'Novo servidor' : esc(s.nome)}${novo ? '' : ` <span class="pill ${SITUACAO[s.situacao][1]}">${SITUACAO[s.situacao][0]}</span>`}</h3>
    <form class="f" data-f="servidor">
      <label>Matrícula<input name="matricula" required maxlength="20" value="${esc(s.matricula)}"></label>
      <label class="span2">Nome completo<input name="nome" required minlength="3" value="${esc(s.nome)}"></label>
      <label>Cargo<input name="cargo" value="${esc(s.cargo)}" data-opcoes="Professor(a)|Merendeira|Vigia|Aux. serviços gerais|Secretário(a) escolar"></label>
      <label>Setor<select name="setor_id" required>${S.perfil.papel === 'chefe' ? opcoes([[S.perfil.setor_id, setorNome(S.perfil.setor_id)]], S.perfil.setor_id)
        : opcoes(S.d.setores.map(x => [x.id, x.nome]), s.setor_id, 'Escolha')}</select></label>
      <label class="span2">Horário (turno principal ou escala)<select name="jornada">${opcoes(jornadas, jor, 'Sem horário definido')}</select></label>
      ${S.d.turnos.length > 1 ? `<fieldset class="span2" style="border:0;padding:0;margin:0"><legend style="font-weight:700">Também trabalha no turno <span class="sub">(mesmo contrato · ex.: de manhã e à noite)</span></legend>
        <div class="et-chips">${S.d.turnos.map(t => `<label style="flex-direction:row;align-items:center;gap:6px;font-weight:600"><input type="checkbox" name="turno_extra" value="${t.id}" style="width:auto" ${(s.turnos_extra || []).includes(t.id) ? 'checked' : ''}>${esc(t.nome)} ${hora(t.entrada)}–${hora(t.saida)}</label>`).join('')}</div>
        <p class="sub">Outro contrato (ex.: efetivo + contratado) é outro cadastro, com outra matrícula e o mesmo CPF.</p></fieldset>` : ''}
      <label>Início da escala <span class="sub">(só para plantão, ex.: vigia 24×72 · turno normal: deixe vazio)</span><input name="escala_inicio" type="date" value="${s.escala_inicio || ''}"></label>
      <label>Vínculo<select name="vinculo">${opcoes([['efetivo', 'Efetivo'], ['contratado', 'Contratado'], ['comissionado', 'Comissionado']], s.vinculo, '—')}</select></label>
      <label>Admissão<input name="admissao" type="date" value="${s.admissao || ''}"></label>
      <label>CPF<input name="cpf" inputmode="numeric" value="${esc(s.cpf)}" placeholder="só números"></label>
      <label>Telefone<input name="telefone" type="tel" value="${esc(s.telefone)}"></label>
      ${s.situacao !== 'desligado' ? `<label>Situação<select name="situacao">${opcoes([['ativo', 'Ativo'], ['ferias', 'Férias'], ['afastado', 'Afastado']], s.situacao)}</select></label>` : ''}
      ${s.jornadas?.length ? `<div class="span2"><b>Horários anteriores</b> <span class="sub">os dias até cada data são calculados com o horário que valia na época</span>
        ${s.jornadas.map(j => `<div class="row"><div>${esc(jornada(j))} <span class="sub">até ${dataBR(j.ate)}</span></div>
          <button type="button" class="btn ghost sm" data-a="apagar-jornada" data-id="${s.id}" data-ate="${j.ate}">Apagar</button></div>`).join('')}
        <p class="sub">Apague só se o horário antigo foi cadastrado errado: os dias até essa data passam a ser calculados com o horário seguinte.</p></div>` : ''}
      <div class="acoes span2"><button class="btn">Salvar</button><button type="button" class="btn ghost" data-a="cancelar">Cancelar</button>
        ${novo ? '' : s.situacao === 'desligado'
          ? `<button type="button" class="btn ghost" data-a="reativar" data-id="${s.id}">Reativar</button>`
          : `<button type="button" class="btn red" data-a="desligar" data-id="${s.id}">Desligar servidor</button>`}</div>
    </form></div>`
}

/* ============================== folha de frequência da SEMED ============================== */
// Uma folha por categoria, com a numeração das planilhas que a escola entrega à SEMED (01 a 12).
// A categoria sai do cargo (e do vínculo, no caso do professor); quem não casar com nenhuma vai para "13 – sem categoria".
// Os textos são os da coluna APLICAÇÃO das planilhas (ex.: "AUX.SERV.GER.", "ASSISTENTE ADM./MANHÃ", "PROFESSOR/VESP.", "PAE").
const CATEGORIAS_SEMED = [
  ['01', 'PEDAGOGO', (c) => /pe[dg]agog/.test(c) && !/apoio/.test(c)],
  ['02', 'AUX. ADMINISTRATIVO', (c) => /administrativ|\badm\b|secretari/.test(c)],
  ['03', 'AUX. SERV. GERAIS', (c) => /serv.*ger|\basg\b|zelador|limpeza/.test(c)],
  ['04', 'GESTORA', (c) => /gest|diretor/.test(c)],
  ['05', 'MERENDEIRO(A)', (c) => /merend|cozinh/.test(c)],
  ['06', 'PROFESSOR EFETIVO', (c, v) => /professor|instrutor/.test(c) && !/paccet/.test(c) && v === 'efetivo'],
  ['07', 'VIGIA', (c) => /vigia|vigilan|porteir/.test(c)],
  ['08', 'APOIO PEDAGÓGICO', (c) => /apoio pedag/.test(c)],
  ['09', 'PROFESSOR CONTRATO', (c) => /professor|instrutor/.test(c) && !/paccet/.test(c)],
  ['10', 'AVE', (c) => /\bpae\b|\bave\b|apoio escolar|vida escolar|cuidador/.test(c)],
  ['11', 'BIBLIOTECÁRIO', (c) => /bibliotec/.test(c)],
  ['12', 'PACCET', (c) => /paccet/.test(c)],
]
const categoriaSemed = s => CATEGORIAS_SEMED.find(([, , f]) => f(semAcento(s.cargo), s.vinculo)) || ['13', 'SEM CATEGORIA (conferir o cargo)']
const SIGLA_J = {'Atestado médico': 'AM', 'Férias': 'F', 'Licença especial / afastamento': 'LE', 'Licença maternidade': 'LM', 'Licença paternidade': 'LP',
  'Licença sem remuneração': 'SR'}
// um dia da folha de ponto → o que vai na célula: 1 presença, 0 falta, sigla do abono; vazio em folga, feriado e dia que ainda não fechou
function valorSemed(s, d) {
  if (!d.fechado || !d.prev) return ''
  if (s.situacao === 'ferias') return 'F'
  if (s.situacao === 'afastado') return 'LE'
  const sigla = d.oc.map(o => SIGLA_J[o[0]]).find(Boolean)
  if (sigla) return sigla
  return d.oc.some(o => o[0] === 'Falta' || o[0].startsWith('Faltou no')) ? 0 : 1
}
const setorSemed = () => S.perfil.papel === 'chefe' ? S.perfil.setor_id : S.filtro.setor
// a mesma folha que vai para a impressora, na tela, para a secretaria conferir antes de imprimir
function telaSemed() {
  const setor = setorSemed(), html = htmlFolhaSemed(setor, mesAtual())
  return cabecalho(setorNome(setor), 'Folha de frequência SEMED', `<button class="btn ghost" data-a="voltar-semed">← Voltar</button>
      <button class="btn gold" data-a="imprimir-semed">Imprimir</button>`) + `<div class="card"><div class="filtros"><input type="month" data-mes value="${mesAtual()}" aria-label="Mês"></div>
    <p class="sub">Uma planilha por categoria, na ordem da SEMED (01 a 12). Confira nomes, situação e as faltas; o que estiver errado se corrige na folha de ponto da pessoa.
    Quem aparecer em "13 – sem categoria" está com o cargo escrito de um jeito que o sistema não reconheceu.</p>
    ${html ? `<div class="semed-tela">${html}</div>` : '<div class="vazio">Nenhum servidor nesta unidade.</div>'}</div>`
}
function htmlFolhaSemed(setorId, mes) {
  const [ini, fim] = limitesMes(mes), dias = []
  for (let d = ini; d <= fim; d = addDia(d, 1)) dias.push(d)
  const [a, m] = mes.split('-'), nomeMes = new Date(Date.UTC(+a, +m - 1, 15)).toLocaleDateString('pt-BR', {month: 'long', timeZone: 'UTC'}).toUpperCase()
  const lista = S.d.servidores.filter(s => s.setor_id === setorId && (!s.desligado_em || s.desligado_em >= ini)).sort((x, y) => x.nome.localeCompare(y.nome))
  const grupos = {}
  for (const s of lista) { const [n, t] = categoriaSemed(s); (grupos[n] ??= {t, ss: []}).ss.push(s) }
  const SIT = {efetivo: 'EFETIVO', contratado: 'CONTRATO', comissionado: 'COMISSIONADO'}, F = FOLHA_SEMED, col = dias.length + 5
  const DS = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB']
  return Object.keys(grupos).sort().map(n => { const {t, ss} = grupos[n]
    const linhas = ss.map((s, i) => { const {dias: ds} = espelhoMes(s, S.bat, mes, {...S.d, justificativas: S.just}, hoje()), v = ds.map(d => valorSemed(s, d))
      return `<tr><td>${i + 1}</td><td class="nm">${esc(s.nome.toUpperCase())}</td><td>${SIT[s.vinculo] || ''}</td><td>${esc((s.cargo || '').toUpperCase())}</td>
        ${v.map(x => `<td class="${x === 0 ? 'falta' : ''}">${x}</td>`).join('')}<td><b>${v.filter(x => x === 0).length}</b></td></tr>` }).join('')
    return `<div class="semed"><table>
      <tr><td colspan="4" rowspan="3" class="brasao"><img src="img/brasao.png" alt=""></td><td colspan="${dias.length - 9}" class="tit">FOLHA DE FREQUÊNCIA SEMED: ${esc(setorNome(setorId).toUpperCase())}</td><td colspan="10" class="tit">MÊS/ANO: ${nomeMes}/${a}</td></tr>
      <tr><td colspan="${dias.length + 1}">ÓRGÃO DE DESTINO: ${esc(F.destino)}</td></tr>
      <tr><td colspan="${dias.length + 1}" class="cat">PLANILHA ${n} – ${esc(t)}</td></tr>
      <tr><td colspan="4"><b>${esc(NOME_INSTITUICAO.toUpperCase())}</b></td><td colspan="${dias.length + 1}">SECRETÁRIO MUNICIPAL DE EDUCAÇÃO: ${esc(F.secretario)}</td></tr>
      <tr><td colspan="4"><b>${esc(F.secretaria)}</b></td><td colspan="${dias.length + 1}"></td></tr>
      <tr><td colspan="4">CNPJ: ${esc(F.cnpj)}</td><td colspan="${dias.length + 1}">PERÍODO: ${dataBR(ini)} A ${dataBR(fim)}</td></tr>
      <tr class="cab"><td colspan="4"></td>${dias.map(d => `<td>${DS[new Date(d + 'T12:00:00Z').getUTCDay()]}</td>`).join('')}<td rowspan="2">TOTAL DE FALTAS</td></tr>
      <tr class="cab"><td>Nº</td><td>NOME DO SERVIDOR</td><td>SITUAÇÃO</td><td>APLICAÇÃO</td>${dias.map(d => `<td>${d.slice(8)}</td>`).join('')}</tr>
      ${linhas}
      <tr><td colspan="${col}" class="leg">0 (ZERO) = FALTA &nbsp; 1 (UM) = PRESENÇA<br>AM = ATESTADO MÉDICO, LM = LICENÇA MATERNIDADE, LP = LICENÇA PATERNIDADE, LE = LICENÇA ESPECIAL, F = FÉRIAS, SR = SEM REMUNERAÇÃO</td></tr>
    </table><div class="ass"><div>Servidor(a) Responsável</div><div>Secretário Municipal</div></div></div>` }).join('')
}

/* ============================== crachás ============================== */
function imprimirCrachas() {
  const vistos = new Set(), lista = S.d.servidores.filter(s => S.sel.has(s.id) && !(s.cpf && vistos.has(s.cpf)) && (vistos.add(s.cpf), true))
  const qr = txt => { const g = qrcode(0, 'M'); g.addData(txt); g.make(); return g.createSvgTag({cellSize: 4, margin: 0, scalable: true}) }
  $('#impressao').innerHTML = `<div class="folha">${lista.map(s => `<div class="cartao"><div class="furo"></div>
    <div class="topo">${esc(NOME_INSTITUICAO)}</div><div class="corpo"><div><div class="nome">${esc(s.nome)}</div>
    <div class="cargo">${esc(s.cargo)}${s.cargo ? ' · ' : ''}${esc(setorNome(s.setor_id))}</div><div class="mat">Matrícula ${[s, ...outrosVinculos(s)].map(v => esc(v.matricula)).join(' · ')}</div></div>
    ${qr(s.codigo)}</div></div>`).join('')}</div>`
  document.body.classList.add('imprimindo')
  print()
  document.body.classList.remove('imprimindo')
}

/* ============================== planilha ============================== */
const semAcento = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()
function dataPlanilha(v) {
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  const m = String(v ?? '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? '').trim()) ? String(v).trim() : null
}
// linhas da planilha -> {ok, erros, repetidas}; não grava nada
function conferirPlanilha(linhas) {
  const existentes = new Set(S.d.servidores.map(s => s.matricula)), vistas = new Set(), turnos = Object.fromEntries(S.d.turnos.map(t => [semAcento(t.nome), t]))
  const ok = [], erros = []; let repetidas = 0
  linhas.forEach((bruta, i) => {
    const r = Object.fromEntries(Object.entries(bruta).map(([k, v]) => [semAcento(k).replace(/[^a-z]/g, ''), typeof v === 'string' ? v.trim() : v]))
    const n = i + 2, matricula = String(r.matricula ?? '').trim(), nome = String(r.nome ?? '').trim(), setor = String(r.setor ?? '').trim()
    if (!matricula && !nome) return
    if (!matricula || !nome || !setor) return erros.push(`Linha ${n}: falta matrícula, nome ou setor.`)
    if (existentes.has(matricula)) return repetidas++
    if (vistas.has(matricula)) return erros.push(`Linha ${n}: matrícula ${matricula} repetida na planilha.`)
    const vinculo = semAcento(r.vinculo) || null, cpf = String(r.cpf ?? '').replace(/\D/g, '') || null, turno = String(r.turno ?? '').trim()
    if (vinculo && !['efetivo', 'contratado', 'comissionado'].includes(vinculo)) return erros.push(`Linha ${n}: vínculo "${r.vinculo}" não reconhecido.`)
    if (cpf && cpf.length !== 11) return erros.push(`Linha ${n}: CPF precisa ter 11 números.`)
    if (turno && !turnos[semAcento(turno)]) return erros.push(`Linha ${n}: turno "${turno}" não está cadastrado em Horários.`)
    if (r.admissao && !dataPlanilha(r.admissao)) return erros.push(`Linha ${n}: data de admissão "${r.admissao}" inválida (use dd/mm/aaaa).`)
    vistas.add(matricula)
    ok.push({matricula, nome, setor, cargo: String(r.cargo ?? '').trim(), turno, vinculo, cpf, telefone: String(r.telefone ?? '').trim() || null, admissao: dataPlanilha(r.admissao)})
  })
  return {ok, erros, repetidas}
}
async function importarPlanilha() {
  const novos = [...new Set(S.imp.ok.map(r => r.setor))].filter(n => !S.d.setores.some(s => s.nome === n))
  if (novos.length) await q(sb.from('setores').insert(novos.map(nome => ({nome}))))
  const setores = Object.fromEntries((await q(sb.from('setores').select('id, nome'))).map(s => [s.nome, s.id]))
  const turnos = Object.fromEntries(S.d.turnos.map(t => [semAcento(t.nome), t.id]))
  await q(sb.from('servidores').insert(S.imp.ok.map(r => ({matricula: r.matricula, nome: r.nome, cargo: r.cargo, setor_id: setores[r.setor],
    turno_id: r.turno ? turnos[semAcento(r.turno)] : null, vinculo: r.vinculo, cpf: r.cpf, telefone: r.telefone, admissao: r.admissao}))))
  return S.imp.ok.length
}

// Envio do mês ao RH (até o dia 5): a secretaria envia o mês que já terminou; depois só o RH corrige, e pode devolver.
const nomeDoMes = mes => new Date(Date.UTC(+mes.slice(0, 4), +mes.slice(5, 7) - 1, 15)).toLocaleDateString('pt-BR', {month: 'long', year: 'numeric', timeZone: 'UTC'})
function envioMes(mes) {
  const papel = S.perfil.papel, env = S.env || [], quando = e => dataBR(diaLocal(e.enviado_em))
  if (mes >= hoje().slice(0, 7)) return ''   // mês em andamento não se envia
  if (papel === 'chefe') {
    const e = env.find(x => x.setor_id === S.perfil.setor_id)
    return e ? `<div class="msg ok">Frequência de <b>${nomeDoMes(mes)}</b> enviada ao RH em ${quando(e)}. A partir daqui só o RH corrige este mês.</div>`
      : `<div class="msg info">A frequência de <b>${nomeDoMes(mes)}</b> ainda não foi enviada ao RH. Confira faltas e pendências abaixo e envie.
          <button class="btn sm" data-a="enviar-mes" style="margin-left:8px">Enviar ao RH</button></div>`
  }
  const unidades = S.d.setores.filter(st => S.d.servidores.some(x => x.setor_id === st.id) || env.some(e => e.setor_id === st.id))
  const falta = unidades.filter(st => !env.some(e => e.setor_id === st.id)).length
  return `<div class="card" style="margin:0 0 14px"><h3>Envio de ${nomeDoMes(mes)} ao RH <small>${unidades.length - falta} de ${unidades.length}</small></h3>
    ${unidades.map(st => { const e = env.find(x => x.setor_id === st.id)
      return `<div class="row"><div><b>${esc(st.nome)}</b></div>${e ? `<div class="acoes"><span class="pill green">enviada em ${quando(e)}</span>${papel === 'rh' ? `<button class="btn ghost sm" data-a="devolver-mes" data-id="${st.id}">Devolver</button>` : ''}</div>`
        : '<span class="pill amber">ainda não enviou</span>'}</div>` }).join('')}</div>`
}

/* ============================== ações ============================== */
const dadosForm = f => Object.fromEntries([...new FormData(f)].map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]))
const vazioNull = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === '' ? null : v]))

const FORMS = {
  async entrar(f, ev) {
    const d = dadosForm(f), criar = ev.submitter?.name === 'criar'
    const {data, error} = await (criar ? sb.auth.signUp : sb.auth.signInWithPassword).call(sb.auth, {email: d.email, password: d.senha})
    if (error) throw new Error(traduz(error))
    if (criar && !data.session) return ['info', 'Conta criada. Confirme pelo link que chegou no seu e-mail e depois entre.']
    await entrou(data.session?.user || data.user)
  },
  async convite(f) {
    await q(sb.rpc('aceitar_convite', {p_codigo: dadosForm(f).codigo}))
    const {data} = await sb.auth.getSession(); await entrou(data.session.user)
    return ['ok', 'Acesso liberado. Bem-vindo(a) ao SIGEP!']
  },
  async servidor(f) {
    const d = vazioNull(dadosForm(f)), [tipo, id] = (d.jornada || ':').split(':'), extras = new FormData(f).getAll('turno_extra')
    delete d.jornada; delete d.turno_extra
    Object.assign(d, {turno_id: tipo === 't' ? id : null, escala_id: tipo === 'e' ? id : null, cpf: d.cpf?.replace(/\D/g, '') || null, cargo: d.cargo || ''})
    d.turnos_extra = tipo === 't' ? extras.filter(x => x !== id) : []
    if (tipo !== 't' && extras.length) throw erroCampo(tipo === 'e' ? 'Quem trabalha em escala (plantão) não tem turno extra.' : 'Escolha primeiro o turno principal.', 'jornada')
    const cruza = d.turnos_extra.length && horariosSeCruzam({turno_id: d.turno_id, turnos_extra: []}, {turno_id: null, turnos_extra: d.turnos_extra})
    if (cruza) throw erroCampo('Os turnos marcados se cruzam no horário. Marque turnos em horários diferentes.', 'turno_extra')
    if (!d.escala_id) d.escala_inicio = null
    else if (!d.escala_inicio) throw erroCampo('Informe o início da escala (o primeiro dia de trabalho do ciclo).', 'escala_inicio')
    if (S.edit === 'novo') await q(sb.from('servidores').insert(d))
    else await q(sb.from('servidores').update(d).eq('id', S.edit))
    S.edit = null
    const outros = d.cpf ? S.d.servidores.filter(x => x.cpf === d.cpf && x.matricula !== d.matricula) : []
    if (!outros.length) return ['ok', 'Servidor salvo.']
    const choque = outros.find(o => horariosSeCruzam({...d}, o))
    return [choque ? 'erro' : 'ok', `Servidor salvo. Mesmo CPF da matrícula ${outros.map(o => o.matricula).join(', ')}: são vínculos da mesma pessoa e um crachá serve para todos.` +
      (choque ? ` ATENÇÃO: o horário se cruza com o da matrícula ${choque.matricula} (${jornada(choque)}). Acúmulo de cargos exige horários compatíveis.` : '')]
  },
  async setor(f) {
    const nome = dadosForm(f).nome
    if (f.dataset.id) await q(sb.from('setores').update({nome}).eq('id', f.dataset.id))
    else await q(sb.from('setores').insert({nome}))
    S.edit = null; return ['ok', f.dataset.id ? 'Setor salvo.' : `Setor "${nome}" criado. Agora toque em "Gerar acesso da secretaria" ao lado dele.`]
  },
  async turno(f) {
    const d = vazioNull(dadosForm(f)); delete d.dia
    d.dias_semana = new FormData(f).getAll('dia').map(Number)
    if (!d.dias_semana.length) throw erroCampo('Marque pelo menos um dia de trabalho.', 'dia')
    if (!d.saida_almoco !== !d.retorno_almoco) throw erroCampo('Preencha a saída e a volta do almoço, ou deixe as duas em branco.', 'retorno_almoco')
    if (f.dataset.id) await q(sb.from('turnos').update(d).eq('id', f.dataset.id))
    else await q(sb.from('turnos').insert(d))
    S.edit = null; return ['ok', 'Turno salvo.']
  },
  async escala(f) { await q(sb.from('escalas').insert(dadosForm(f))); return ['ok', 'Escala salva.'] },
  async justificativa(f) {
    const d = dadosForm(f), batida = d.tipo === 'batida'
    if (!batida && d.fim < d.inicio) throw erroCampo('A data final é antes da inicial.', 'fim')
    const j = await q(sb.rpc('pedir_justificativa', {p_servidor: f.dataset.id, p_tipo: d.tipo, p_inicio: batida ? null : d.inicio, p_fim: batida ? null : d.fim,
      p_motivo: d.motivo, p_batida_tipo: batida ? d.batida_tipo : null, p_batida_em: batida ? `${d.dia}T${d.hora}:00-04:00` : null}))
    return ['ok', j.status === 'aprovada' ? 'Justificativa lançada e aprovada.' : 'Pedido enviado. Sua chefia ou o RH vai responder.']
  },
  async decidir(f, ev) {
    const aprovar = ev.submitter?.value === '1'
    await q(sb.rpc('decidir_justificativa', {p_id: f.dataset.id, p_aprovar: aprovar, p_resposta: dadosForm(f).resposta || null}))
    return ['ok', aprovar ? 'Pedido aprovado.' : 'Pedido recusado.']
  },
  async feriado(f) { await q(sb.from('feriados').insert(dadosForm(f))); return ['ok', 'Feriado salvo.'] },
  async 'convite-novo'(f) {
    const d = vazioNull(dadosForm(f))
    if (d.papel === 'servidor') d.nome = S.d.servidores.find(s => s.id === d.servidor_id).nome
    const [c] = await q(sb.from('convites').insert(d).select('codigo, nome'))
    S.convite = c; S.edit = null
  },
}

const ACOES = {
  async sair() { await sb.auth.signOut(); Object.assign(S, {perfil: null, email: null, d: {}, edit: null, sel: new Set(), imp: null, convite: null, esp: null, bat: [], just: [], pedidos: []}) },
  novo() { S.edit = 'novo'; scrollTo(0, 0) },
  editar(el) { S.edit = el.dataset.id; scrollTo(0, 0) },
  cancelar() { S.edit = null },
  sel(el) { el.checked ? S.sel.add(el.dataset.id) : S.sel.delete(el.dataset.id) },
  todos(el) { document.querySelectorAll('[data-a="sel"]').forEach(c => el.checked ? S.sel.add(c.dataset.id) : S.sel.delete(c.dataset.id)) },
  crachas() { imprimirCrachas(); return false },
  async desligar(el) {
    const s = S.d.servidores.find(x => x.id === el.dataset.id)
    if (!confirm(`Desligar ${s.nome}? O crachá para de funcionar em todos os totens agora.`)) return false
    await q(sb.from('servidores').update({situacao: 'desligado', desligado_em: hoje()}).eq('id', s.id))
    S.edit = null; return ['ok', `${s.nome} desligado(a).`]
  },
  async reativar(el) {
    await q(sb.from('servidores').update({situacao: 'ativo', desligado_em: null}).eq('id', el.dataset.id))
    S.edit = null; return ['ok', 'Servidor reativado.']
  },
  async 'excluir-setor'(el) {
    if (!confirm('Excluir este setor?')) return false
    await q(sb.from('setores').delete().eq('id', el.dataset.id)); return ['ok', 'Setor excluído.']
  },
  async 'excluir-feriado'(el) { await q(sb.from('feriados').delete().eq('data', el.dataset.id)); return ['ok', 'Feriado excluído.'] },
  async desistir(el) {
    if (!confirm('Desistir deste pedido?')) return false
    await q(sb.from('justificativas').delete().eq('id', el.dataset.id)); return ['ok', 'Pedido retirado.']
  },
  async 'enviar-mes'() {
    const mes = mesAtual()
    if (!confirm(`Enviar a frequência de ${nomeDoMes(mes)} ao RH? Depois disso só o RH corrige este mês.`)) return false
    await q(sb.from('meses_enviados').insert({setor_id: S.perfil.setor_id, mes: mes + '-01'})); return ['ok', `Frequência de ${nomeDoMes(mes)} enviada ao RH.`]
  },
  async 'devolver-mes'(el) {
    if (!confirm(`Devolver ${nomeDoMes(mesAtual())} para ${setorNome(el.dataset.id)}? A unidade volta a poder corrigir e precisa enviar de novo.`)) return false
    await q(sb.from('meses_enviados').delete().eq('setor_id', el.dataset.id).eq('mes', mesAtual() + '-01')); return ['ok', 'Mês devolvido à unidade.']
  },
  async 'apagar-jornada'(el) {
    if (!confirm(`Apagar o horário anterior (até ${dataBR(el.dataset.ate)})? Os dias até essa data passam a ser calculados com o horário seguinte.`)) return false
    await q(sb.from('jornadas_anteriores').delete().eq('servidor_id', el.dataset.id).eq('ate', el.dataset.ate)); return ['ok', 'Horário anterior apagado.']
  },
  'ver-espelho'(el) { S.esp = el.dataset.id; scrollTo(0, 0); return false },
  'voltar-espelho'() { S.esp = null; return false },
  'ver-semed'() {
    if (!setorSemed()) return ['info', 'Escolha a unidade (setor) para ver a folha da SEMED.']
    S.semed = true; scrollTo(0, 0); return false
  },
  'voltar-semed'() { S.semed = false; return false },
  'imprimir-semed'() {
    $('#impressao').innerHTML = htmlFolhaSemed(setorSemed(), mesAtual())
    document.body.classList.add('imprimindo'); print(); document.body.classList.remove('imprimindo')
    return false
  },
  'imprimir-espelho'(el) {
    $('#impressao').innerHTML = htmlEspelho(S.d.servidores.find(s => s.id === el.dataset.id))
    document.body.classList.add('imprimindo', 'imp-espelho'); print(); document.body.classList.remove('imprimindo', 'imp-espelho')
    return false
  },
  async 'acesso-setor'(el) {   // login da secretaria da unidade = convite de chefe daquele setor
    const [c] = await q(sb.from('convites').insert({nome: 'Secretaria – ' + setorNome(el.dataset.id), papel: 'chefe', setor_id: el.dataset.id}).select('codigo, nome, setor_id'))
    S.convite = c; scrollTo(0, 0)
  },
  async 'cancelar-convite'(el) { await q(sb.from('convites').delete().eq('codigo', el.dataset.id)); return ['ok', 'Código cancelado.'] },
  async ativar(el) { await q(sb.from('perfis').update({ativo: el.dataset.v === 'true'}).eq('id', el.dataset.id)) },
  async arquivo(el) {
    const arq = el.files[0]; if (!arq) return false
    const wb = XLSX.read(await arq.arrayBuffer(), {cellDates: true})
    S.imp = conferirPlanilha(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {defval: ''}))
  },
  async importar() { const n = await importarPlanilha(); S.imp = null; return ['ok', `${n} servidor(es) importado(s).`] },
}

// depois de cada ação: recarrega do banco e redesenha (false = só redesenha, sem recarregar)
// form: o formulário que disparou. Se der erro, ele fica na tela, preenchido, com o erro no campo certo (js/etapas.js).
// foto da batida (só o RH enxerga; some depois de 90 dias): abre por cima da tela, toque para fechar
async function verFoto(id) {
  try {
    const f = (await q(sb.from('batida_fotos').select('foto').eq('batida_id', id)))[0]
    const d = document.createElement('div')
    d.style.cssText = 'position:fixed;inset:0;background:#000c;display:grid;place-items:center;z-index:99;color:#fff;text-align:center;padding:16px'
    d.innerHTML = f ? `<div><img src="${f.foto}" alt="Foto da batida" style="max-width:90vw;max-height:80vh;border-radius:8px"><p>Toque para fechar</p></div>`
      : '<p>Sem foto para esta batida (ela é apagada depois de 90 dias, ou o totem não a enviou).<br>Toque para fechar.</p>'
    d.onclick = () => d.remove(); document.body.append(d)
  } catch (e) { S.msg = ['erro', e.message]; render() }
}

async function executar(f, form) {
  try {
    const r = await f()
    if (r === false) return render()
    S.msg = Array.isArray(r) ? r : null
    if (S.perfil) await carregar()
  } catch (e) {
    if (form && typeof Etapas !== 'undefined' && Etapas.erro(form, e.message, e.campo)) return
    S.msg = ['erro', e.message]
  }
  render()
}
const erroCampo = (msg, campo) => Object.assign(new Error(msg), {campo})

async function entrou(user) {
  S.email = user.email
  S.perfil = (await q(sb.from('perfis').select('*').eq('id', user.id)))[0] || null
  if (S.perfil && !S.perfil.ativo) { S.perfil = null; await sb.auth.signOut(); S.email = null; throw new Error('Seu acesso foi desativado. Procure o RH.') }
  if (S.perfil) { S.aba = ABAS[S.perfil.papel].some(([k]) => k === location.hash.slice(1)) ? location.hash.slice(1) : ABAS[S.perfil.papel][0][0]; await carregar() }
}

function ligarEventos() {
  document.addEventListener('submit', ev => {
    const f = ev.target.closest('form[data-f]'); if (!f) return
    ev.preventDefault()
    executar(() => FORMS[f.dataset.f](f, ev), f)
  })
  document.addEventListener('click', ev => {
    const el = ev.target.closest('[data-a]'); if (!el || el.type === 'file') return
    if (el.type !== 'checkbox') ev.preventDefault()
    const a = el.dataset.a
    if (a === 'foto') return verFoto(el.dataset.id)
    if (['sel', 'todos'].includes(a)) { ACOES[a](el); return render() }
    if (a === 'novo' || a === 'editar' || a === 'cancelar') { S.msg = null; S.convite = null; ACOES[a](el); return render() }
    executar(() => ACOES[a](el))
  })
  document.addEventListener('change', ev => {
    const el = ev.target
    if (el.dataset.a === 'arquivo') return executar(() => ACOES.arquivo(el))
    if (el.matches('[data-papel]')) { S.edit = el.value; S.convite = null; return render() }
    if (el.matches('[data-jtipo]')) { S.jtipo = el.value; return render() }
    if (el.matches('[data-mes]') && el.value) { S.mes = el.value; return executar(async () => {}) }   // recarrega as batidas do mês
    if (el.dataset.filtro) { S.filtro[el.dataset.filtro] = el.value; render() }
  })
  document.addEventListener('input', ev => {
    const el = ev.target
    if (el.dataset.filtro === 'busca') { S.filtro.busca = el.value; render(); const b = $('[data-filtro="busca"]'); b.focus(); b.setSelectionRange(b.value.length, b.value.length) }
  })
  addEventListener('hashchange', () => {
    S.aba = location.hash.slice(1); S.edit = null; S.msg = null; S.convite = null; S.esp = null; S.semed = false
    if (S.perfil && ['espelho', 'ponto', 'painel'].includes(S.aba)) executar(async () => {}); else render()   // espelho e painel buscam as batidas
  })
}

async function iniciar(cliente) {
  sb = cliente
  ligarEventos()
  const {data} = await sb.auth.getSession()
  if (data.session) await executar(() => entrou(data.session.user))
  else render()
  // painel aberto: atualiza sozinho a cada minuto (não atrapalha ninguém digitando)
  setInterval(() => { if (S.perfil && S.aba === 'painel' && !document.hidden && !document.activeElement?.matches?.('input, select, textarea')) executar(async () => {}) }, 60e3)
}
