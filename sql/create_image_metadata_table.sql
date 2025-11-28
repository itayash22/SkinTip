-- Create table to track image uploads and deletions in Supabase Storage
CREATE TABLE IF NOT EXISTS image_metadata (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    file_path TEXT NOT NULL,
    file_url TEXT NOT NULL,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_image_metadata_user_id ON image_metadata(user_id);
CREATE INDEX IF NOT EXISTS idx_image_metadata_status ON image_metadata(status);
CREATE INDEX IF NOT EXISTS idx_image_metadata_expires_at ON image_metadata(expires_at);

-- Query to check images (use this after table is created):
-- SELECT 
--   CASE 
--     WHEN COUNT(*) = 0 THEN 'No pics found'
--     ELSE COUNT(*)::TEXT || ' image(s) found'
--   END as result,
--   COUNT(*) FILTER (WHERE status = 'active') as active_count,
--   COUNT(*) FILTER (WHERE status = 'deleted') as deleted_count
-- FROM image_metadata;

