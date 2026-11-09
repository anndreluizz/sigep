// SIGEP · telas. Tudo passa pelo banco (Supabase); as permissões são conferidas lá (RLS),
// a tela só esconde o que o perfil não usa. `sb` é o cliente do Supabase (ou o local, na demonstração).
let sb
const S = {perfil: null, email: null, aba: null, d: {}, msg: null, edit: null, sel: new Set(), imp: null, filtro: {setor: '', busca: '', sit: 'ativos'}, convite: null}
const $ = s => document.querySelector(s)
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]))
const hoje = () => new Date().toLocaleDateString('sv-SE', {timeZone: 'America/Manaus'})   // aaaa-mm-dd
const dataBR = d => d ? d.split('-').reverse().join('/') : ''

const ABAS = {
  rh: [['servidores', 'Servidores'], ['setores', 'Setores'], ['horarios', 'Horários'], ['acessos', 'Acessos'], ['importar', 'Importar planilha']],
  prefeito: [['servidores', 'Servidores']],
  chefe: [['servidores', 'Minha equipe']],
  servidor: [['meu', 'Meu cadastro']],
  totem: [['totem', 'Totem']],
}
const PAPEIS = {rh: 'RH', prefeito: 'Prefeito / Gabinete', chefe: 'Chefe de setor', servidor: 'Servidor', totem: 'Totem'}
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
  const p = S.perfil.papel, rh = p === 'rh'
  const [setores, turnos, escalas, servidores, pessoais, perfis, convites] = await Promise.all([
    q(sb.from('setores').select('*').order('nome')), q(sb.from('turnos').select('*').order('nome')), q(sb.from('escalas').select('*').order('nome')),
    p === 'totem' ? [] : q(sb.from('servidores').select(COLS_SERV).order('nome')),
    rh ? q(sb.rpc('dados_pessoais')) : [], rh ? q(sb.from('perfis').select('*').order('nome')) : [],
    rh ? q(sb.from('convites').select('*').order('criado_em', {ascending: false})) : []])
  const pes = Object.fromEntries(pessoais.map(x => [x.id, x]))
  servidores.forEach(s => Object.assign(s, pes[s.id] || {}))
  S.d = {setores, turnos, escalas, servidores, perfis, convites}
}
const setorNome = id => S.d.setores.find(s => s.id === id)?.nome || '—'
const jornada = s => s.escala_id ? S.d.escalas.find(e => e.id === s.escala_id)?.nome : S.d.turnos.find(t => t.id === s.turno_id)?.nome || '—'
const hora = t => t?.slice(0, 5)
const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

