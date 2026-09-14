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
    updated_by_email TEXT,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Índices para buscas ultrarrápidas
CREATE INDEX IF NOT EXISTS idx_leads_crm_stage ON public.leads (crm_stage);
CREATE INDEX IF NOT EXISTS idx_leads_commercial_segment ON public.leads (commercial_segment);
CREATE INDEX IF NOT EXISTS idx_leads_cnpj ON public.leads (cnpj);
CREATE INDEX IF NOT EXISTS idx_leads_follow_up_date ON public.leads (follow_up_date);

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

-- 3. TRIGGER AUTOMÁTICO PARA ATUALIZAR 'updated_at'
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

-- 4. SEGURANÇA (ROW LEVEL SECURITY - RLS)
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_interactions ENABLE ROW LEVEL SECURITY;

-- Políticas para permitir que usuários autenticados leiam e atualizem todos os leads
DROP POLICY IF EXISTS "Usuários autenticados podem ver todos os leads" ON public.leads;
CREATE POLICY "Usuários autenticados podem ver todos os leads"
    ON public.leads FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Usuários autenticados podem inserir ou atualizar leads" ON public.leads;
CREATE POLICY "Usuários autenticados podem inserir ou atualizar leads"
    ON public.leads FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- Permitir leitura pública (opcional para demonstração sem login)
DROP POLICY IF EXISTS "Leitura pública de leads para modo convidado" ON public.leads;
CREATE POLICY "Leitura pública de leads para modo convidado"
    ON public.leads FOR SELECT
    TO anon
    USING (true);

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

-- 5. HABILITAR ATUALIZAÇÕES EM TEMPO REAL (SUPABASE REALTIME)
-- Permite que quando você alterar um status no celular, o PC receba a alteração na hora via WebSockets!
BEGIN;
  DROP PUBLICATION IF EXISTS supabase_realtime;
  CREATE PUBLICATION supabase_realtime FOR TABLE public.leads, public.lead_interactions;
COMMIT;
