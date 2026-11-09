// Modo demonstração: imita o pedaço do supabase-js que o app usa, rodando o MESMO banco
// (supabase/migrations) num Postgres dentro do navegador (PGlite). As regras (RLS) valem igual.
// Serve para testar as telas sem conta no Supabase. Os dados somem ao recarregar a página.
// ponytail: só o subconjunto do supabase-js que app.js usa (select/eq/in/order/insert/update/delete/rpc).

const MIGRACOES = ['20261109000000_inicial.sql']

const AUTH_SUPABASE = `
  create schema auth; create table auth.users (id uuid primary key, email text unique, senha text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create role anon nologin; create role authenticated nologin;
  grant usage on schema public, auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;`

const ident = s => { if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error('nome inválido: ' + s); return s }
const colunas = c => c.trim() === '*' ? '*' : c.split(',').map(x => ident(x.trim())).join(', ')

async function criarClienteLocal(PGlite, lerMigracao) {
  // datas como texto, igual ao Supabase (PostgREST) devolve
  const iso = v => v.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00')
  const db = new PGlite({parsers: {1082: v => v, 1083: v => v, 1114: iso, 1184: iso}})
  await db.exec(AUTH_SUPABASE)
  for (const m of MIGRACOES) await db.exec(await lerMigracao(m))
  let sessao = null
  const ouvintes = []
  const avisar = ev => ouvintes.forEach(f => f(ev, sessao))

  // roda como o usuário logado (ou anon), igual ao PostgREST
  const comoUsuario = (sql, params) => db.transaction(async tx => {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [sessao?.user.id || ''])
    await tx.exec(`set local role ${sessao ? 'authenticated' : 'anon'}`)
    return (await tx.query(sql, params)).rows
  })
  const resultado = async f => { try { return {data: await f(), error: null} } catch (e) { return {data: null, error: {message: e.message, code: e.code}} } }

  function from(tabela) {
    ident(tabela)
    const st = {op: 'select', cols: '*', filtros: [], ordem: [], dados: null, retorna: null}
    const where = p => st.filtros.length ? ' where ' + st.filtros.map(([c, op, v]) => {
      if (op === 'in') { p.push(v); return `${c} = any($${p.length})` }
      if (v === null) return `${c} is null`
      p.push(v); return `${c} = $${p.length}`
    }).join(' and ') : ''
    const valor = v => v !== null && typeof v === 'object' && !Array.isArray(v) ? JSON.stringify(v) : v
    const exec = () => {
      const p = []
      if (st.op === 'select')
        return comoUsuario(`select ${colunas(st.cols)} from ${tabela}${where(p)}` +
          (st.ordem.length ? ' order by ' + st.ordem.map(([c, asc]) => `${c} ${asc ? 'asc' : 'desc'}`).join(', ') : ''), p)
      const ret = st.retorna ? ` returning ${colunas(st.retorna)}` : ''
      if (st.op === 'insert') {
        const linhas = [].concat(st.dados), cols = Object.keys(linhas[0]).map(ident)
        const vals = linhas.map(l => '(' + cols.map(c => { p.push(valor(l[c] ?? null)); return `$${p.length}` }).join(', ') + ')')
        return comoUsuario(`insert into ${tabela} (${cols.join(', ')}) values ${vals.join(', ')}${ret}`, p)
      }
      if (st.op === 'update') {
        const sets = Object.entries(st.dados).map(([c, v]) => { p.push(valor(v)); return `${ident(c)} = $${p.length}` })
        return comoUsuario(`update ${tabela} set ${sets.join(', ')}${where(p)}${ret}`, p)
      }
      return comoUsuario(`delete from ${tabela}${where(p)}${ret}`, p)
    }
    const b = {
      select(c = '*') { if (st.op === 'select') st.cols = c; else st.retorna = c; return b },
      insert(d) { st.op = 'insert'; st.dados = d; return b },
      update(d) { st.op = 'update'; st.dados = d; return b },
      delete() { st.op = 'delete'; return b },
      eq(c, v) { st.filtros.push([ident(c), '=', v]); return b },
      in(c, v) { st.filtros.push([ident(c), 'in', v]); return b },
      order(c, o = {}) { st.ordem.push([ident(c), o.ascending !== false]); return b },
      then(ok, falha) { return resultado(exec).then(ok, falha) },
    }
    return b
  }

  async function rpc(fn, args = {}) {
    ident(fn)
    const nomes = Object.keys(args).map(ident)
    return resultado(async () => {
      const rows = await comoUsuario(`select * from ${fn}(${nomes.map((n, i) => `${n} => $${i + 1}`).join(', ')})`, nomes.map(n => args[n]))
      const tipo = (await db.query(`select proretset, prorettype::regtype::text t from pg_proc where proname = $1`, [fn])).rows[0]
      if (tipo.proretset) return rows
      return rows.length === 1 && Object.keys(rows[0]).length === 1 && fn in rows[0] ? rows[0][fn] : rows[0]
    })
  }

  const auth = {
    async signInWithPassword({email, password}) {
      const u = (await db.query('select id, email, senha from auth.users where email = $1', [email.toLowerCase()])).rows[0]
      if (!u || u.senha !== password) return {data: {}, error: {message: 'Invalid login credentials'}}
      sessao = {user: {id: u.id, email: u.email}}; avisar('SIGNED_IN'); return {data: {user: sessao.user, session: sessao}, error: null}
    },
    async signUp({email, password}) {
      if (password.length < 8) return {data: {}, error: {message: 'Password should be at least 8 characters.'}}
      try { await db.query('insert into auth.users (id, email, senha) values (gen_random_uuid(), $1, $2)', [email.toLowerCase(), password]) }
      catch { return {data: {}, error: {message: 'User already registered'}} }
      return auth.signInWithPassword({email, password})
    },
    async signOut() { sessao = null; avisar('SIGNED_OUT'); return {error: null} },
    async getSession() { return {data: {session: sessao}, error: null} },
    onAuthStateChange(f) { ouvintes.push(f); return {data: {subscription: {unsubscribe() {}}}} },
  }

  // atalho da demonstração: SQL como dono do banco (para semear dados de exemplo)
  return {from, rpc, auth, _db: db}
}

