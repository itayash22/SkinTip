-- Scheduled Deletions Table for Multi-Instance Image Cleanup
-- Run this in your Supabase SQL Editor
-- Required for Professional tier autoscaling support

CREATE TABLE IF NOT EXISTS scheduled_deletions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_path TEXT NOT NULL UNIQUE,
    bucket TEXT NOT NULL DEFAULT 'generated-tattoos',
    delete_at TIMESTAMP WITH TIME ZONE NOT NULL,
    label TEXT DEFAULT 'image',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for efficient cleanup queries
CREATE INDEX IF NOT EXISTS idx_scheduled_deletions_delete_at 
ON scheduled_deletions(delete_at);

-- Index for upsert operations
CREATE INDEX IF NOT EXISTS idx_scheduled_deletions_file_path 
ON scheduled_deletions(file_path);

-- RLS: Only service role can access this table
ALTER TABLE scheduled_deletions ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (backend cleanup)
CREATE POLICY "Service role can manage scheduled deletions" ON scheduled_deletions
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- Comment for documentation
COMMENT ON TABLE scheduled_deletions IS 
'Tracks images scheduled for deletion. Used by multi-instance cleanup for autoscaling support.';

