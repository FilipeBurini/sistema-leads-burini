-- ==============================================================================
-- CITYMAP HUB - CRIAÇÃO DA TABELA DEDICADA DE CNPJS (RECEITA FEDERAL / FICHÁRIO)
-- REQUISITOS:
-- 1. Tabela separada para CNPJs oficiais (public.cnpj_leads)
-- 2. Vínculo e cruzamento com public.leads para evitar duplicidade
-- 3. Detecção e sinalização de múltiplos CNPJs no mesmo endereço (Suspeita de Fantasma)
-- ==============================================================================
-- Instruções:
-- 1. Abra o painel do seu Supabase (https://app.supabase.com)
-- 2. No menu lateral esquerdo, vá em "SQL Editor" -> "New query"
-- 3. Limpe o editor, cole TODO este script e clique no botão verde "RUN"
-- ==============================================================================

-- 1. CRIAR A TABELA DEDICADA DE CNPJS
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
    match_type TEXT, -- 'cnpj', 'phone', 'name_address', 'none'
    is_ghost_suspect BOOLEAN DEFAULT false,
    ghost_reason TEXT,
    ghost_count_at_address INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Garantir colunas caso a tabela já existisse
ALTER TABLE public.cnpj_leads ADD COLUMN IF NOT EXISTS matched_lead_id TEXT REFERENCES public.leads(id) ON DELETE SET NULL;
ALTER TABLE public.cnpj_leads ADD COLUMN IF NOT EXISTS match_type TEXT;
ALTER TABLE public.cnpj_leads ADD COLUMN IF NOT EXISTS is_ghost_suspect BOOLEAN DEFAULT false;
ALTER TABLE public.cnpj_leads ADD COLUMN IF NOT EXISTS ghost_reason TEXT;
ALTER TABLE public.cnpj_leads ADD COLUMN IF NOT EXISTS ghost_count_at_address INTEGER DEFAULT 1;

-- 2. ÍNDICES DE PERFORMANCE E BUSCA RÁPIDA
CREATE INDEX IF NOT EXISTS idx_cnpj_leads_cnae ON public.cnpj_leads (cnae_principal);
CREATE INDEX IF NOT EXISTS idx_cnpj_leads_municipio ON public.cnpj_leads (municipio, uf);
CREATE INDEX IF NOT EXISTS idx_cnpj_leads_matched_lead ON public.cnpj_leads (matched_lead_id);
CREATE INDEX IF NOT EXISTS idx_cnpj_leads_ghost_suspect ON public.cnpj_leads (is_ghost_suspect);
CREATE INDEX IF NOT EXISTS idx_cnpj_leads_address_group ON public.cnpj_leads (logradouro, numero);
CREATE INDEX IF NOT EXISTS idx_cnpj_leads_phone ON public.cnpj_leads (telefone);

-- 3. HABILITAR ROW LEVEL SECURITY (RLS)
ALTER TABLE public.cnpj_leads ENABLE ROW LEVEL SECURITY;

-- Políticas de Leitura e Escrita
DROP POLICY IF EXISTS "Leitura irrestrita de cnpj_leads" ON public.cnpj_leads;
CREATE POLICY "Leitura irrestrita de cnpj_leads"
ON public.cnpj_leads FOR SELECT
TO authenticated, anon
USING (true);

DROP POLICY IF EXISTS "Modificacao irrestrita de cnpj_leads" ON public.cnpj_leads;
CREATE POLICY "Modificacao irrestrita de cnpj_leads"
ON public.cnpj_leads FOR ALL
TO authenticated, anon
USING (true)
WITH CHECK (true);

-- 4. ATUALIZAR PUBLICAÇÃO REALTIME (SUPABASE REALTIME)
DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.cnpj_leads;
EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN
        CREATE PUBLICATION supabase_realtime FOR TABLE public.cnpj_leads;
END $$;

