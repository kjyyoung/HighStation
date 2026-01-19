-- ============================================
-- Supabase Auth-Only Configuration
-- ============================================
-- This SQL is for Supabase Dashboard ONLY
-- All business data (services, requests, etc.) is stored on N100 PostgreSQL
-- Supabase only handles authentication

-- ============================================
-- 1. Profiles Table (Minimal, for reference only)
-- ============================================
-- This table exists in Supabase but is NOT used by the backend
-- The actual profiles table is on N100 PostgreSQL
-- We keep this here only for Supabase RLS policies if needed

CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID REFERENCES auth.users(id) PRIMARY KEY,
    email TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Policy: Users can read their own profile
CREATE POLICY "Users can read own profile"
    ON public.profiles
    FOR SELECT
    USING (auth.uid() = id);

-- ============================================
-- 2. Trigger: Auto-create profile on signup
-- ============================================
-- This trigger creates a profile record when a user signs up
-- However, the N100 backend does NOT use this table
-- The backend will create its own profile in N100 PostgreSQL

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
    INSERT INTO public.profiles (id, email, created_at)
    VALUES (new.id, new.email, new.created_at)
    ON CONFLICT (id) DO NOTHING;
    RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop existing trigger if exists
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Create trigger
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

-- ============================================
-- 3. Backend Profile Sync (Webhook Alternative)
-- ============================================
-- IMPORTANT: The N100 backend should implement a middleware
-- that automatically creates profiles in N100 PostgreSQL
-- when a user first authenticates.
--
-- Example backend logic (Node.js):
-- 
-- async function ensureProfile(userId, email) {
--   const result = await pool.query(
--     'SELECT id FROM profiles WHERE id = $1',
--     [userId]
--   );
--   
--   if (result.rows.length === 0) {
--     await pool.query(
--       'INSERT INTO profiles (id, email, created_at) VALUES ($1, $2, NOW())',
--       [userId, email]
--     );
--   }
-- }
--
-- Then call this in authMiddleware after successful token verification.

-- ============================================
-- 4. Cleanup (Optional)
-- ============================================
-- If you want to remove all other tables from Supabase
-- since they're not used:

-- DROP TABLE IF EXISTS public.services CASCADE;
-- DROP TABLE IF EXISTS public.requests CASCADE;
-- DROP TABLE IF EXISTS public.withdrawals CASCADE;
-- etc.

-- ============================================
-- SUMMARY
-- ============================================
-- 1. Supabase handles ONLY authentication (auth.users)
-- 2. Supabase profiles table is minimal (for RLS only)
-- 3. N100 PostgreSQL has the real profiles table + all business data
-- 4. Backend should auto-create profiles in N100 on first login
