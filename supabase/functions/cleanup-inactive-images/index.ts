// supabase/functions/cleanup-inactive-images/index.ts

import { createClient } from 'npm:@supabase/supabase-js@2';
import { serve } from 'npm:std/http';

const BUCKET_NAME = 'generated-tattoos';

// This is a scheduled function that will run based on a cron job.
serve(async (req) => {
  console.log('Starting cleanup-inactive-images function...');

  try {
    // Create a Supabase client with the SERVICE_ROLE_KEY
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // 1. Calculate the timestamp for 7 days ago
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysAgoISO = sevenDaysAgo.toISOString();

    console.log(`Searching for users inactive since: ${sevenDaysAgoISO}`);

    // 2. Query for users who have not signed in within the last 7 days
    const { data: users, error: userError } = await supabase
      .from('users')
      .select('id')
      .lt('last_sign_in_at', sevenDaysAgoISO);

    if (userError) {
      throw new Error(`Error fetching inactive users: ${userError.message}`);
    }

    if (!users || users.length === 0) {
      console.log('No inactive users found. Exiting.');
      return new Response(JSON.stringify({ message: 'No inactive users to clean up.' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 3. Prepare the list of folders (user IDs) to delete
    const folderPaths = users.map(user => user.id);
    console.log(`Found ${folderPaths.length} inactive user folders to delete:`, folderPaths);

    // 4. Delete the corresponding folders from Supabase Storage
    const { data: deletedFiles, error: deleteError } = await supabase.storage
      .from(BUCKET_NAME)
      .remove(folderPaths);

    if (deleteError) {
      throw new Error(`Error deleting storage folders: ${deleteError.message}`);
    }

    console.log('Successfully deleted folders for inactive users.', deletedFiles);

    return new Response(JSON.stringify({ success: true, deletedFolders: folderPaths }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('An unexpected error occurred:', error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
