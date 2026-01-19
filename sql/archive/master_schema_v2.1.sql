-- ============================================================================
-- HIGHSTATION ULTIMATE MASTER SCHEMA V2.1
-- ============================================================================
-- "The Ultimate Source of Truth" for HighStation Database
--
-- Features:
-- 1. JSONB-Based Flexible Access Requirements (Extensible Gating)
-- 2. OpenSeal & ZK Integrity Layers
-- 3. Production-Ready Permissions (service_role prioritized)
-- 4. Atomic Financial Operations
--
-- Date: 2026-01-17
-- ============================================================================

BEGIN;

-- ============================================================================
-- SECTION 1: RESET & BASE CONFIG
-- ============================================================================
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO postgres;
GRANT ALL ON SCHEMA public TO public;

-- ============================================================================
-- SECTION 2: ENUM TYPES
-- ============================================================================
CREATE TYPE credit_grade_enum AS ENUM ('A', 'B', 'C', 'D', 'E', 'F');
CREATE TYPE service_status_enum AS ENUM ('pending', 'verified', 'rejected');
CREATE TYPE user_role_enum AS ENUM ('admin', 'provider');
CREATE TYPE wallet_status_enum AS ENUM ('Active', 'Banned', 'Suspended');
CREATE TYPE withdrawal_status_enum AS ENUM ('pending', 'completed', 'failed');

-- ============================================================================
-- SECTION 3: CORE TABLES
-- ============================================================================

-- 3.1 Profiles
CREATE TABLE profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT,
    role user_role_enum NOT NULL DEFAULT 'provider',
    reputation_score INTEGER DEFAULT 50,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ
);

-- 3.2 Services (Extensible Gating Structure)
CREATE TABLE services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    slug TEXT UNIQUE NOT NULL CHECK (slug ~ '^[a-z0-9-]+$'),
    name TEXT NOT NULL CHECK (length(name) >= 3),
    upstream_url TEXT NOT NULL,
    price_wei NUMERIC NOT NULL DEFAULT 0 CHECK (price_wei >= 0),
    
    -- [ARCHITECTURAL SHIFT]: Extensible Access Requirements
    access_requirements JSONB DEFAULT '{"min_grade": "F", "requires_openseal": false}'::JSONB,
    
    status service_status_enum NOT NULL DEFAULT 'pending',
    verification_token TEXT,
    verified_at TIMESTAMPTZ,
    signing_secret TEXT NOT NULL DEFAULT replace(cast(gen_random_uuid() as text), '-', ''),
    
    -- Discovery Hub Features
    category TEXT CHECK (length(category) <= 50),
    tags TEXT[] DEFAULT '{}'::TEXT[] CHECK (array_length(tags, 1) <= 10),
    description TEXT CHECK (length(description) <= 1000),
    capabilities JSONB DEFAULT '{}'::JSONB,
    search_vector TSVECTOR,
    
    -- OpenSeal Identity
    openseal_repo_url TEXT CHECK (openseal_repo_url ~* '^https://github\.com/'),
    openseal_root_hash TEXT,
    openseal_verified_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ
);

-- 3.3 Developers
CREATE TABLE developers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    github_id TEXT UNIQUE,
    global_debt_limit NUMERIC NOT NULL DEFAULT 0.1 CHECK (global_debt_limit > 0),
    reputation_score INTEGER NOT NULL DEFAULT 50 CHECK (reputation_score BETWEEN 0 AND 100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ
);

-- 3.4 Wallets
CREATE TABLE wallets (
    address TEXT PRIMARY KEY CHECK (address ~* '^0x[a-fA-F0-9]{40}$'),
    developer_id UUID REFERENCES developers(id) ON DELETE SET NULL,
    current_debt NUMERIC NOT NULL DEFAULT 0 CHECK (current_debt >= 0),
    status wallet_status_enum NOT NULL DEFAULT 'Active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ
);

-- 3.5 Requests
CREATE TABLE requests (
    id BIGSERIAL PRIMARY KEY,
    agent_id TEXT REFERENCES wallets(address) ON DELETE SET NULL,
    service_slug TEXT REFERENCES services(slug) ON DELETE SET NULL,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status INTEGER NOT NULL CHECK (status BETWEEN 100 AND 599),
    amount NUMERIC NOT NULL DEFAULT 0,
    tx_hash TEXT UNIQUE,
    endpoint TEXT NOT NULL,
    error TEXT,
    credit_grade credit_grade_enum,
    latency_ms INTEGER CHECK (latency_ms >= 0),
    response_size_bytes BIGINT DEFAULT 0,
    gas_used TEXT,
    content_type TEXT,
    integrity_check BOOLEAN DEFAULT FALSE,
    trust_signal JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3.6 Used Nonces
CREATE TABLE used_nonces (
    id BIGSERIAL PRIMARY KEY,
    nonce TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_nonce_per_agent UNIQUE (nonce, agent_id)
);

-- 3.7 Provider Stats
CREATE TABLE provider_stats (
    provider_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
    total_calls BIGINT DEFAULT 0,
    total_revenue_wei NUMERIC DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3.8 Performance Metrics
CREATE TABLE provider_performance_metrics (
    service_slug TEXT PRIMARY KEY REFERENCES public.services(slug) ON DELETE CASCADE,
    success_rate_7d NUMERIC DEFAULT 0,
    avg_latency_ms_7d NUMERIC DEFAULT 0,
    total_requests_7d BIGINT DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- SECTION 4: FUNCTIONS & TRIGGERS
-- ============================================================================

-- Function to update timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_profiles_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_services_updated_at BEFORE UPDATE ON services FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Atomic Provider Stats Calculation
CREATE OR REPLACE FUNCTION calculate_provider_stats(p_provider_id UUID)
RETURNS TABLE (total_calls BIGINT, total_revenue_wei NUMERIC) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(r.id)::BIGINT, 
        COALESCE(SUM(r.amount), 0)::NUMERIC
    FROM services s
    JOIN requests r ON s.slug = r.service_slug
    WHERE s.provider_id = p_provider_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Nonce Cleanup
CREATE OR REPLACE FUNCTION cleanup_expired_nonces()
RETURNS INTEGER AS $$
DECLARE deleted_count INTEGER;
BEGIN
    DELETE FROM used_nonces WHERE created_at < NOW() - INTERVAL '5 minutes';
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- SECTION 5: PERMISSIONS (The Critical Fix)
-- ============================================================================
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- RLS Configuration
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE used_nonces ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON profiles FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_all" ON services FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_all" ON requests FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_all" ON used_nonces FOR ALL TO service_role USING (true);

COMMIT;
