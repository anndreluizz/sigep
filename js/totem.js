// SIGEP · totem: tablet com câmera frontal no setor. Lê o QR do crachá e chama registrar_batida()
// no banco (que decide entrada/saída e confere setor, situação e o intervalo mínimo).
// Sem internet: guarda a batida no tablet e envia quando a conexão volta. No envio vai só a IDADE
// da batida em segundos (medida no tablet); o banco grava a hora dele menos a idade, então um
// relógio errado no tablet não muda nada.

/* ============================== fila sem internet ============================== */
const CHAVE_FILA = 'sigep-fila-totem'
const MAXIMO_NA_FILA = 2000
const TEMPO_LIMITE_MS = 8000

function criarFila(sb, armazenamento, agora = () => Date.now()) {
  const ler = () => { try { return JSON.parse(armazenamento.getItem(CHAVE_FILA)) || [] } catch { return [] } }
  const gravar = f => { try { armazenamento.setItem(CHAVE_FILA, JSON.stringify(f)); return true } catch { return false } }
  let enviando = null   // envio em andamento: quem chamar de novo espera o mesmo

  // tenta de novo depois (fica na fila): sem código = não chegou ao banco (sem internet, tempo esgotado);
  // SG401 = totem desativado e PGRST3xx = login vencido: as batidas guardadas não podem se perder
  const semRede = e => !e.code || e.code === 'SG401' || /^PGRST3/.test(e.code)
  const comPrazo = p => Promise.race([p, new Promise(r => setTimeout(() => r({error: {message: 'tempo esgotado'}}), TEMPO_LIMITE_MS))])
  const registrar = (codigo, idade = 0) => comPrazo(sb.rpc('registrar_batida', {p_codigo: codigo, p_idade_segundos: idade}))

  function guardar(codigo) {
    const f = ler()
    if (f.length >= MAXIMO_NA_FILA) return false
    f.push({codigo, lido_em: agora()})
    return gravar(f)
  }

  // envia a mais antiga primeiro; recusa do banco (crachá bloqueado, repetida, mês fechado) sai da fila
  function enviar() {
    return enviando ??= (async () => {
      for (let f = ler(); f.length; f = ler()) {
        const item = f[0], idade = Math.max(0, Math.round((agora() - item.lido_em) / 1000))
        const {error} = await registrar(item.codigo, idade)
        if (error && semRede(error)) break
        const resto = ler()
        if (resto.length && resto[0].lido_em === item.lido_em && resto[0].codigo === item.codigo) resto.shift()
        gravar(resto)
      }
    })().finally(() => { enviando = null })
  }

  // -> {ok, guardada, dados | erro}
  async function bater(codigo) {
    // ainda há batidas antigas: esta vai para o fim da fila, senão chegaria antes delas e a
    // entrada/saída sairia trocada
    if (ler().length) {
      if (!guardar(codigo)) return {ok: false, erro: 'Memória do totem cheia. Chame o RH.'}
      enviar()
      return {ok: true, guardada: true}
    }
    const {data, error} = await registrar(codigo)
    if (!error) return {ok: true, dados: data}
    if (error.code === 'SG401' || !semRede(error)) return {ok: false, erro: error.message}   // totem desativado: não acumula batida nova
    if (!guardar(codigo)) return {ok: false, erro: 'Sem internet e sem espaço para guardar. Chame o RH.'}
    return {ok: true, guardada: true}
  }

  return {bater, enviar, pendentes: () => ler().length}
}

/* ============================== tela ============================== */
const RESFRIAMENTO_MESMO_CODIGO_MS = 10000   // maior que o intervalo do banco (8 s): segurar o crachá não dá erro
const LARGURA_PROCESSAMENTO = 480
const CHAVE_PERFIL = 'sigep-totem-perfil'