/* ============================== telas ============================== */
function render() {
  const p = S.perfil
  $('#who').innerHTML = p ? `<b>${esc(p.nome)}</b>${PAPEIS[p.papel]} · <button data-a="sair">Sair</button>`
    : S.email ? `<b>${esc(S.email)}</b><button data-a="sair">Sair</button>` : ''
  $('#tabs').innerHTML = p ? ABAS[p.papel].map(([k, t]) => `<a href="#${k}" class="${k === S.aba ? 'on' : ''}">${t}</a>`).join('') : ''
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
    const rh = S.perfil.papel === 'rh', f = S.filtro, busca = f.busca.toLowerCase()
    const lista = S.d.servidores.filter(s => (!f.setor || s.setor_id === f.setor) &&
      (f.sit === 'todos' || (f.sit === 'ativos') === (s.situacao !== 'desligado')) &&
      (!busca || s.nome.toLowerCase().includes(busca) || s.matricula.includes(busca)))
    const titulo = S.perfil.papel === 'chefe' ? setorNome(S.perfil.setor_id) : 'Servidores'
    const botoes = rh ? `<button class="btn" data-a="novo">+ Novo servidor</button>
      <button class="btn gold" data-a="crachas" ${S.sel.size ? '' : 'disabled'}>Imprimir crachás (${S.sel.size})</button>` : ''
    return cabecalho(rh ? 'Recursos Humanos' : 'Somente leitura', titulo, botoes) + (S.edit ? formServidor() : '') +
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

  meu() {
    const s = S.d.servidores[0]
    if (!s) return '<div class="card vazio">Cadastro não encontrado. Procure o RH.</div>'
    const linha = (k, v) => `<div class="row"><span class="sub">${k}</span><b>${esc(v)}</b></div>`
    return cabecalho('Meu cadastro', s.nome) + `<div class="card">${linha('Matrícula', s.matricula)}${linha('Cargo', s.cargo)}
      ${linha('Setor', setorNome(s.setor_id))}${linha('Horário', jornada(s))}${linha('Situação', SITUACAO[s.situacao][0])}
      <p class="sub">O espelho do ponto e o pedido de justificativa chegam na próxima etapa.</p></div>`
  },

  totem() {
    return cabecalho('Totem', setorNome(S.perfil.setor_id)) +
      '<div class="card">Este acesso é de totem. A tela de leitura do crachá pela câmera chega na próxima etapa.</div>'
  },

  setores() {
    const qtd = id => S.d.servidores.filter(s => s.setor_id === id && s.situacao !== 'desligado').length
    return cabecalho('Recursos Humanos', 'Setores') + `<div class="grid g2"><div class="card"><h3>Setores <small>${S.d.setores.length}</small></h3>
      ${S.d.setores.map(s => `<div class="row">${S.edit === s.id
        ? `<form class="acoes" data-f="setor" data-id="${s.id}" style="flex:1"><input name="nome" value="${esc(s.nome)}" required><button class="btn sm">Salvar</button><button type="button" class="btn ghost sm" data-a="cancelar">Cancelar</button></form>`
        : `<div><b>${esc(s.nome)}</b><div class="sub">${qtd(s.id)} servidor(es) em atividade</div></div>
           <div class="acoes"><button class="btn ghost sm" data-a="editar" data-id="${s.id}">Renomear</button><button class="btn ghost sm" data-a="excluir-setor" data-id="${s.id}">Excluir</button></div>`}</div>`).join('')
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
        <label>Entrada<input name="entrada" type="time" required value="${hora(t.entrada) || ''}"></label>
        <label>Saída<input name="saida" type="time" required value="${hora(t.saida) || ''}"></label>
        <label>Saída p/ almoço (opcional)<input name="saida_almoco" type="time" value="${hora(t.saida_almoco) || ''}"></label>
        <label>Volta do almoço<input name="retorno_almoco" type="time" value="${hora(t.retorno_almoco) || ''}"></label>
        <label>Tolerância de atraso (min)<input name="tolerancia_min" type="number" min="0" max="120" value="${t.tolerancia_min ?? 10}"></label>
        <label>Tolerância de saída (min)<input name="tolerancia_saida_min" type="number" min="0" max="120" value="${t.tolerancia_saida_min ?? 10}"></label>
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
        </form></div></div>`
  },

  acessos() {
    const serv = Object.fromEntries(S.d.servidores.map(s => [s.id, s]))
    const pend = S.d.convites.filter(c => !c.usado_por && new Date(c.expira_em) > new Date())
    return cabecalho('Recursos Humanos', 'Acessos') +
      (S.convite ? `<div class="msg ok">Código para <b>${esc(S.convite.nome)}</b>: <code class="cod">${esc(S.convite.codigo)}</code>
         <div class="sub">Vale por 7 dias e uma vez só. A pessoa cria a conta com e-mail e senha e digita este código.</div></div>` : '') +
      `<div class="grid g2"><div class="card"><h3>Gerar código de convite</h3>
        <form class="f" data-f="convite-novo">
          <label class="span2">Perfil<select name="papel" required data-papel>${opcoes(Object.entries(PAPEIS), S.edit || 'chefe')}</select></label>
          ${(S.edit || 'chefe') === 'servidor'
            ? `<label class="span2">Servidor<select name="servidor_id" required>${opcoes(S.d.servidores.filter(s => s.situacao !== 'desligado' && !S.d.perfis.some(p => p.servidor_id === s.id)).map(s => [s.id, `${s.nome} (${s.matricula})`]), null, 'Escolha')}</select></label>`
            : `<label class="span2">Nome<input name="nome" required placeholder="${(S.edit || 'chefe') === 'totem' ? 'Ex.: Totem 1 – Escola' : 'Nome da pessoa'}"></label>`}
          ${['chefe', 'totem'].includes(S.edit || 'chefe') ? `<label class="span2">Setor<select name="setor_id" required>${opcoes(S.d.setores.map(s => [s.id, s.nome]), null, 'Escolha')}</select></label>` : ''}
          <div class="acoes span2"><button class="btn">Gerar código</button></div>
        </form>
        ${pend.length ? `<h3 style="margin-top:16px">Códigos ainda não usados</h3>${pend.map(c => `<div class="row"><div><b>${esc(c.nome)}</b><div class="sub">${PAPEIS[c.papel]}${c.setor_id ? ' · ' + esc(setorNome(c.setor_id)) : ''} · vence ${new Date(c.expira_em).toLocaleDateString('pt-BR')}</div></div>
          <div class="acoes"><code class="cod">${esc(c.codigo)}</code><button class="btn ghost sm" data-a="cancelar-convite" data-id="${esc(c.codigo)}">Cancelar</button></div></div>`).join('')}` : ''}
      </div>
      <div class="card"><h3>Quem tem acesso <small>${S.d.perfis.length}</small></h3>
        ${S.d.perfis.map(p => `<div class="row ${p.ativo ? '' : 'off'}"><div><b>${esc(p.nome)}</b><div class="sub">${PAPEIS[p.papel]}${p.setor_id ? ' · ' + esc(setorNome(p.setor_id)) : ''}${p.servidor_id ? ' · mat. ' + esc(serv[p.servidor_id]?.matricula) : ''}${p.ativo ? '' : ' · desativado'}</div></div>
          ${p.id === S.perfil.id ? '<span class="pill">você</span>' : `<button class="btn ghost sm" data-a="ativar" data-id="${p.id}" data-v="${!p.ativo}">${p.ativo ? 'Desativar' : 'Reativar'}</button>`}</div>`).join('')}
        <p class="sub">Desativar corta o acesso na hora (inclusive de um totem perdido ou roubado).</p></div></div>`
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

function formServidor() {
  const novo = S.edit === 'novo', s = novo ? {situacao: 'ativo'} : S.d.servidores.find(x => x.id === S.edit)
  const jor = s.escala_id ? 'e:' + s.escala_id : s.turno_id ? 't:' + s.turno_id : ''
  const jornadas = [...S.d.turnos.map(t => ['t:' + t.id, `Turno: ${t.nome} (${hora(t.entrada)}–${hora(t.saida)})`]), ...S.d.escalas.map(e => ['e:' + e.id, 'Escala: ' + e.nome])]
  return `<div class="card" style="margin-bottom:14px"><h3>${novo ? 'Novo servidor' : esc(s.nome)}${novo ? '' : ` <span class="pill ${SITUACAO[s.situacao][1]}">${SITUACAO[s.situacao][0]}</span>`}</h3>
    <form class="f" data-f="servidor">
      <label>Matrícula<input name="matricula" required maxlength="20" value="${esc(s.matricula)}"></label>
      <label class="span2">Nome completo<input name="nome" required minlength="3" value="${esc(s.nome)}"></label>
      <label>Cargo<input name="cargo" value="${esc(s.cargo)}"></label>
      <label>Setor<select name="setor_id" required>${opcoes(S.d.setores.map(x => [x.id, x.nome]), s.setor_id, 'Escolha')}</select></label>
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
    else if (!d.escala_inicio) throw new Error('Informe o início da escala (o primeiro dia de trabalho do ciclo).')
    if (S.edit === 'novo') await q(sb.from('servidores').insert(d))
    else await q(sb.from('servidores').update(d).eq('id', S.edit))
    S.edit = null; return ['ok', 'Servidor salvo.']
  },
  async setor(f) {
    const nome = dadosForm(f).nome
    if (f.dataset.id) await q(sb.from('setores').update({nome}).eq('id', f.dataset.id))
    else await q(sb.from('setores').insert({nome}))
    S.edit = null; return ['ok', 'Setor salvo.']
  },
  async turno(f) {
    const d = vazioNull(dadosForm(f)); delete d.dia
    d.dias_semana = new FormData(f).getAll('dia').map(Number)
    if (!d.dias_semana.length) throw new Error('Marque pelo menos um dia de trabalho.')
    if (!d.saida_almoco !== !d.retorno_almoco) throw new Error('Preencha a saída e a volta do almoço, ou deixe as duas em branco.')
    if (f.dataset.id) await q(sb.from('turnos').update(d).eq('id', f.dataset.id))
    else await q(sb.from('turnos').insert(d))
    S.edit = null; return ['ok', 'Turno salvo.']
  },
  async escala(f) { await q(sb.from('escalas').insert(dadosForm(f))); return ['ok', 'Escala salva.'] },
  async 'convite-novo'(f) {
    const d = vazioNull(dadosForm(f))
    if (d.papel === 'servidor') d.nome = S.d.servidores.find(s => s.id === d.servidor_id).nome
    const [c] = await q(sb.from('convites').insert(d).select('codigo, nome'))
    S.convite = c; S.edit = null
  },
}

const ACOES = {
  async sair() { await sb.auth.signOut(); Object.assign(S, {perfil: null, email: null, d: {}, edit: null, sel: new Set(), imp: null, convite: null}) },
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
async function executar(f) {
  try {
    const r = await f()
    if (r === false) return render()
    S.msg = Array.isArray(r) ? r : null
    if (S.perfil) await carregar()
  } catch (e) { S.msg = ['erro', e.message] }
  render()
}

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
    executar(() => FORMS[f.dataset.f](f, ev))
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
    if (el.dataset.filtro) { S.filtro[el.dataset.filtro] = el.value; render() }
  })
  document.addEventListener('input', ev => {
    const el = ev.target
    if (el.dataset.filtro === 'busca') { S.filtro.busca = el.value; render(); const b = $('[data-filtro="busca"]'); b.focus(); b.setSelectionRange(b.value.length, b.value.length) }
  })
  addEventListener('hashchange', () => { S.aba = location.hash.slice(1); S.edit = null; S.msg = null; S.convite = null; render() })
}

async function iniciar(cliente) {
  sb = cliente
  ligarEventos()
  const {data} = await sb.auth.getSession()
  if (data.session) await executar(() => entrou(data.session.user))
  else render()
}
