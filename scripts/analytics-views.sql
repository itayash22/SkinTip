-- SkinTip Analytics Views
-- Run these in Supabase SQL Editor after analytics-schema.sql
-- Last updated: 2026-01-03

-- ============================================
-- 1. Daily Active Users View
-- ============================================
CREATE OR REPLACE VIEW v_daily_active_users AS
SELECT 
    DATE(created_at) as date,
    COUNT(DISTINCT user_id) as dau
FROM user_events 
WHERE created_at >= NOW() - INTERVAL '90 days'
GROUP BY DATE(created_at)
ORDER BY date DESC;

-- ============================================
-- 2. User Cohorts View (Weekly)
-- ============================================
CREATE OR REPLACE VIEW v_user_cohorts AS
SELECT 
    DATE_TRUNC('week', created_at)::date as cohort_week,
    COUNT(*) as cohort_size
FROM users 
GROUP BY cohort_week
ORDER BY cohort_week DESC;

-- ============================================
-- 3. User Growth View (Daily signups)
-- ============================================
CREATE OR REPLACE VIEW v_user_growth AS
SELECT 
    DATE(created_at) as date,
    COUNT(*) as new_users,
    SUM(COUNT(*)) OVER (ORDER BY DATE(created_at)) as cumulative_users
FROM users
WHERE created_at >= NOW() - INTERVAL '90 days'
GROUP BY DATE(created_at)
ORDER BY date DESC;

-- ============================================
-- 4. Conversion Funnel View
-- ============================================
CREATE OR REPLACE VIEW v_conversion_funnel AS
SELECT 
    COUNT(DISTINCT CASE WHEN event_type = 'SKETCH_CLICK' THEN user_id END) as sketch_clicks,
    COUNT(DISTINCT CASE WHEN event_type = 'SKIN_UPLOAD_APPROVED' THEN user_id END) as uploads,
    COUNT(DISTINCT CASE WHEN event_type = 'GENERATE_TATTOO' THEN user_id END) as generations,
    COUNT(DISTINCT CASE WHEN event_type = 'WHATSAPP_CONTACT' THEN user_id END) as whatsapp_contacts
FROM user_events
WHERE created_at >= NOW() - INTERVAL '30 days';

-- ============================================
-- 5. Geographic Distribution View
-- ============================================
CREATE OR REPLACE VIEW v_geo_distribution AS
SELECT 
    COALESCE(geo_country, 'Unknown') as country,
    COUNT(DISTINCT user_id) as unique_users,
    COUNT(*) as total_events
FROM user_events
WHERE created_at >= NOW() - INTERVAL '30 days'
GROUP BY geo_country
ORDER BY unique_users DESC
LIMIT 20;

-- ============================================
-- 6. Device Distribution View
-- ============================================
CREATE OR REPLACE VIEW v_device_distribution AS
SELECT 
    COALESCE(device_type, 'Unknown') as device,
    COUNT(DISTINCT user_id) as unique_users,
    COUNT(*) as total_events
FROM user_events
WHERE created_at >= NOW() - INTERVAL '30 days'
GROUP BY device_type
ORDER BY unique_users DESC;

-- ============================================
-- 7. Retention Cohort Analysis View
-- ============================================
CREATE OR REPLACE VIEW v_retention_cohorts AS
WITH user_cohorts AS (
    SELECT 
        id as user_id,
        DATE_TRUNC('week', created_at)::date as cohort_week
    FROM users
),
user_activity AS (
    SELECT 
        user_id,
        DATE_TRUNC('week', created_at)::date as activity_week
    FROM user_events
    GROUP BY user_id, DATE_TRUNC('week', created_at)::date
)
SELECT 
    uc.cohort_week,
    COUNT(DISTINCT uc.user_id) as cohort_size,
    COUNT(DISTINCT CASE WHEN ua.activity_week = uc.cohort_week THEN uc.user_id END) as week_0,
    COUNT(DISTINCT CASE WHEN ua.activity_week = uc.cohort_week + INTERVAL '1 week' THEN uc.user_id END) as week_1,
    COUNT(DISTINCT CASE WHEN ua.activity_week = uc.cohort_week + INTERVAL '2 weeks' THEN uc.user_id END) as week_2,
    COUNT(DISTINCT CASE WHEN ua.activity_week = uc.cohort_week + INTERVAL '3 weeks' THEN uc.user_id END) as week_3,
    COUNT(DISTINCT CASE WHEN ua.activity_week = uc.cohort_week + INTERVAL '4 weeks' THEN uc.user_id END) as week_4
