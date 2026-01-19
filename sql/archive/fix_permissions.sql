-- FIX: Grant permissions to authenticated users for services table
GRANT ALL ON TABLE services TO authenticated;

-- FIX: Ensure RLS allows INSERTs for providers
DROP POLICY IF EXISTS "providers_insert_own_services" ON services;
CREATE POLICY "providers_insert_own_services" ON services
    FOR INSERT TO authenticated
    WITH CHECK (auth.uid() = provider_id);

-- FIX: Add total_reputation column if strictly needed by older code (optional, but good for safety)
-- However, we fixed the frontend to use reputation_score. 
-- Just in case, let's force a schema cache reload by notifying.
NOTIFY pgrst, 'reload config';