function iniciarTotem(sb) {
  const $ = s => document.querySelector(s)
  const fila = criarFila(sb, localStorage)
  const video = $('#video'), canvas = document.createElement('canvas'), ctx = canvas.getContext('2d', {willReadFrequently: true})
  let ocupado = false, ultimo = null, ultimoEm = 0, loop = false, audio = null

  const tela = id => document.querySelectorAll('.t-tela').forEach(t => t.hidden = t.id !== id)
  const relogio = () => {
    const d = new Date()
    $('#relogio').textContent = d.toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'})
    $('#data').textContent = d.toLocaleDateString('pt-BR', {weekday: 'long', day: 'numeric', month: 'long'})
  }
  setInterval(relogio, 1000); relogio()

  function avisoFila() {
    const n = fila.pendentes()
    $('#fila').hidden = !n
    $('#fila').textContent = `⟳ ${n} batida${n > 1 ? 's' : ''} guardada${n > 1 ? 's' : ''}, enviando quando a internet voltar`
  }
  const enviar = () => fila.enviar().finally(avisoFila)
  setInterval(enviar, 30000); addEventListener('online', enviar)

  function beep(ok) {
    try {
      audio ??= new (window.AudioContext || window.webkitAudioContext)()
      const o = audio.createOscillator(), g = audio.createGain()
      o.frequency.value = ok ? 880 : 220; g.gain.value = 0.15
      o.connect(g); g.connect(audio.destination); o.start(); o.stop(audio.currentTime + 0.18)
    } catch {}   // sem som, o ponto vale do mesmo jeito
  }

  function resposta(ok, titulo, sub) {
    const r = $('#resposta')
    r.className = 'resposta ' + (ok ? 'ok' : 'erro'); r.hidden = false
    $('#r-icone').textContent = ok ? '✓' : '✕'; $('#r-titulo').textContent = titulo; $('#r-sub').textContent = sub || ''
    beep(ok)
    setTimeout(() => { r.hidden = true; ocupado = false }, ok ? 3000 : 6000)   // erro fica mais tempo: dá para ler o motivo
  }

  async function lido(codigo) {
    ocupado = true
    const r = await fila.bater(codigo)
    avisoFila()
    const hora = new Date().toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'})
    if (!r.ok) return resposta(false, 'Não foi possível registrar', r.erro)
    if (r.guardada) return resposta(true, `Batida guardada às ${hora}`, 'Sem internet agora. O totem envia sozinho quando voltar.')
    const d = r.dados, h = new Date(d.em).toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'})
    resposta(true, d.nome, `${d.tipo === 'entrada' ? 'Entrada' : 'Saída'} registrada às ${h}${d.tipo === 'entrada' ? ' · bom trabalho!' : ' · até logo!'}`)
  }

  function quadro() {
    requestAnimationFrame(quadro)
    if (ocupado || video.readyState !== video.HAVE_ENOUGH_DATA) return
    canvas.width = LARGURA_PROCESSAMENTO; canvas.height = video.videoHeight * LARGURA_PROCESSAMENTO / video.videoWidth
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height), qr = jsQR(img.data, img.width, img.height)
    const codigo = qr?.data?.trim()
    if (!codigo || (codigo === ultimo && Date.now() - ultimoEm < RESFRIAMENTO_MESMO_CODIGO_MS)) return
    ultimo = codigo; ultimoEm = Date.now()
    lido(codigo)
  }

  const ERROS_CAMERA = {
    NotAllowedError: 'O navegador bloqueou a câmera. Toque no cadeado da barra de endereço, permita a câmera e toque em Iniciar de novo.',
    NotFoundError: 'Nenhuma câmera foi encontrada neste aparelho.',
    NotReadableError: 'A câmera está sendo usada por outro aplicativo. Feche-o e toque em Iniciar de novo.'}
  const telaLigada = () => navigator.wakeLock?.request('screen').catch(() => {})   // sem isso a tela apaga e a câmera para

  async function abrirCamera() {
    try {
      if (!navigator.mediaDevices) throw {name: 'NotFoundError'}
      const stream = await navigator.mediaDevices.getUserMedia({video: {facingMode: 'user'}, audio: false})
      stream.getVideoTracks().forEach(t => t.addEventListener('ended', () => { if (!document.hidden) abrirCamera() }))
      video.srcObject = stream; await video.play()
      document.documentElement.requestFullscreen?.().catch(() => {})
      $('#erro-camera').hidden = true; tela('t-camera'); telaLigada()
      if (!loop) { loop = true; requestAnimationFrame(quadro) }
    } catch (e) {
      $('#erro-camera').textContent = ERROS_CAMERA[e?.name] || 'Não foi possível abrir a câmera. Toque em Iniciar para tentar de novo.'
      $('#erro-camera').hidden = false
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || $('#t-camera').hidden) return
    telaLigada()   // voltando de tela apagada: renova o bloqueio e a câmera se ela morreu
    if (!video.srcObject?.getVideoTracks().some(t => t.readyState === 'live')) abrirCamera()
  })

  // perfil do totem: confere no banco; sem internet, usa o último deste aparelho
  async function perfil(user) {
    const {data, error} = await sb.from('perfis').select('nome, papel, setor_id, ativo').eq('id', user.id)
    if (error && !error.code) { try { const p = JSON.parse(localStorage.getItem(CHAVE_PERFIL)); if (p?.uid === user.id) return p } catch {} }
    const p = data?.[0]
    if (!p || p.papel !== 'totem' || !p.ativo) return null
    const {data: s} = await sb.from('setores').select('nome').eq('id', p.setor_id)
    const r = {uid: user.id, nome: p.nome, setor: s?.[0]?.nome || ''}
    try { localStorage.setItem(CHAVE_PERFIL, JSON.stringify(r)) } catch {}
    return r
  }

  async function pronto(user) {
    const p = await perfil(user)
    if (!p) {
      await sb.auth.signOut()
      $('#erro-login').textContent = 'Esta conta não é de totem (ou foi desativada). O RH gera o acesso de totem em Acessos.'
      $('#erro-login').hidden = false
      return tela('t-login')
    }
    $('#setor').textContent = `● ${p.setor} · ${p.nome}`
    $('#inicio-setor').textContent = p.setor
    tela('t-inicio'); avisoFila(); enviar()
  }

  $('#form-login').addEventListener('submit', async ev => {
    ev.preventDefault()
    const f = ev.target, {data, error} = await sb.auth.signInWithPassword({email: f.email.value.trim(), password: f.senha.value})
    if (error) { $('#erro-login').textContent = /Invalid login/i.test(error.message) ? 'E-mail ou senha incorretos.' : error.message; $('#erro-login').hidden = false; return }
    $('#erro-login').hidden = true; f.reset(); pronto(data.user)
  })
  $('#iniciar').addEventListener('click', abrirCamera)

  // engrenagem: dois toques em 3 s, para um toque por engano não tirar o totem do ar
  let armado = 0
  $('#sair').addEventListener('click', async () => {
    if (Date.now() - armado > 3000) { armado = Date.now(); $('#sair').classList.add('armado'); setTimeout(() => $('#sair').classList.remove('armado'), 3000); return }
    if (fila.pendentes()) return resposta(false, 'Ainda há batidas guardadas', 'Espere a internet voltar e as batidas serem enviadas antes de sair.')
    if (!confirm('Desconectar este totem? Será preciso entrar de novo com a conta do totem.')) return
    video.srcObject?.getTracks().forEach(t => t.stop())
    await sb.auth.signOut(); tela('t-login')
  })

  sb.auth.getSession().then(({data}) => data.session ? pronto(data.session.user) : tela('t-login'))
}

if (typeof module !== 'undefined') module.exports = {criarFila}
