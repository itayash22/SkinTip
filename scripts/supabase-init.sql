-- Drop existing tables if they exist
DROP TABLE IF EXISTS user_artist_interactions CASCADE;
DROP TABLE IF EXISTS user_likes CASCADE;
DROP TABLE IF EXISTS daily_usage CASCADE;
DROP TABLE IF EXISTS user_credits CASCADE;
DROP TABLE IF EXISTS payment_history CASCADE;
DROP TABLE IF EXISTS user_subscriptions CASCADE;
DROP TABLE IF EXISTS artists CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- Create users table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    username VARCHAR(100) UNIQUE NOT NULL,
    daily_prompts_used INTEGER DEFAULT 0,
    last_prompt_reset TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create artists table
CREATE TABLE artists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    bio TEXT,
    location VARCHAR(255),
    whatsapp_number VARCHAR(20) NOT NULL,
    portfolio_urls TEXT[],
    styles TEXT[],
    likes_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create user_artist_interactions table
CREATE TABLE user_artist_interactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    artist_id UUID REFERENCES artists(id) ON DELETE CASCADE,
    interaction_type VARCHAR(50) DEFAULT 'contact',
    prompt_text TEXT,
    contacted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create daily_usage table for tracking API costs
CREATE TABLE daily_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date DATE DEFAULT CURRENT_DATE,
    total_cost DECIMAL(10, 2) DEFAULT 0,
    request_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(date)
);

-- Insert sample artists data
INSERT INTO artists (name, bio, location, whatsapp_number, portfolio_urls, styles, likes_count) VALUES
('Sarah Martinez', 'Specializing in fine line and minimalist designs. 10+ years experience.', 'Los Angeles, CA', '+13105551234', ARRAY['https://images.unsplash.com/photo-1611501275019-9b5cda994e8d'], ARRAY['Fine Line', 'Minimalist', 'Geometric'], 156),
('Mike Chen', 'Traditional Japanese and Neo-Traditional artist. Award-winning designs.', 'New York, NY', '+12125555678', ARRAY['https://images.unsplash.com/photo-1565058379802-bbe93b2f703a'], ARRAY['Japanese (Irezumi)', 'Neo-Traditional'], 243);
