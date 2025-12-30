-- SkinTip Database Schema Updates
-- Run these in Supabase SQL Editor
-- Last updated: 2024-12-30

-- ============================================
-- 1. Add is_admin column to users table
-- ============================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;

-- ============================================
-- 2. Create token_blacklist table for JWT revocation
-- ============================================
CREATE TABLE IF NOT EXISTS token_blacklist (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    token TEXT NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for faster token lookups
CREATE INDEX IF NOT EXISTS idx_token_blacklist_token ON token_blacklist(token);
CREATE INDEX IF NOT EXISTS idx_token_blacklist_expires ON token_blacklist(expires_at);

-- ============================================
-- 3. Create refresh_tokens table
-- ============================================
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    token TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token ON refresh_tokens(token);

-- ============================================
-- 4. Create image_metadata table for expiration tracking
-- ============================================
CREATE TABLE IF NOT EXISTS image_metadata (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    storage_path TEXT NOT NULL,
    public_url TEXT,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_image_metadata_expires ON image_metadata(expires_at);
CREATE INDEX IF NOT EXISTS idx_image_metadata_user ON image_metadata(user_id);
CREATE INDEX IF NOT EXISTS idx_image_metadata_deleted ON image_metadata(deleted_at);

-- ============================================
-- 5. Create user_events table for analytics
-- ============================================
CREATE TABLE IF NOT EXISTS user_events (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    artist_id UUID,
    stencil_id UUID,
    extra_details JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_events_user ON user_events(user_id);
CREATE INDEX IF NOT EXISTS idx_user_events_type ON user_events(event_type);
CREATE INDEX IF NOT EXISTS idx_user_events_created ON user_events(created_at);

-- ============================================
-- 6. RLS Policies for new tables
-- ============================================

-- Enable RLS on new tables
ALTER TABLE token_blacklist ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE image_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_events ENABLE ROW LEVEL SECURITY;

-- token_blacklist: Only service role can access (no public access)
-- No policies = only service key can access

-- refresh_tokens: Only service role can access
-- No policies = only service key can access

-- image_metadata: Users can see their own images
DROP POLICY IF EXISTS "Users can view own images" ON image_metadata;
CREATE POLICY "Users can view own images" ON image_metadata
    FOR SELECT USING (auth.uid()::text = user_id::text);

-- user_events: Users can insert their own events
DROP POLICY IF EXISTS "Users can insert own events" ON user_events;
CREATE POLICY "Users can insert own events" ON user_events
    FOR INSERT WITH CHECK (auth.uid()::text = user_id::text);

-- ============================================
-- 7. Update existing RLS policies for artists table
-- ============================================
DROP POLICY IF EXISTS "Public can read artists" ON artists;
CREATE POLICY "Public can read artists" ON artists
    FOR SELECT USING (true);

-- ============================================
-- 8. Update existing RLS policies for tattoo_sketches table
-- ============================================
DROP POLICY IF EXISTS "Public can read active stencils" ON tattoo_sketches;
CREATE POLICY "Public can read active stencils" ON tattoo_sketches
    FOR SELECT USING (is_active = true OR is_active IS NULL);

-- ============================================
-- 9. Function to clean up expired tokens (can be called by cron)
-- ============================================
CREATE OR REPLACE FUNCTION cleanup_expired_tokens()
RETURNS void AS $$
BEGIN
    -- Clean up expired blacklisted tokens
    DELETE FROM token_blacklist WHERE expires_at < NOW();
    
    -- Clean up expired refresh tokens
    DELETE FROM refresh_tokens WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 10. Function to clean up expired images (can be called by cron)
-- ============================================
CREATE OR REPLACE FUNCTION cleanup_expired_images()
RETURNS TABLE(deleted_count INT) AS $$
DECLARE
    count_deleted INT;
BEGIN
    -- Mark expired images as deleted (actual storage cleanup done by API)
    UPDATE image_metadata 
    SET deleted_at = NOW() 
    WHERE expires_at < NOW() AND deleted_at IS NULL;
    
    GET DIAGNOSTICS count_deleted = ROW_COUNT;
    RETURN QUERY SELECT count_deleted;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- DONE! Remember to:
-- 1. Set CRON_SECRET in Render environment variables
-- 2. Set up a cron job to call /api/internal/cleanup-expired-images
-- ============================================

