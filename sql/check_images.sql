-- Simple query to check if images exist in the metadata table
-- Returns "No pics found" if empty, otherwise shows count and status breakdown

SELECT 
  CASE 
    WHEN COUNT(*) = 0 THEN 'No pics found'
    ELSE COUNT(*)::TEXT || ' image(s) found'
  END as result,
  COUNT(*) FILTER (WHERE status = 'active') as active_count,
  COUNT(*) FILTER (WHERE status = 'deleted') as deleted_count,
  COUNT(*) as total_count
FROM image_metadata;

-- Alternative: Show detailed breakdown
-- SELECT 
--   status,
--   COUNT(*) as count,
--   MIN(uploaded_at) as oldest_upload,
--   MAX(uploaded_at) as newest_upload
-- FROM image_metadata
-- GROUP BY status
-- ORDER BY status;

