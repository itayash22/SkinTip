-- First, check if the image_metadata table exists
SELECT EXISTS (
  SELECT FROM information_schema.tables 
  WHERE table_schema = 'public' 
  AND table_name = 'image_metadata'
) as table_exists;

-- If table_exists = false, you need to run the CREATE TABLE statement from create_image_metadata_table.sql

