
-- ============================================================================
-- HighStation v1.9.0 Schema Repair Script
-- Description: Restores missing tables and permissions for Hybrid Architecture
-- ============================================================================

-- 1. Ensure provider_stats Table Exists (For Provider Portal Revenue/Calls)
CREATE TABLE IF NOT EXISTS public.provider_stats (
    provider_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    total_calls BIGINT DEFAULT 0,
    total_revenue_wei NUMERIC DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Ensure provider_performance_metrics Table Exists (For Discovery Hub Latency)
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

-- 3. Enable RLS
ALTER TABLE public.provider_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_performance_metrics ENABLE ROW LEVEL SECURITY;

-- 4. Policies
-- Provider Stats: Service Role Full Access, Providers View Own
DROP POLICY IF EXISTS "service_role_provider_stats" ON public.provider_stats;
CREATE POLICY "service_role_provider_stats" ON public.provider_stats FOR ALL TO service_role USING (true);

DROP POLICY IF EXISTS "providers_view_own_stats" ON public.provider_stats;
CREATE POLICY "providers_view_own_stats" ON public.provider_stats FOR SELECT TO authenticated USING (auth.uid() = provider_id);

-- Performance Metrics: Public Read, Service Role Write
DROP POLICY IF EXISTS "public_read_perf_metrics" ON public.provider_performance_metrics;
CREATE POLICY "public_read_perf_metrics" ON public.provider_performance_metrics FOR SELECT USING (true);

DROP POLICY IF EXISTS "service_role_perf_metrics" ON public.provider_performance_metrics;
CREATE POLICY "service_role_perf_metrics" ON public.provider_performance_metrics FOR ALL TO service_role USING (true);

-- 5. RPC Function for Provider Stats
-- Used by Provider Portal to get aggregated stats safely
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

-- 6. Grant Permissions to Service Role (and Authenticated/Anon where needed)
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT SELECT ON public.provider_performance_metrics TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.services TO service_role; -- IMPORTANT for backend
GRANT ALL ON public.developers TO service_role;
GRANT ALL ON public.wallets TO service_role;

-- 7. Fix Services Table Permissions (Crucial for 500 Error)
-- Providers need to select their own services
DROP POLICY IF EXISTS "providers_select_own_services" ON public.services;
CREATE POLICY "providers_select_own_services" ON public.services FOR SELECT TO authenticated USING (provider_id = auth.uid());

-- Discovery Public Access
DROP POLICY IF EXISTS "public_view_verified_services" ON public.services;
CREATE POLICY "public_view_verified_services" ON public.services FOR SELECT USING (status = 'verified');

-- 8. Notify PostgREST to reload schema
NOTIFY pgrst, 'reload config';