// dados de exemplo da demonstração: um RH, uma chefe, o Prefeito, uma servidora e um totem (senha de todos: demo1234)
async function semearDemo(cliente) {
  const db = cliente._db
  await db.exec(`
    insert into auth.users (id, email, senha) values
      ('00000000-0000-4000-8000-000000000001', 'rh@demo', 'demo1234'),
      ('00000000-0000-4000-8000-000000000002', 'chefe@demo', 'demo1234'),
      ('00000000-0000-4000-8000-000000000003', 'prefeito@demo', 'demo1234'),
      ('00000000-0000-4000-8000-000000000004', 'servidor@demo', 'demo1234'),
      ('00000000-0000-4000-8000-000000000005', 'totem@demo', 'demo1234');
    insert into setores (id, nome) values
      ('10000000-0000-4000-8000-000000000001', 'E.M. São Francisco de Assis'),
      ('10000000-0000-4000-8000-000000000002', 'Secretaria de Saúde – UBS Central'),
      ('10000000-0000-4000-8000-000000000003', 'Secretaria de Obras');
    insert into turnos (id, nome, entrada, saida, dias_semana) values
      ('20000000-0000-4000-8000-000000000001', 'Matutino', '07:00', '11:30', '{1,2,3,4,5}'),
      ('20000000-0000-4000-8000-000000000002', 'Integral', '07:00', '17:00', '{1,2,3,4,5}'),
      ('20000000-0000-4000-8000-000000000003', 'Plantão 24 h', '07:00', '07:00', '{0,1,2,3,4,5,6}');
    update turnos set saida_almoco = '11:00', retorno_almoco = '13:00' where nome = 'Integral';
    insert into escalas (id, nome, turno_id, dias_trabalho, dias_descanso) values
      ('30000000-0000-4000-8000-000000000001', 'Vigia 24×72', '20000000-0000-4000-8000-000000000003', 1, 3);
    insert into servidores (id, matricula, nome, cargo, setor_id, turno_id, vinculo, cpf) values
      ('40000000-0000-4000-8000-000000000001', '0101', 'Ana Paula Ferreira', 'Professora', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'efetivo', '12345678901'),
      ('40000000-0000-4000-8000-000000000002', '0102', 'Carlos Eduardo Lima', 'Aux. serviços gerais', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'contratado', null),
      ('40000000-0000-4000-8000-000000000003', '0215', 'Rita de Cássia Melo', 'Técnica de enfermagem', '10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'efetivo', null),
      ('40000000-0000-4000-8000-000000000004', '0330', 'Paulo Henrique Dias', 'Motorista', '10000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000002', 'efetivo', null);
    insert into servidores (matricula, nome, cargo, setor_id, escala_id, escala_inicio, vinculo) values
      ('0105', 'Marta Oliveira', 'Vigia', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '2026-11-01', 'efetivo');
    insert into perfis (id, nome, papel, setor_id, servidor_id) values
      ('00000000-0000-4000-8000-000000000001', 'Setor de RH', 'rh', null, null),
      ('00000000-0000-4000-8000-000000000002', 'Gestora da escola', 'chefe', '10000000-0000-4000-8000-000000000001', null),
      ('00000000-0000-4000-8000-000000000003', 'Prefeito', 'prefeito', null, null),
      ('00000000-0000-4000-8000-000000000004', 'Ana Paula Ferreira', 'servidor', null, '40000000-0000-4000-8000-000000000001'),
      ('00000000-0000-4000-8000-000000000005', 'Totem 1 – Escola', 'totem', '10000000-0000-4000-8000-000000000001', null);`)
}

if (typeof module !== 'undefined') module.exports = {criarClienteLocal, semearDemo}
