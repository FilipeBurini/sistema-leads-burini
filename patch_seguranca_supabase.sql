-- ==============================================================================
-- PATCH DE CORREÇÃO DE SEGURANÇA IMEDIATO - SUPABASE RLS
-- CityMap Hub - Mapeador Urbano & CRM
-- ==============================================================================
-- Execute este script no SQL Editor do Supabase (https://app.supabase.com)
-- Ele bloqueia a deleção anônima de leads e impede escalada de privilégios em system_users.
-- ==============================================================================

-- 1. BLOQUEAR DELEÇÃO/ALTERAÇÃO ANÔNIMA NA TABELA LEADS
DROP POLICY IF EXISTS "Acesso Anonimo Scraper e Sincronizacao" ON public.leads;
DROP POLICY IF EXISTS "Leitura anonima de leads" ON public.leads;
DROP POLICY IF EXISTS "Insercao de leads via scraper" ON public.leads;

-- Anônimos podem apenas consultar e inserir leads via Scraper, NUNCA alterar ou apagar:
CREATE POLICY "Leitura anonima de leads"
ON public.leads FOR SELECT
TO anon
USING (true);

CREATE POLICY "Insercao de leads via scraper"
ON public.leads FOR INSERT
TO anon
WITH CHECK (true);

-- 2. BLOQUEAR ESCALADA DE PRIVILÉGIOS NA TABELA SYSTEM_USERS
DROP POLICY IF EXISTS "Administradores podem atualizar status dos usuários" ON public.system_users;
DROP POLICY IF EXISTS "Apenas Master pode atualizar status e cargos" ON public.system_users;
DROP POLICY IF EXISTS "Apenas Master pode excluir usuários" ON public.system_users;

-- Somente o Master autenticado tem permissão para alterar cargos ou aprovar contas:
CREATE POLICY "Apenas Master pode atualizar status e cargos"
ON public.system_users FOR UPDATE
TO authenticated
USING (public.is_master_user() = true)
WITH CHECK (public.is_master_user() = true);

-- Somente o Master autenticado tem permissão para excluir usuários:
CREATE POLICY "Apenas Master pode excluir usuários"
ON public.system_users FOR DELETE
TO authenticated
USING (public.is_master_user() = true);

-- 3. CONFIRMAR QUE O SEU E-MAIL CONTINUA MASTER APROVADO
UPDATE public.system_users 
SET role = 'master', status = 'approved' 
WHERE email = 'filipe.piani@gmail.com';

