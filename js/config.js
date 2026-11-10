// Conexão com o banco (Supabase). Os dois valores são públicos por design:
// quem protege os dados são as regras do banco (RLS), não o segredo desta chave.
// NUNCA coloque aqui a "secret key" (sb_secret_...) nem a senha do banco.
// Projeto de teste (conta do André, região São Paulo). Trocar pelo da Prefeitura quando ela tiver conta própria.
const SUPABASE_URL = 'https://xpgiigdxouwlctjmmjen.supabase.co'
const SUPABASE_KEY = 'sb_publishable_ls2JByxvrR8zvPf8BbXfgA_gwisuYNq'
const NOME_INSTITUICAO = 'Prefeitura Municipal de Tonantins'
// cabeçalho da folha de frequência mensal entregue à SEMED (Frequência → Folha SEMED)
const FOLHA_SEMED = {destino: 'SECRETARIA MUNICIPAL DE FINANÇAS', secretaria: 'SECRETARIA MUNICIPAL DE EDUCAÇÃO',
  secretario: 'PAULO COSTA DA SILVA', cnpj: '33531210/0001-65'}
