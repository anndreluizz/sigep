// Conexão com o banco (Supabase). Os dois valores são públicos por design:
// quem protege os dados são as regras do banco (RLS), não o segredo desta chave.
// NUNCA coloque aqui a "secret key" (sb_secret_...) nem a senha do banco.
// Projeto de teste (conta do André, região São Paulo). Trocar pelo da Prefeitura quando ela tiver conta própria.
const SUPABASE_URL = 'https://xpgiigdxouwlctjmmjen.supabase.co'
const SUPABASE_KEY = 'sb_publishable_ls2JByxvrR8zvPf8BbXfgA_gwisuYNq'
const NOME_INSTITUICAO = 'Prefeitura Municipal de Tonantins'
