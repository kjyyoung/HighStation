-- ============================================================================
-- CORE CONFIG: Auth Schema (Required for Hybrid Sync)
-- ============================================================================
-- This schema is REQUIRED for both Local Development and N100 Production.
-- It creates the 'auth.users' table to sync User IDs from Supabase.
-- 
-- Why?
-- 1. The main business schema references 'auth.users(id)' (Foreign Key).
-- 2. Since our database is isolated from Supabase Cloud, we must maintain
--    a local copy of user identities to satisfy integrity constraints.
--
-- Security Note:
-- We ONLY store public UUIDs and Emails. No passwords or tokens.

BEGIN;

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
    id UUID PRIMARY KEY,
    email TEXT UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    raw_user_meta_data JSONB DEFAULT '{}'::JSONB,
    raw_app_meta_data JSONB DEFAULT '{}'::JSONB,
    is_super_admin BOOLEAN DEFAULT FALSE,
    role TEXT DEFAULT 'authenticated'
);

-- Create a dummy user for testing if needed
-- INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-000000000000', 'test@example.com') ON CONFLICT DO NOTHING;

-- Create Supabase roles if they don't exist
DO
$do$
BEGIN
   IF NOT EXISTS (
      SELECT FROM pg_catalog.pg_roles
      WHERE  rolname = 'anon') THEN
      CREATE ROLE anon;
   END IF;
   IF NOT EXISTS (
      SELECT FROM pg_catalog.pg_roles
      WHERE  rolname = 'authenticated') THEN
      CREATE ROLE authenticated;
   END IF;
   IF NOT EXISTS (
      SELECT FROM pg_catalog.pg_roles
      WHERE  rolname = 'service_role') THEN
      CREATE ROLE service_role;
   END IF;
END
$do$;

GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA auth TO postgres, service_role;

COMMIT;