FROM user_cohorts uc
LEFT JOIN user_activity ua ON uc.user_id = ua.user_id
WHERE uc.cohort_week >= NOW() - INTERVAL '8 weeks'
GROUP BY uc.cohort_week
ORDER BY uc.cohort_week DESC;

-- ============================================
-- 8. Top Artists by Engagement View
-- ============================================
CREATE OR REPLACE VIEW v_top_artists AS
SELECT 
    a.id as artist_id,
    a.name as artist_name,
    a.location,
    COUNT(DISTINCT CASE WHEN ue.event_type = 'SKETCH_CLICK' THEN ue.id END) as sketch_clicks,
    COUNT(DISTINCT CASE WHEN ue.event_type = 'WHATSAPP_CONTACT' THEN ue.id END) as whatsapp_contacts,
    COUNT(DISTINCT ue.user_id) as unique_users
FROM artists a
LEFT JOIN user_events ue ON ue.artist_id = a.id
WHERE ue.created_at >= NOW() - INTERVAL '30 days' OR ue.created_at IS NULL
GROUP BY a.id, a.name, a.location
ORDER BY sketch_clicks DESC
LIMIT 20;

-- ============================================
-- 9. Daily Revenue/Cost View
-- ============================================
CREATE OR REPLACE VIEW v_daily_revenue AS
SELECT 
    date,
    total_cost,
    request_count,
    CASE WHEN request_count > 0 THEN total_cost / request_count ELSE 0 END as cost_per_request
FROM daily_usage
WHERE date >= NOW() - INTERVAL '90 days'
ORDER BY date DESC;

-- ============================================
-- 10. Overview KPIs Function
-- ============================================
CREATE OR REPLACE FUNCTION get_analytics_overview()
RETURNS TABLE(
    total_users BIGINT,
    new_users_today BIGINT,
    new_users_week BIGINT,
    active_users_today BIGINT,
    active_users_week BIGINT,
    total_generations BIGINT,
    total_whatsapp_contacts BIGINT,
    total_api_cost NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        (SELECT COUNT(*) FROM users)::BIGINT as total_users,
        (SELECT COUNT(*) FROM users WHERE created_at >= CURRENT_DATE)::BIGINT as new_users_today,
        (SELECT COUNT(*) FROM users WHERE created_at >= CURRENT_DATE - INTERVAL '7 days')::BIGINT as new_users_week,
        (SELECT COUNT(DISTINCT user_id) FROM user_events WHERE created_at >= CURRENT_DATE)::BIGINT as active_users_today,
        (SELECT COUNT(DISTINCT user_id) FROM user_events WHERE created_at >= CURRENT_DATE - INTERVAL '7 days')::BIGINT as active_users_week,
        (SELECT COUNT(*) FROM user_events WHERE event_type = 'GENERATE_TATTOO')::BIGINT as total_generations,
        (SELECT COUNT(*) FROM user_events WHERE event_type = 'WHATSAPP_CONTACT')::BIGINT as total_whatsapp_contacts,
        (SELECT COALESCE(SUM(total_cost), 0) FROM daily_usage WHERE date >= CURRENT_DATE - INTERVAL '30 days')::NUMERIC as total_api_cost;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- DONE! Run this in Supabase SQL Editor
-- ============================================

