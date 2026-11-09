// Conexão com o banco (Supabase). Os dois valores são públicos por design:
// quem protege os dados são as regras do banco (RLS), não o segredo desta chave.
// NUNCA coloque aqui a "secret key" (sb_secret_...) nem a senha do banco.
const SUPABASE_URL = ''   // ex.: https://xxxx.supabase.co — preencher quando a conta da Prefeitura existir
const SUPABASE_KEY = ''   // ex.: sb_publishable_...
const NOME_INSTITUICAO = 'Prefeitura Municipal'
