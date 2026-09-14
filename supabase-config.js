/**
 * CONFIGURAÇÃO DO SUPABASE (BACKEND EM NUVEM)
 * 
 * Como obter suas credenciais gratuitas:
 * 1. Crie seu projeto em https://supabase.com (Gratuito)
 * 2. No painel do projeto, vá em: Settings (engrenagem ⚙️) -> API
 * 3. Copie a "Project URL" (ex: https://xxxxxxxxxxxx.supabase.co) e cole em 'url' abaixo
 * 4. Copie a "anon / public key" (chave longa eyJhbGci...) e cole em 'anonKey' abaixo
 * 5. Se preferir, você também pode colar diretamente pela tela de login no ícone da engrenagem!
 */

window.SUPABASE_CONFIG = {
  // URL e Anon Key do seu projeto Supabase:
  url: localStorage.getItem('citymap_supabase_url') || '',
  anonKey: localStorage.getItem('citymap_supabase_key') || '',

  // Lista de Administradores Master com acesso total a configurações e carga de dados:
  adminEmails: [
    'filipe.piani@gmail.com'
  ]
};
