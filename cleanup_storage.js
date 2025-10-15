// Filename: cleanup_storage.js
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

// --- WARNING ---
// This script will attempt to delete ALL top-level folders in your Supabase storage bucket.
// This is where the user-generated images are stored.
// Please double-check that you do not have other important folders at the top level of your bucket.

async function emptyGeneratedImages() {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const BUCKET_NAME = process.env.SUPABASE_STORAGE_BUCKET || 'generated-tattoos';

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('Error: Make sure SUPABASE_URL and SUPABASE_SERVICE_KEY are set in your .env file.');
    return;
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  console.log(`Connecting to Supabase and listing all folders in bucket: "${BUCKET_NAME}"...`);

  // List all top-level objects, which should be the user ID folders
  const { data: folders, error: listError } = await supabase.storage.from(BUCKET_NAME).list();

  if (listError) {
    console.error('Error listing folders:', listError.message);
    return;
  }

  if (!folders || folders.length === 0) {
    console.log('No folders found to delete. The bucket might be empty or files are stored at the root.');
    return;
  }

  // Get the names of all folders to be deleted
  const folderPaths = folders.map(folder => folder.name);
  console.log(`Found ${folderPaths.length} folders to delete:`, folderPaths);

  console.log('\nThis will delete all the folders listed above and ALL files within them.');
  console.log('Starting deletion in 5 seconds... (Press CTRL+C to cancel)');

  await new Promise(resolve => setTimeout(resolve, 5000));

  console.log('Deleting folders...');
  const { data, error: removeError } = await supabase.storage.from(BUCKET_NAME).remove(folderPaths);

  if (removeError) {
    console.error('An error occurred during deletion:', removeError.message);
  } else {
    console.log('Successfully initiated deletion of all folders.');
    console.log('Please check your Supabase dashboard to monitor the process.');
  }
}

emptyGeneratedImages();
