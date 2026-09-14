/**
 * CONFIGURAÇÃO DO SUPABASE (BACKEND EM NUVEM)
 * 
 * Como obter suas credenciais gratuitas:
 * 1. Crie seu projeto em https://supabase.com (Gratuito)
 * 2. No painel do projeto, vá em: Settings (engrenagem) -> API
 * 3. Copie a "Project URL" e cole em 'url' abaixo
 * 4. Copie a "anon / public key" e cole em 'anonKey' abaixo
 * 5. Se preferir, você também pode colar diretamente pela interface do sistema!
 */

window.SUPABASE_CONFIG = {
  // Substitua pelos dados do seu projeto Supabase:
  url: localStorage.getItem('citymap_supabase_url') || '',
  anonKey: localStorage.getItem('citymap_supabase_key') || ''
};
