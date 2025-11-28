-- Test if you can insert into the table manually
-- This will help identify if it's a permissions/RLS issue

INSERT INTO image_metadata (user_id, file_path, file_url, expires_at)
VALUES (
  '00000000-0000-0000-0000-000000000000'::uuid,  -- test user ID
  'test/path/test-image.png',
  'https://example.com/test-image.png',
  NOW() + INTERVAL '5 minutes'
)
RETURNING *;

-- If this works, check RLS policies:
-- SELECT * FROM pg_policies WHERE tablename = 'image_metadata';

-- If RLS is enabled, you may need to disable it or create a policy:
-- ALTER TABLE image_metadata DISABLE ROW LEVEL SECURITY;
-- OR create a policy that allows service role inserts

