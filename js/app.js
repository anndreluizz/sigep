// SIGEP · telas. Tudo passa pelo banco (Supabase); as permissões são conferidas lá (RLS),
// a tela só esconde o que o perfil não usa. `sb` é o cliente do Supabase (ou o local, na demonstração).
let sb
const S = {perfil: null, email: null, aba: null, d: {}, msg: null, edit: null, sel: new Set(), imp: null, filtro: {setor: '', busca: '', sit: 'ativos'}, convite: null,
  mes: null, esp: null, bat: [],   // espelho: mês 'aaaa-mm', servidor aberto, batidas do mês
  just: [], pedidos: [], jtipo: 'atestado'}   // justificativas do mês, pedidos recentes, tipo escolhido no formulário
const $ = s => document.querySelector(s)
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]))
const hoje = () => new Date().toLocaleDateString('sv-SE', {timeZone: 'America/Manaus'})   // aaaa-mm-dd
const dataBR = d => d ? d.split('-').reverse().join('/') : ''

const ABAS = {
  rh: [['servidores', 'Servidores'], ['espelho', 'Frequência'], ['pedidos', 'Pedidos'], ['setores', 'Setores'], ['horarios', 'Horários'], ['acessos', 'Acessos'], ['importar', 'Importar planilha']],
  prefeito: [['servidores', 'Servidores'], ['espelho', 'Frequência']],
  chefe: [['servidores', 'Minha equipe'], ['espelho', 'Frequência'], ['pedidos', 'Pedidos'], ['acessos', 'Acessos']],
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
const COLS_SERV = 'id, matricula, nome, cargo, setor_id, turno_id, escala_id, escala_inicio, situacao, desligado_em, vinculo, admissao'
async function carregar() {
  const p = S.perfil.papel, rh = p === 'rh', gestor = rh || p === 'chefe'
  const [setores, turnos, escalas, feriados, servidores, pessoais, perfis, convites, bat] = await Promise.all([
    q(sb.from('setores').select('*').order('nome')), q(sb.from('turnos').select('*').order('nome')), q(sb.from('escalas').select('*').order('nome')),
    q(sb.from('feriados').select('*').order('data')),
    p === 'totem' ? [] : q(sb.from('servidores').select(COLS_SERV).order('nome')),
    gestor ? q(sb.rpc('dados_pessoais')) : [], rh ? q(sb.from('perfis').select('*').order('nome')) : [],
    gestor ? q(sb.from('convites').select('*').order('criado_em', {ascending: false})) : [],
    ['espelho', 'ponto'].includes(S.aba) ? batidasDoMes(mesAtual()) : []])
  const pes = Object.fromEntries(pessoais.map(x => [x.id, x]))
  servidores.forEach(s => Object.assign(s, pes[s.id] || {}))
  S.d = {setores, turnos, escalas, feriados, servidores, perfis, convites}
  S.bat = bat
  if (p !== 'totem') {   // justificativas que tocam o mês (para o espelho) e os pedidos recentes (aba Pedidos / Meu ponto)
    const [ini, fim] = limitesMes(mesAtual())
    ;[S.just, S.pedidos] = await Promise.all([q(sb.from('justificativas').select('*').gte('fim', ini).lte('inicio', fim)),
      q(sb.from('justificativas').select('*').order('pedido_em', {ascending: false}).range(0, 199))])
  }
}
// batidas do mês (com um dia de folga em cada ponta, por causa do plantão que passa da meia-noite).
// O Supabase devolve no máximo 1000 linhas por vez: busca em páginas. O banco só entrega o que o perfil pode ver.
const mesAtual = () => S.mes || hoje().slice(0, 7)
async function batidasDoMes(mes) {
  const [ini, fim] = limitesMes(mes), out = []
  for (let de = 0; ; de += 1000) {
    const pag = await q(sb.from('batidas').select('servidor_id, tipo, em, origem').gte('em', addDia(ini, -1) + 'T00:00:00-04:00')
      .lt('em', addDia(fim, 2) + 'T00:00:00-04:00').order('em').order('id').range(de, de + 999))
    out.push(...pag); if (pag.length < 1000) return out
  }
}
const setorNome = id => S.d.setores.find(s => s.id === id)?.nome || '—'
const jornada = s => s.escala_id ? S.d.escalas.find(e => e.id === s.escala_id)?.nome : S.d.turnos.find(t => t.id === s.turno_id)?.nome || '—'
const hora = t => t?.slice(0, 5)
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
const TIPOS_J = {atestado: 'Atestado médico', ferias: 'Férias', licenca: 'Licença / afastamento', servico_externo: 'Serviço externo',
  abono: 'Outro motivo (abono)', batida: 'Esqueci de bater o ponto'}
function espelhoMes(s, batidas, mes, {turnos, escalas, feriados, justificativas = []}, hojeStr, agoraAbs = Math.round(Date.now() / 6e4)) {
  const just = justificativas.filter(j => j.servidor_id === s.id && j.status !== 'recusada')
  const escala = s.escala_id && escalas.find(e => e.id === s.escala_id)
  const turno = turnos.find(t => t.id === (escala ? escala.turno_id : s.turno_id))
  const feriado = Object.fromEntries(feriados.map(f => [f.data, f.nome]))
  const [ini, fim] = limitesMes(mes)
  const jorn = turno && (() => {
    const ent = toMin(turno.entrada); let sai = toMin(turno.saida); if (sai <= ent) sai += 1440
    return {ent, sai, min: sai - ent - (turno.saida_almoco ? toMin(turno.retorno_almoco) - toMin(turno.saida_almoco) : 0)}
  })()
  const previsto = dia => {
    if (!turno || (s.admissao && dia < s.admissao) || (s.desligado_em && dia > s.desligado_em)) return false
    if (escala) { const n = Math.round((Date.parse(dia) - Date.parse(s.escala_inicio)) / 864e5); return n >= 0 && n % (escala.dias_trabalho + escala.dias_descanso) < escala.dias_trabalho }
    return turno.dias_semana.includes(new Date(dia + 'T12:00:00Z').getUTCDay()) && !feriado[dia]
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
    const prev = previsto(dia), ps = porDia[dia] || [], d0 = inicioDia(dia), oc = []
    // intervalo pré-assinalado: quem não bate saída/volta do almoço tem o intervalo descontado do par que o cobre
    const [alm0, alm1] = turno?.saida_almoco ? [d0 + toMin(turno.saida_almoco), d0 + toMin(turno.retorno_almoco)] : []
    const trab = ps.reduce((t, p) => t + (p.ent && p.sai ? p.sai - p.ent - (alm0 && p.ent <= alm0 && p.sai >= alm1 ? alm1 - alm0 : 0) : 0), 0)
    const fechado = dia < hojeStr
    for (const p of ps) {
      if (!p.ent) oc.push(['Saída sem entrada', 'amber'])
      else if (!p.sai) oc.push(agoraAbs - p.ent < LIMITE_PLANTAO_MIN && dia >= addDia(hojeStr, -1) ? ['Em andamento', 'blue'] : ['Sem saída', 'red'])
    }
    if (prev && fechado && !ps.length) oc.push(['Falta', 'red'])
    const primeira = ps.find(p => p.ent)?.ent, ultima = [...ps].reverse().find(p => p.sai)?.sai
    if (prev && primeira && primeira - d0 > jorn.ent + turno.tolerancia_min) oc.push([`Atraso ${duracao(primeira - d0 - jorn.ent)}`, 'amber'])
    if (prev && fechado && ultima && !ps.some(p => p.ent && !p.sai) && ultima - d0 < jorn.sai - turno.tolerancia_saida_min) oc.push(['Saiu antes', 'amber'])
    if (!prev && ps.length) oc.push([feriado[dia] ? 'Trabalhou no feriado' : 'Fora da escala', 'blue'])
    // abono aprovado: o dia não fica devendo (some falta, atraso e saída antecipada); pedido pendente só avisa
    const abono = just.find(j => j.tipo !== 'batida' && j.status === 'aprovada' && j.inicio <= dia && dia <= j.fim)
    let esperado = prev ? jorn.min : 0
    if (abono) {
      for (let i = oc.length - 1; i >= 0; i--) if (oc[i][0] === 'Falta' || oc[i][0] === 'Saiu antes' || oc[i][0].startsWith('Atraso')) oc.splice(i, 1)
      oc.push([TIPOS_J[abono.tipo], 'green']); esperado = Math.min(esperado, trab)
    }
    if (just.some(j => j.status === 'pendente' && j.inicio <= dia && dia <= j.fim)) oc.push(['Pedido em análise', 'blue'])
    const linha = {dia, prev, feriado: feriado[dia], pares: ps, trab, esperado, oc, fechado}
    if (fechado) {
      tot.previsto += linha.esperado; tot.trabalhado += trab
      tot.faltas += oc.some(o => o[0] === 'Falta'); tot.atrasos += oc.some(o => o[0].startsWith('Atraso'))
      tot.pendencias += oc.filter(o => ['Sem saída', 'Saída sem entrada'].includes(o[0])).length
    }
    dias.push(linha)
  }
  tot.saldo = tot.trabalhado - tot.previsto
  return {dias, tot, turno}
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
          <td>${esc(s.matricula)}</td><td>${esc(s.nome)}</td><td>${esc(setorNome(s.setor_id))}</td><td>${esc(s.cargo)}</td><td>${esc(jornada(s))}</td>
          <td><span class="pill ${SITUACAO[s.situacao][1]}">${SITUACAO[s.situacao][0]}${s.desligado_em ? ' ' + dataBR(s.desligado_em) : ''}</span></td>
          ${rh ? `<td><button class="btn ghost sm" data-a="editar" data-id="${s.id}">Editar</button></td>` : ''}</tr>`).join('')}
      </tbody></table>${lista.length ? '' : '<div class="vazio">Nenhum servidor encontrado.</div>'}</div>
      <p class="sub">${lista.length} servidor(es).${rh ? ' Desligou o servidor → o crachá dele para de funcionar em todos os totens na hora.' : ''}</p></div>`
  },

  espelho() {
    const s = S.esp && S.d.servidores.find(x => x.id === S.esp)
    if (s) return telaEspelho(s, true)
    const f = S.filtro, mes = mesAtual(), lista = S.d.servidores.filter(x => x.situacao !== 'desligado' && (!f.setor || x.setor_id === f.setor))
    const linhas = lista.map(x => ({s: x, ...espelhoMes(x, S.bat, mes, {...S.d, justificativas: S.just}, hoje())}))
      .sort((a, b) => b.tot.faltas + b.tot.pendencias - (a.tot.faltas + a.tot.pendencias) || a.s.nome.localeCompare(b.s.nome))
    const n = (v, cor) => v ? `<span class="pill ${cor}">${v}</span>` : '<span class="sub">0</span>'
    return cabecalho(S.perfil.papel === 'chefe' ? setorNome(S.perfil.setor_id) : 'Frequência', 'Frequência do mês') + `<div class="card"><div class="filtros">
        <input type="month" data-mes value="${mes}" aria-label="Mês">
        ${S.perfil.papel === 'chefe' ? '' : `<select data-filtro="setor">${opcoes(S.d.setores.map(x => [x.id, x.nome]), f.setor, 'Todos os setores')}</select>`}
      </div><div class="tabela"><table><thead><tr><th>Servidor</th><th>Setor</th><th>Previsto</th><th>Trabalhado</th><th>Saldo</th><th>Faltas</th><th>Atrasos</th><th>Pendências</th><th></th></tr></thead><tbody>
      ${linhas.map(({s, tot, turno}) => `<tr><td>${esc(s.nome)}<div class="sub">mat. ${esc(s.matricula)}${turno ? '' : ' · sem horário definido'}</div></td><td>${esc(setorNome(s.setor_id))}</td>
        <td>${duracao(tot.previsto)}</td><td>${duracao(tot.trabalhado)}</td><td><b style="color:var(${tot.saldo < 0 ? '--red' : '--goldink'})">${duracao(tot.saldo)}</b></td>
        <td>${n(tot.faltas, 'red')}</td><td>${n(tot.atrasos, 'amber')}</td><td>${n(tot.pendencias, 'red')}</td>
        <td><button class="btn ghost sm" data-a="ver-espelho" data-id="${s.id}">Espelho</button></td></tr>`).join('')}
      </tbody></table>${linhas.length ? '' : '<div class="vazio">Nenhum servidor em atividade.</div>'}</div>
      <p class="sub">Conta até ontem; hoje ainda está em andamento. Quem tem falta ou pendência aparece primeiro.</p></div>`
  },

  pedidos() {
    const pend = S.pedidos.filter(j => j.status === 'pendente'), dec = S.pedidos.filter(j => j.status !== 'pendente').slice(0, 30)
    return cabecalho(S.perfil.papel === 'chefe' ? setorNome(S.perfil.setor_id) : 'Recursos Humanos', 'Pedidos de justificativa') +
      `<div class="card"><h3>Esperando resposta <small>${pend.length}</small></h3>${listaPedidos(pend, true) || '<div class="vazio">Nenhum pedido esperando resposta.</div>'}
        <p class="sub">Aprovou "esqueci de bater" → vira batida no espelho, marcada com ✎. Aprovou um abono → os dias do período deixam de contar falta e atraso.
        Para lançar férias ou licença, abra o espelho do servidor em Frequência.</p></div>
      <div class="card" style="margin-top:14px"><h3>Respondidos recentemente</h3>${listaPedidos(dec, true) || '<div class="vazio">Nada ainda.</div>'}</div>`
  },

  ponto() {
    const s = S.d.servidores[0]
    return s ? telaEspelho(s, false) : '<div class="card vazio">Cadastro não encontrado. Procure o RH.</div>'
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
        <p class="sub span2">Saída igual ou antes da entrada (ex.: 07:00–07:00) é plantão que passa da meia-noite.</p>
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
      <div class="sub" style="text-align:right">${esc(NOME_INSTITUICAO)}<br>Espelho de ponto · ${nomeMes}</div></div>
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
  return cabecalho('Espelho de ponto', s.nome, `${voltar ? '<button class="btn ghost" data-a="voltar-espelho">← Frequência</button>' : ''}
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
      <label>Horário<select name="jornada">${opcoes(jornadas, jor, 'Sem horário definido')}</select></label>
      <label>Início da escala (1º dia de trabalho)<input name="escala_inicio" type="date" value="${s.escala_inicio || ''}"></label>
      <label>Vínculo<select name="vinculo">${opcoes([['efetivo', 'Efetivo'], ['contratado', 'Contratado'], ['comissionado', 'Comissionado']], s.vinculo, '—')}</select></label>
      <label>Admissão<input name="admissao" type="date" value="${s.admissao || ''}"></label>
      <label>CPF<input name="cpf" inputmode="numeric" value="${esc(s.cpf)}" placeholder="só números"></label>
      <label>Telefone<input name="telefone" type="tel" value="${esc(s.telefone)}"></label>
      ${s.situacao !== 'desligado' ? `<label>Situação<select name="situacao">${opcoes([['ativo', 'Ativo'], ['ferias', 'Férias'], ['afastado', 'Afastado']], s.situacao)}</select></label>` : ''}
      <div class="acoes span2"><button class="btn">Salvar</button><button type="button" class="btn ghost" data-a="cancelar">Cancelar</button>
        ${novo ? '' : s.situacao === 'desligado'
          ? `<button type="button" class="btn ghost" data-a="reativar" data-id="${s.id}">Reativar</button>`
          : `<button type="button" class="btn red" data-a="desligar" data-id="${s.id}">Desligar servidor</button>`}</div>
    </form></div>`
}

/* ============================== crachás ============================== */
function imprimirCrachas() {
  const lista = S.d.servidores.filter(s => S.sel.has(s.id))
  const qr = txt => { const g = qrcode(0, 'M'); g.addData(txt); g.make(); return g.createSvgTag({cellSize: 4, margin: 0, scalable: true}) }
  $('#impressao').innerHTML = `<div class="folha">${lista.map(s => `<div class="cartao"><div class="furo"></div>
    <div class="topo">${esc(NOME_INSTITUICAO)}</div><div class="corpo"><div><div class="nome">${esc(s.nome)}</div>
    <div class="cargo">${esc(s.cargo)}${s.cargo ? ' · ' : ''}${esc(setorNome(s.setor_id))}</div><div class="mat">Matrícula ${esc(s.matricula)}</div></div>
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
    const d = vazioNull(dadosForm(f)), [tipo, id] = (d.jornada || ':').split(':')
    delete d.jornada
    Object.assign(d, {turno_id: tipo === 't' ? id : null, escala_id: tipo === 'e' ? id : null, cpf: d.cpf?.replace(/\D/g, '') || null, cargo: d.cargo || ''})
    if (!d.escala_id) d.escala_inicio = null
    else if (!d.escala_inicio) throw erroCampo('Informe o início da escala (o primeiro dia de trabalho do ciclo).', 'escala_inicio')
    if (S.edit === 'novo') await q(sb.from('servidores').insert(d))
    else await q(sb.from('servidores').update(d).eq('id', S.edit))
    S.edit = null; return ['ok', 'Servidor salvo.']
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
  'ver-espelho'(el) { S.esp = el.dataset.id; scrollTo(0, 0); return false },
  'voltar-espelho'() { S.esp = null; return false },
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
    S.aba = location.hash.slice(1); S.edit = null; S.msg = null; S.convite = null; S.esp = null
    if (S.perfil && ['espelho', 'ponto'].includes(S.aba)) executar(async () => {}); else render()   // espelho busca as batidas
  })
}

async function iniciar(cliente) {
  sb = cliente
  ligarEventos()
  const {data} = await sb.auth.getSession()
  if (data.session) await executar(() => entrou(data.session.user))
  else render()
}
