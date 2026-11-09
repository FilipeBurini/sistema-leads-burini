-- ==============================================================================
-- CITYMAP HUB - SCRIPT COMPLETO DE CRIAÇÃO E MIGRAÇÃO HIERÁRQUICA (RBAC)
-- HIERARQUIA: MASTER 👑 -> SUPERVISOR 👔 -> AGENTE 👤
-- ==============================================================================
-- Instruções:
-- 1. Abra o painel do seu Supabase (https://app.supabase.com)
-- 2. No menu lateral esquerdo, vá em "SQL Editor" -> "New query"
-- 3. Limpe o editor, cole TODO este script e clique no botão verde "RUN"
-- ==============================================================================

-- 1. CRIAR OU ATUALIZAR A TABELA DE USUÁRIOS DO SISTEMA (system_users)
CREATE TABLE IF NOT EXISTS public.system_users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    full_name TEXT,
    status TEXT DEFAULT 'pending' NOT NULL, -- 'pending', 'approved', 'rejected'
    role TEXT DEFAULT 'agent' NOT NULL,    -- 'master', 'supervisor', 'agent'
    supervisor_id UUID,
    approved_by TEXT,
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Garantir colunas e chaves caso a tabela já existisse antes
ALTER TABLE public.system_users 
ADD COLUMN IF NOT EXISTS supervisor_id UUID REFERENCES public.system_users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_system_users_email ON public.system_users (email);
CREATE INDEX IF NOT EXISTS idx_system_users_status ON public.system_users (status);
CREATE INDEX IF NOT EXISTS idx_system_users_supervisor_id ON public.system_users (supervisor_id);

-- Ajustar restrição de papéis (roles) suportados
DO $$ 
BEGIN
    ALTER TABLE public.system_users DROP CONSTRAINT IF EXISTS system_users_role_check;
    ALTER TABLE public.system_users ADD CONSTRAINT system_users_role_check 
        CHECK (role IN ('master', 'supervisor', 'agent', 'admin', 'seller'));
EXCEPTION
    WHEN OTHERS THEN NULL;
END $$;

-- Garantir que seu e-mail principal já inicie como MASTER aprovado
UPDATE public.system_users 
SET role = 'master', status = 'approved' 
WHERE email = 'filipe.piani@gmail.com' OR role = 'admin';


-- 2. CRIAR OU ATUALIZAR A TABELA PRINCIPAL DE LEADS (leads)
CREATE TABLE IF NOT EXISTS public.leads (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT DEFAULT 'comercio',
    sub_category TEXT,
    commercial_segment TEXT DEFAULT 'outro',
    is_high_turnover BOOLEAN DEFAULT false,
    is_chain BOOLEAN DEFAULT false,
    address TEXT,
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    phone TEXT,
    whatsapp TEXT,
    hours TEXT,
    rating TEXT,
    photo TEXT,
    description TEXT,
    card_machine TEXT DEFAULT '',
    crm_stage TEXT DEFAULT 'lead',
    crm_notes TEXT DEFAULT '',
    follow_up_date DATE,
    follow_up_time TEXT,
    follow_up_notes TEXT DEFAULT '',
    visited BOOLEAN DEFAULT false,
    visited_at TIMESTAMPTZ,
    tags TEXT[] DEFAULT '{}',
    cnpj TEXT,
    cnae TEXT,
    data_abertura TEXT,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    assigned_supervisor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    assigned_by TEXT,
    assigned_at TIMESTAMPTZ,
    updated_by_email TEXT,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Adicionar colunas de carteira caso a tabela já existisse
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS assigned_supervisor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS assigned_by TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;

-- Índices de alta performance
CREATE INDEX IF NOT EXISTS idx_leads_crm_stage ON public.leads (crm_stage);
CREATE INDEX IF NOT EXISTS idx_leads_commercial_segment ON public.leads (commercial_segment);
CREATE INDEX IF NOT EXISTS idx_leads_cnpj ON public.leads (cnpj);
CREATE INDEX IF NOT EXISTS idx_leads_follow_up_date ON public.leads (follow_up_date);
CREATE INDEX IF NOT EXISTS idx_leads_assigned_to ON public.leads (assigned_to);
CREATE INDEX IF NOT EXISTS idx_leads_assigned_supervisor_id ON public.leads (assigned_supervisor_id);


-- 3. CRIAR OU ATUALIZAR A TABELA DE HISTÓRICO (lead_interactions)
CREATE TABLE IF NOT EXISTS public.lead_interactions (
    id BIGSERIAL PRIMARY KEY,
    lead_id TEXT REFERENCES public.leads(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    user_email TEXT,
    action_type TEXT NOT NULL,
    previous_value TEXT,
    new_value TEXT,
    details TEXT,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lead_interactions_lead_id ON public.lead_interactions (lead_id);


-- 4. FUNÇÕES AUXILIARES DE HIERARQUIA & SEGURANÇA
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT AS $$
DECLARE
    v_role TEXT;
BEGIN
    SELECT role INTO v_role 
    FROM public.system_users 
    WHERE id = auth.uid() 
    LIMIT 1;
    
    RETURN COALESCE(v_role, 'agent');
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.is_master_user()
RETURNS BOOLEAN AS $$
DECLARE
    v_role TEXT;
    v_email TEXT;
BEGIN
    v_role := public.current_user_role();
    IF v_role IN ('master', 'admin') THEN
        RETURN TRUE;
    END IF;

    -- Verificação por email cadastrado
    SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();
    IF v_email = 'filipe.piani@gmail.com' THEN
        RETURN TRUE;
    END IF;

    RETURN FALSE;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;


-- 5. POLÍTICAS DE SEGURANÇA POR LINHA (ROW LEVEL SECURITY - RLS)
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_users ENABLE ROW LEVEL SECURITY;

-- Limpar políticas antigas de leads
DROP POLICY IF EXISTS "Usuários autenticados podem ver todos os leads" ON public.leads;
DROP POLICY IF EXISTS "Leitura pública de leads para modo convidado" ON public.leads;
DROP POLICY IF EXISTS "Permissao de visualizacao por hierarquia de leads" ON public.leads;
DROP POLICY IF EXISTS "Leitura anonima de leads" ON public.leads;

-- Leitura por Hierarquia:
-- Master vê tudo. Supervisor vê sua equipe. Agente vê apenas sua carteira.
CREATE POLICY "Permissao de visualizacao por hierarquia de leads"
ON public.leads FOR SELECT
TO authenticated
USING (
    public.is_master_user() = true
    OR assigned_to = auth.uid()
    OR assigned_supervisor_id = auth.uid()
    OR assigned_to IN (SELECT id FROM public.system_users WHERE supervisor_id = auth.uid())
    OR assigned_to IS NULL
);

-- Gravação / Edição por Hierarquia
DROP POLICY IF EXISTS "Usuários autenticados podem inserir ou atualizar leads" ON public.leads;
DROP POLICY IF EXISTS "Permissao de gravacao por hierarquia de leads" ON public.leads;

CREATE POLICY "Permissao de gravacao por hierarquia de leads"
ON public.leads FOR ALL
TO authenticated
USING (
    public.is_master_user() = true
    OR assigned_to = auth.uid()
    OR assigned_supervisor_id = auth.uid()
    OR assigned_to IN (SELECT id FROM public.system_users WHERE supervisor_id = auth.uid())
    OR assigned_to IS NULL
)
WITH CHECK (
    public.is_master_user() = true
    OR assigned_to = auth.uid()
    OR assigned_supervisor_id = auth.uid()
    OR assigned_to IN (SELECT id FROM public.system_users WHERE supervisor_id = auth.uid())
    OR assigned_to IS NULL
);

-- Acesso Anônimo para inserção de dados via Scripts / Scraper
DROP POLICY IF EXISTS "Acesso Anonimo Scraper e Sincronizacao" ON public.leads;
CREATE POLICY "Acesso Anonimo Scraper e Sincronizacao"
ON public.leads FOR ALL
TO anon
USING (true)
WITH CHECK (true);

-- Políticas para Histórico
DROP POLICY IF EXISTS "Usuários autenticados podem ver histórico" ON public.lead_interactions;
CREATE POLICY "Usuários autenticados podem ver histórico"
    ON public.lead_interactions FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Usuários autenticados podem gravar histórico" ON public.lead_interactions;
CREATE POLICY "Usuários autenticados podem gravar histórico"
    ON public.lead_interactions FOR INSERT
    TO authenticated
    WITH CHECK (true);

-- Políticas para Gestão de Usuários (system_users)
DROP POLICY IF EXISTS "Usuários autenticados podem consultar usuários" ON public.system_users;
CREATE POLICY "Usuários autenticados podem consultar usuários"
    ON public.system_users FOR SELECT
    TO authenticated, anon
    USING (true);

DROP POLICY IF EXISTS "Qualquer usuário pode registrar seu pedido de acesso" ON public.system_users;
CREATE POLICY "Qualquer usuário pode registrar seu pedido de acesso"
    ON public.system_users FOR INSERT
    TO authenticated, anon
    WITH CHECK (true);

DROP POLICY IF EXISTS "Administradores podem atualizar status dos usuários" ON public.system_users;
CREATE POLICY "Administradores podem atualizar status dos usuários"
    ON public.system_users FOR ALL
    TO authenticated, anon
    USING (true)
    WITH CHECK (true);


-- 6. HABILITAR ATUALIZAÇÕES EM TEMPO REAL (SUPABASE REALTIME)
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.leads, public.lead_interactions, public.system_users;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN
    CREATE PUBLICATION supabase_realtime FOR TABLE public.leads, public.lead_interactions, public.system_users;
END $$;
