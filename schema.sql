-- ==============================================================================
-- CITYMAP HUB - SCRIPT SQL DE CONFIGURAÇÃO DO BANCO DE DADOS SUPABASE
-- ==============================================================================
-- Instruções:
-- 1. Acesse seu painel no Supabase (https://app.supabase.com)
-- 2. Vá no menu "SQL Editor" (ícone de terminal / código na barra lateral esquerda)
-- 3. Clique em "New query", cole todo este código e clique em "Run" (botão verde)
-- ==============================================================================

-- 1. TABELA PRINCIPAL DE LEADS / ESTABELECIMENTOS
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

-- Índices para buscas ultrarrápidas
CREATE INDEX IF NOT EXISTS idx_leads_crm_stage ON public.leads (crm_stage);
CREATE INDEX IF NOT EXISTS idx_leads_commercial_segment ON public.leads (commercial_segment);
CREATE INDEX IF NOT EXISTS idx_leads_cnpj ON public.leads (cnpj);
CREATE INDEX IF NOT EXISTS idx_leads_follow_up_date ON public.leads (follow_up_date);
CREATE INDEX IF NOT EXISTS idx_leads_assigned_to ON public.leads (assigned_to);
CREATE INDEX IF NOT EXISTS idx_leads_assigned_supervisor_id ON public.leads (assigned_supervisor_id);

-- 2. TABELA DE HISTÓRICO DE INTERAÇÕES COM O LEAD
CREATE TABLE IF NOT EXISTS public.lead_interactions (
    id BIGSERIAL PRIMARY KEY,
    lead_id TEXT REFERENCES public.leads(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    user_email TEXT,
    action_type TEXT NOT NULL, -- 'status_change', 'note_added', 'visit', 'card_machine_update', 'follow_up'
    previous_value TEXT,
    new_value TEXT,
    details TEXT,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lead_interactions_lead_id ON public.lead_interactions (lead_id);

-- 3. TABELA DEDICADA DE CNPJS (RECEITA FEDERAL / FICHÁRIO)
CREATE TABLE IF NOT EXISTS public.cnpj_leads (
    cnpj VARCHAR(14) PRIMARY KEY,
    cnpj_formatted TEXT,
    razao_social TEXT NOT NULL,
    nome_fantasia TEXT,
    situacao TEXT DEFAULT 'ATIVA',
    data_abertura DATE,
    porte TEXT,
    capital_social NUMERIC(15,2) DEFAULT 0,
    cnae_principal TEXT,
    cnae_descricao TEXT,
    cnaes_secundarios JSONB DEFAULT '[]'::jsonb,
    faixa_receita_estimada TEXT,
    faturamento_estimado_central NUMERIC(15,2) DEFAULT 0,
    funcionarios_estimados INTEGER DEFAULT 0,
    logradouro TEXT,
    numero TEXT,
    complemento TEXT,
    bairro TEXT,
    cep TEXT,
    municipio TEXT DEFAULT 'FRANCA',
    uf TEXT DEFAULT 'SP',
    endereco_completo TEXT,
    telefone TEXT,
    email TEXT,
    socios JSONB DEFAULT '[]'::jsonb,
    simples_nacional BOOLEAN DEFAULT false,
    natureza_juridica TEXT,
    matched_lead_id TEXT REFERENCES public.leads(id) ON DELETE SET NULL,
    match_type TEXT,
    is_ghost_suspect BOOLEAN DEFAULT false,
    ghost_reason TEXT,
    ghost_count_at_address INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cnpj_leads_cnae ON public.cnpj_leads (cnae_principal);
CREATE INDEX IF NOT EXISTS idx_cnpj_leads_matched_lead ON public.cnpj_leads (matched_lead_id);
CREATE INDEX IF NOT EXISTS idx_cnpj_leads_ghost_suspect ON public.cnpj_leads (is_ghost_suspect);
CREATE INDEX IF NOT EXISTS idx_cnpj_leads_address_group ON public.cnpj_leads (logradouro, numero);

-- 3. TABELA DE USUÁRIOS DO SISTEMA E CONTROLE DE APROVAÇÃO (WHITELIST)
CREATE TABLE IF NOT EXISTS public.system_users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    full_name TEXT,
    status TEXT DEFAULT 'pending' NOT NULL, -- 'pending', 'approved', 'rejected'
    role TEXT DEFAULT 'agent' NOT NULL CHECK (role IN ('master', 'supervisor', 'agent', 'admin', 'seller')),
    supervisor_id UUID REFERENCES public.system_users(id) ON DELETE SET NULL,
    approved_by TEXT,
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_system_users_email ON public.system_users (email);
CREATE INDEX IF NOT EXISTS idx_system_users_status ON public.system_users (status);
CREATE INDEX IF NOT EXISTS idx_system_users_supervisor_id ON public.system_users (supervisor_id);

-- 4. TRIGGER AUTOMÁTICO PARA ATUALIZAR 'updated_at'
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS set_leads_updated_at ON public.leads;
CREATE TRIGGER set_leads_updated_at
    BEFORE UPDATE ON public.leads
    FOR EACH ROW
    EXECUTE PROCEDURE update_modified_column();

-- 5. FUNÇÕES AUXILIARES DE HIERARQUIA & SEGURANÇA
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

    SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();
    IF v_email = 'filipe.piani@gmail.com' THEN
        RETURN TRUE;
    END IF;

    RETURN FALSE;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- 6. SEGURANÇA (ROW LEVEL SECURITY - RLS)
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_users ENABLE ROW LEVEL SECURITY;

-- Políticas para Leitura de Leads por Hierarquia
DROP POLICY IF EXISTS "Permissao de visualizacao por hierarquia de leads" ON public.leads;
DROP POLICY IF EXISTS "Usuários autenticados podem ver todos os leads" ON public.leads;
DROP POLICY IF EXISTS "Leitura pública de leads para modo convidado" ON public.leads;

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

-- Políticas para Inserção e Edição de Leads
DROP POLICY IF EXISTS "Permissao de gravacao por hierarquia de leads" ON public.leads;
DROP POLICY IF EXISTS "Usuários autenticados podem inserir ou atualizar leads" ON public.leads;

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

-- Permitir acesso via Anon caso necessário para ferramentas automáticas
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

-- Políticas para Base de CNPJs (cnpj_leads)
ALTER TABLE public.cnpj_leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Acesso completo a cnpj_leads" ON public.cnpj_leads;
CREATE POLICY "Acesso completo a cnpj_leads"
    ON public.cnpj_leads FOR ALL
    TO authenticated, anon
    USING (true)
    WITH CHECK (true);

-- 7. HABILITAR ATUALIZAÇÕES EM TEMPO REAL (SUPABASE REALTIME)
-- Permite que quando um usuário se cadastrar ou for aprovado, o painel receba na hora via WebSockets!
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.leads, public.lead_interactions, public.system_users, public.cnpj_leads;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN
    CREATE PUBLICATION supabase_realtime FOR TABLE public.leads, public.lead_interactions, public.system_users, public.cnpj_leads;
END $$;
