// Formulários em etapas. Melhora sozinho todo <form> que aparece na tela, sem mudar como o app envia:
//  · divide em etapas de 2 campos, com barra de progresso, Voltar e Próximo (Enter também avança)
//  · cursor no primeiro campo · máscara de WhatsApp/telefone e CPF · botões de opção rápida
//  · erro aparece embaixo do campo errado (validação do navegador e, via Etapas.erro, a do app/banco)
// Mesmo arquivo no SIGEP e no TNT Esportes; as cores vêm das variáveis do estilo.css (cores de Tonantins).
// Opções por atributo: <form data-etapas="nao"> (não divide) · <form data-etapas="blocos"> (cada fieldset.step é uma etapa)
//                      <input data-opcoes="A|B|C"> (botões rápidos; em data: "hoje|ontem")
(function () {
  const POR_ETAPA = 2
  const CAMPO = 'input:not([type=hidden]):not([type=button]):not([type=submit]), select, textarea'
  const sem = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
  const visivel = el => !el.closest('[hidden]')
  const hojeISO = (n = 0) => new Date(Date.now() - 4 * 36e5 - n * 864e5).toISOString().slice(0, 10)   // dia em Manaus

  // ---------- máscaras ----------
  const fone = v => { const d = v.replace(/\D/g, '').slice(0, 11)
    if (d.length <= 2) return d.length ? `(${d}` : ''
    if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`
    if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
    return `(${d.slice(0, 2)}) ${d.slice(2, 3)} ${d.slice(3, 7)}-${d.slice(7)}` }
  const cpf = v => { const d = v.replace(/\D/g, '').slice(0, 11)
    return d.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2') }
  const mascara = el => el.type === 'tel' ? fone : el.name === 'cpf' ? cpf : null

  // ---------- mensagens de erro em português ----------
  function mensagem(el) {
    const v = el.validity
    if (v.valueMissing) return el.type === 'checkbox' ? 'Marque esta opção para continuar.' : el.type === 'file' ? 'Envie a imagem.' : el.tagName === 'SELECT' ? 'Escolha uma opção.' : 'Preencha este campo.'
    if (v.typeMismatch) return el.type === 'email' ? 'E-mail inválido. Ex.: nome@gmail.com' : 'Formato inválido.'
    if (v.tooShort) return `Digite pelo menos ${el.minLength} caracteres.`
    if (v.rangeUnderflow) return el.type === 'date' ? `A data não pode ser antes de ${el.min.split('-').reverse().join('/')}.` : `O mínimo é ${el.min}.`
    if (v.rangeOverflow) return el.type === 'date' ? `A data não pode ser depois de ${el.max.split('-').reverse().join('/')}.` : `O máximo é ${el.max}.`
    if (v.patternMismatch) return el.title || 'Formato inválido.'
    if (v.badInput) return el.type === 'number' ? 'Digite só números.' : 'Valor inválido.'
    if (v.customError) return el.validationMessage
    return el.validationMessage
  }
  function marcar(unidade, msg) {
    limpar(unidade)
    if (!msg) return
    const el = unidade.matches(CAMPO) ? unidade : unidade.querySelector(CAMPO), id = 'et-erro-' + Math.random().toString(36).slice(2, 8)
    unidade.classList.add('et-invalido')
    const p = document.createElement('div'); p.className = 'et-erro'; p.id = id; p.setAttribute('role', 'alert'); p.textContent = msg
    unidade.appendChild(p)
    if (el) { el.setAttribute('aria-invalid', 'true'); el.setAttribute('aria-describedby', id) }
  }
  function limpar(unidade) {
    unidade.classList.remove('et-invalido'); unidade.querySelectorAll(':scope > .et-erro').forEach(e => e.remove())
    unidade.querySelectorAll('[aria-invalid]').forEach(e => { e.removeAttribute('aria-invalid'); e.removeAttribute('aria-describedby') })
  }
  const campos = u => [...(u.matches(CAMPO) ? [u] : u.querySelectorAll(CAMPO))].filter(e => !e.disabled)
  const unidadeValida = u => campos(u).every(e => e.checkValidity())
  const primeiroInvalido = u => campos(u).find(e => !e.checkValidity())

  // ---------- botões rápidos ----------
  function opcoes(form) {
    for (const sel of form.querySelectorAll('select:not([multiple]):not([data-et-chips])')) {
      const ops = [...sel.options].filter(o => o.value !== '')
      if (sel.disabled || ops.length < 2 || ops.length > 6 || ops.some(o => o.textContent.length > 34)) continue
      sel.dataset.etChips = ''
      const box = document.createElement('div'); box.className = 'et-chips'; box.setAttribute('role', 'radiogroup')
      const pinta = () => box.querySelectorAll('button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.v === sel.value)))
      for (const o of ops) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'et-chip'; b.dataset.v = o.value; b.textContent = o.textContent; b.setAttribute('role', 'radio')
        b.onclick = () => { sel.value = o.value; pinta(); sel.dispatchEvent(new Event('input', {bubbles: true})); sel.dispatchEvent(new Event('change', {bubbles: true})) }
        box.appendChild(b)
      }
      sel.classList.add('et-escondido'); sel.after(box); pinta()
      sel.addEventListener('change', pinta)
    }
    for (const el of form.querySelectorAll('[data-opcoes]:not([data-et-chips])')) {
      el.dataset.etChips = ''
      const box = document.createElement('div'); box.className = 'et-chips'
      for (const t of el.dataset.opcoes.split('|')) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'et-chip'
        const valor = el.type === 'date' ? (t === 'hoje' ? hojeISO() : t === 'ontem' ? hojeISO(1) : t) : t
        b.textContent = el.type === 'date' ? (t === 'hoje' ? 'Hoje' : t === 'ontem' ? 'Ontem' : t) : t
        b.onclick = () => { el.value = valor; el.dispatchEvent(new Event('input', {bubbles: true})); el.dispatchEvent(new Event('change', {bubbles: true})); el.focus() }
        box.appendChild(b)
      }
      el.after(box)
    }
  }

  // ---------- etapas ----------
  function melhorar(form) {
    if (form.dataset.et != null || form.classList.contains('acoes')) return
    form.dataset.et = ''
    form.noValidate = true
    opcoes(form)
    for (const el of form.querySelectorAll('input')) {
      const m = mascara(el); if (!m) continue
      if (el.type === 'tel') el.setAttribute('inputmode', 'tel'); else el.setAttribute('inputmode', 'numeric')
      if (el.value) el.value = m(el.value)
      el.addEventListener('input', () => { const fim = el.selectionStart === el.value.length; el.value = m(el.value); if (fim) el.setSelectionRange(el.value.length, el.value.length) })
    }
    const blocos = form.dataset.etapas === 'blocos'
    // unidade = rótulo (ou fieldset de caixinhas) com um campo dentro; avisos logo depois vão junto
    const todas = blocos ? [...form.querySelectorAll('fieldset.step')]
      : [...form.querySelectorAll('label, fieldset:not(.step)')].filter(u => u.querySelector(CAMPO) && !u.parentElement.closest('label, fieldset:not(.step)'))
    const envio = [...form.querySelectorAll('button:not([type=button]), input[type=submit]')].pop()
    const areaEnvio = envio && [...form.children].find(c => c.contains(envio))
    const st = {i: 0}
    form._et = st
    const atuais = () => todas.filter(visivel)
    const etapas = () => { const a = atuais(), n = blocos ? 1 : POR_ETAPA, out = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out }
    const divide = form.dataset.etapas !== 'nao' && (blocos ? todas.length > 1 : todas.filter(visivel).length > POR_ETAPA)

    // avisos (p.note / p.sub) logo depois de uma unidade aparecem e somem com ela
    const junto = new Map()
    for (const u of todas) { const lista = []; let n = u.nextElementSibling
      while (n && n.matches('p, .note, .sub') && !n.querySelector(CAMPO)) { lista.push(n); n = n.nextElementSibling }
      junto.set(u, lista) }

    let barra, nav, voltar, proximo, rotulo, preenchido, rodape
    if (divide) {
      barra = document.createElement('div'); barra.className = 'et-progresso span2'
      barra.innerHTML = '<div class="et-topo"><b></b><span></span></div><div class="et-trilho" role="progressbar" aria-valuemin="0" aria-valuemax="100"><i></i></div>'
      rotulo = barra.querySelector('b'); preenchido = barra.querySelector('span')
      form.prepend(barra)
      nav = document.createElement('div'); nav.className = 'et-nav span2'
      voltar = document.createElement('button'); voltar.type = 'button'; voltar.className = 'btn ghost'; voltar.textContent = '← Voltar'
      proximo = document.createElement('button'); proximo.type = 'button'; proximo.className = 'btn'; proximo.textContent = 'Próximo →'
      nav.append(voltar, proximo)
      if (areaEnvio) areaEnvio.before(nav); else form.append(nav)
      voltar.onclick = () => ir(st.i - 1, true)
      proximo.onclick = () => avancar()
    }
    rodape = document.createElement('div'); rodape.className = 'et-erro et-geral span2'; rodape.setAttribute('role', 'alert'); rodape.hidden = true
    if (areaEnvio) areaEnvio.before(rodape); else form.append(rodape)

    function mostrar() {
      if (!divide) return atualizarBarra()
      const ets = etapas(); st.i = Math.max(0, Math.min(st.i, ets.length - 1))
      const agora = new Set(ets[st.i] || [])
      for (const u of todas) { const on = !visivel(u) || agora.has(u); u.classList.toggle('et-oculto', !on); junto.get(u).forEach(n => n.classList.toggle('et-oculto', !on)) }
      // blocos (fieldset/div) sem nenhuma unidade da etapa somem; o resto do formulário fica
      for (const g of form.querySelectorAll('fieldset, div')) {
        if (g === nav || g === barra || g === rodape || g.contains(areaEnvio) || !todas.some(u => g.contains(u) && g !== u)) continue
        g.classList.toggle('et-oculto', !todas.some(u => g.contains(u) && agora.has(u)))
      }
      const ultima = st.i >= ets.length - 1
      voltar.hidden = st.i === 0; proximo.hidden = ultima
      if (areaEnvio) areaEnvio.classList.toggle('et-oculto', !ultima)
      rotulo.textContent = `Etapa ${st.i + 1} de ${ets.length}`
      atualizarBarra()
    }
    function atualizarBarra() {
      if (!barra) return
      const a = atuais(), ok = a.filter(u => campos(u).some(e => e.type === 'checkbox' ? e.checked : e.type === 'file' ? e.files.length : e.value !== '') && unidadeValida(u)).length
      const obrig = a.filter(u => campos(u).some(e => e.required) && !unidadeValida(u)).length
      const pct = a.length ? Math.round(ok / a.length * 100) : 0
      barra.querySelector('i').style.width = pct + '%'; barra.querySelector('[role=progressbar]').setAttribute('aria-valuenow', pct)
      const corrigir = form.querySelectorAll('.et-invalido').length
      preenchido.textContent = corrigir ? `corrija ${corrigir} campo${corrigir > 1 ? 's' : ''}` : obrig ? `faltam ${obrig} obrigatório${obrig > 1 ? 's' : ''}` : 'tudo certo ✓'
      preenchido.className = obrig || corrigir ? '' : 'et-ok'
    }
    function focar(u) {
      let el = u && (primeiroInvalido(u) || campos(u)[0]); if (!el) return
      if (el.classList.contains('et-escondido')) el = el.nextElementSibling?.querySelector('button') || el   // select virou botões
      el.focus({preventScroll: true}); el.closest('label, fieldset')?.scrollIntoView({block: 'nearest', behavior: 'smooth'})
    }
    function ir(i, foco) { st.i = i; rodape.hidden = true; mostrar(); if (foco) focar(etapas()[st.i]?.[0]) }
    const alvoDe = (u, el) => blocos ? el.closest('label') || u : u   // em blocos, o erro vai no rótulo do campo
    function validar(lista) {
      let primeiro = null
      for (const u of lista) {
        u.querySelectorAll('.et-invalido').forEach(limpar); limpar(u)
        const ruins = campos(u).filter(e => !e.checkValidity())
        for (const el of blocos ? ruins : ruins.slice(0, 1)) marcar(alvoDe(u, el), mensagem(el))
        if (ruins.length && !primeiro) primeiro = u
      }
      return primeiro
    }
    function avancar() {
      const ruim = validar(etapas()[st.i] || [])
      if (ruim) { atualizarBarra(); return focar(ruim) }
      ir(st.i + 1, true)
    }

    form.addEventListener('submit', e => {   // captura: roda antes do app
      if (divide && st.i < etapas().length - 1) { e.preventDefault(); e.stopImmediatePropagation(); return avancar() }
      const ruim = validar(atuais())
      if (ruim) {
        e.preventDefault(); e.stopImmediatePropagation()
        if (divide) { st.i = etapas().findIndex(et => et.includes(ruim)); mostrar() }
        focar(ruim)
      }
    }, true)
    form.addEventListener('input', e => { const m = e.target.closest?.('.et-invalido'); if (m && unidadeValida(m)) limpar(m); rodape.hidden = true; atualizarBarra() })
    form.addEventListener('change', () => { if (divide) mostrar(); else atualizarBarra() })   // campos que aparecem/somem (ex.: responsável do menor)
    form.addEventListener('focusout', e => {   // ao sair de um campo preenchido errado, já avisa
      const u = todas.find(x => x.contains(e.target)); if (!u || !e.target.matches?.(CAMPO) || e.target.value === '' || e.target.checkValidity()) return
      marcar(alvoDe(u, e.target), mensagem(e.target))
    })

    // erro do app/banco: embaixo do campo certo (por nome ou pelo texto do rótulo); senão, no fim da etapa
    st.erro = (msg, campo) => {
      let alvo = campo ? todas.find(u => campos(u).some(e => e.name === campo)) : null
      if (!alvo) { const m = sem(msg)
        alvo = atuais().find(u => campos(u).some(e => e.name && e.name.length > 3 && m.includes(sem(e.name))) ||
          campos(u).some(e => (e.dataset.erro || '').split('|').some(p => p && m.includes(sem(p)))) ||   // <input data-erro="número|camisa">
          (() => { const t = sem((u.firstChild?.textContent || u.querySelector('legend, span')?.textContent || '').replace(/\(.*\)|\*/g, '')); return t.length > 3 && m.includes(t) })()) }
      if (alvo) {
        if (divide) { st.i = Math.max(0, etapas().findIndex(et => et.includes(alvo))); mostrar() }
        const el = campo && campos(alvo).find(e => e.name === campo)
        marcar(el ? alvoDe(alvo, el) : alvo, msg); focar(alvo); atualizarBarra()
      } else { rodape.textContent = msg; rodape.hidden = false; rodape.scrollIntoView({block: 'nearest', behavior: 'smooth'}) }
      return true
    }

    mostrar()
    // cursor no primeiro campo, se nada estiver em foco e o formulário estiver à vista (não pula a página)
    const primeiro = divide ? etapas()[0]?.[0] : atuais()[0]
    const el = primeiro && campos(primeiro)[0]
    if (el && (document.activeElement === document.body || !document.activeElement) && !el.closest('.et-oculto')) {
      const r = el.getBoundingClientRect(); if (r.top >= 0 && r.bottom <= innerHeight && el.type !== 'file') el.focus({preventScroll: true})
    }
  }

  const varrer = raiz => { if (raiz.querySelectorAll) raiz.querySelectorAll('form').forEach(melhorar); if (raiz.tagName === 'FORM') melhorar(raiz) }
  window.Etapas = {
    // mostra o erro no formulário (campo certo ou fim da etapa). Devolve false se o formulário não está mais na tela.
    erro(form, msg, campo) { if (!form || !form.isConnected) return false; melhorar(form); return form._et.erro(msg, campo) },
    melhorar, fone, cpf,
  }
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return
  new MutationObserver(ms => { for (const m of ms) m.addedNodes.forEach(n => n.nodeType === 1 && varrer(n)) }).observe(document.documentElement, {childList: true, subtree: true})
  if (document.readyState !== 'loading') varrer(document); else document.addEventListener('DOMContentLoaded', () => varrer(document))
})()
