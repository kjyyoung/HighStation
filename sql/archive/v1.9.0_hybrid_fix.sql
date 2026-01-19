
-- 
-- HighStation DB Schema (v1.9.1 Hybrid Architecture)
-- Single Source of Truth
-- 

-- ============================================================================
-- SECTION 1: TABLES
-- ============================================================================

-- [Users, Providers, Services, etc. assumed to be defined in previous sections of schema_latest]
-- [Appending missing tables and fixes]

-- Ensure provider_stats Table (For Provider Portal Revenue/Calls)
CREATE TABLE IF NOT EXISTS public.provider_stats (
    provider_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    total_calls BIGINT DEFAULT 0,
    total_revenue_wei NUMERIC DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure provider_performance_metrics Table (For Discovery Hub Latency)
CREATE TABLE IF NOT EXISTS public.provider_performance_metrics (
    service_slug TEXT PRIMARY KEY REFERENCES public.services(slug) ON DELETE CASCADE,
    total_requests BIGINT DEFAULT 0,
    total_successes BIGINT DEFAULT 0,
    avg_latency_ms_7d NUMERIC DEFAULT 0,
    success_rate_7d NUMERIC DEFAULT 0,
    total_requests_7d BIGINT DEFAULT 0,
    avg_latency_ms_1k NUMERIC DEFAULT 0,
    success_rate_1k NUMERIC DEFAULT 0,
    unique_agent_count INTEGER DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- SECTION 2: RLS POLICIES & PERMISSIONS (Hybrid Architecture Fixes)
-- ============================================================================

ALTER TABLE public.provider_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_performance_metrics ENABLE ROW LEVEL SECURITY;

-- Provider Stats Policies
DROP POLICY IF EXISTS "service_role_provider_stats" ON public.provider_stats;
CREATE POLICY "service_role_provider_stats" ON public.provider_stats FOR ALL TO service_role USING (true);

DROP POLICY IF EXISTS "providers_view_own_stats" ON public.provider_stats;
CREATE POLICY "providers_view_own_stats" ON public.provider_stats FOR SELECT TO authenticated USING (auth.uid() = provider_id);

-- Performance Metrics Policies
DROP POLICY IF EXISTS "public_read_perf_metrics" ON public.provider_performance_metrics;
CREATE POLICY "public_read_perf_metrics" ON public.provider_performance_metrics FOR SELECT USING (true);

DROP POLICY IF EXISTS "service_role_perf_metrics" ON public.provider_performance_metrics;
CREATE POLICY "service_role_perf_metrics" ON public.provider_performance_metrics FOR ALL TO service_role USING (true);

-- Services Table Permissions (Crucial for 500 Error Fix)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.services TO service_role;
DROP POLICY IF EXISTS "providers_select_own_services" ON public.services;
CREATE POLICY "providers_select_own_services" ON public.services FOR SELECT TO authenticated USING (provider_id = auth.uid());

DROP POLICY IF EXISTS "public_view_verified_services" ON public.services;
CREATE POLICY "public_view_verified_services" ON public.services FOR SELECT USING (status = 'verified');

-- Grant Permissions to Service Role
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT SELECT ON public.provider_performance_metrics TO anon, authenticated;
GRANT ALL ON public.developers TO service_role;
GRANT ALL ON public.wallets TO service_role;

-- ============================================================================
-- SECTION 3: RPC FUNCTIONS
-- ============================================================================

-- Calculate Provider Stats (Safe Aggregation)
CREATE OR REPLACE FUNCTION calculate_provider_stats(p_provider_id UUID)
RETURNS TABLE (
    total_calls BIGINT,
    total_revenue_wei NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COALESCE(s.total_calls, 0), 
        COALESCE(s.total_revenue_wei, 0)
    FROM provider_stats s
    WHERE s.provider_id = p_provider_id;
    
    IF NOT FOUND THEN
        RETURN QUERY SELECT 0::BIGINT, 0::NUMERIC;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- VALIDATION
-- ============================================================================
NOTIFY pgrst, 'reload config';
