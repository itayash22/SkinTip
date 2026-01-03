-- SkinTip Analytics Schema Updates
-- Run these in Supabase SQL Editor
-- Last updated: 2026-01-03

-- ============================================
-- 1. Extend users table with analytics columns
-- ============================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS login_count INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_source TEXT; -- UTM source
ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_geo TEXT; -- Country/region
ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_device TEXT; -- mobile/desktop

-- ============================================
-- 2. Extend user_events table with tracking columns
-- ============================================
ALTER TABLE user_events ADD COLUMN IF NOT EXISTS session_id UUID;
ALTER TABLE user_events ADD COLUMN IF NOT EXISTS ip_address TEXT;
ALTER TABLE user_events ADD COLUMN IF NOT EXISTS user_agent TEXT;
ALTER TABLE user_events ADD COLUMN IF NOT EXISTS geo_country TEXT;
ALTER TABLE user_events ADD COLUMN IF NOT EXISTS geo_city TEXT;
ALTER TABLE user_events ADD COLUMN IF NOT EXISTS device_type TEXT;
ALTER TABLE user_events ADD COLUMN IF NOT EXISTS referrer TEXT;

-- Indexes for new columns
CREATE INDEX IF NOT EXISTS idx_user_events_geo ON user_events(geo_country);
CREATE INDEX IF NOT EXISTS idx_user_events_device ON user_events(device_type);
CREATE INDEX IF NOT EXISTS idx_user_events_session ON user_events(session_id);

-- ============================================
-- 3. Create user_sessions table
-- ============================================
CREATE TABLE IF NOT EXISTS user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    session_start TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    session_end TIMESTAMP WITH TIME ZONE,
    ip_address TEXT,
    geo_country TEXT,
    geo_city TEXT,
    device_type TEXT,
    user_agent TEXT,
    pages_viewed INTEGER DEFAULT 0,
    events_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_start ON user_sessions(session_start);
CREATE INDEX IF NOT EXISTS idx_user_sessions_geo ON user_sessions(geo_country);

-- ============================================
-- 4. Create analytics_alerts table
-- ============================================
CREATE TABLE IF NOT EXISTS analytics_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_type TEXT NOT NULL,
    severity TEXT DEFAULT 'info', -- info, warning, critical
    message TEXT NOT NULL,
    data JSONB,
    is_read BOOLEAN DEFAULT FALSE,
    is_resolved BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    resolved_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_analytics_alerts_type ON analytics_alerts(alert_type);
CREATE INDEX IF NOT EXISTS idx_analytics_alerts_created ON analytics_alerts(created_at);
CREATE INDEX IF NOT EXISTS idx_analytics_alerts_unread ON analytics_alerts(is_read) WHERE is_read = FALSE;

-- ============================================
-- 5. RLS Policies for new tables
-- ============================================
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_alerts ENABLE ROW LEVEL SECURITY;

-- user_sessions: Only service role can access (no public access)
-- analytics_alerts: Only service role can access (admin dashboard uses service key)

-- ============================================
-- DONE! Run this in Supabase SQL Editor
-- ============================================

