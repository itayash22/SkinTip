import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in your .env file.');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function exploreDbSchema() {
    console.log('Connecting to the database to explore schema...');

    try {
        // Fetch all tables in the 'public' schema
        const { data: tables, error: tablesError } = await supabase
            .from('pg_catalog.pg_tables')
            .select('tablename')
            .eq('schemaname', 'public');

        if (tablesError) {
            throw tablesError;
        }

        if (!tables || tables.length === 0) {
            console.log('No tables found in the public schema.');
            return;
        }

        console.log('\n--- Database Schema ---');

        for (const table of tables) {
            const tableName = table.tablename;

            // Skip Supabase internal tables
            if (tableName.startsWith('pg_') || tableName.startsWith('sql_')) {
                continue;
            }

            console.log(`\n[Table: ${tableName}]`);

            // Fetch columns for the current table
            const { data: columns, error: columnsError } = await supabase
                .from('information_schema.columns')
                .select('column_name, data_type')
                .eq('table_name', tableName)
                .order('ordinal_position');

            if (columnsError) {
                console.error(`  - Error fetching columns for ${tableName}:`, columnsError.message);
                continue;
            }

            if (columns && columns.length > 0) {
                columns.forEach(column => {
                    console.log(`  - ${column.column_name} (${column.data_type})`);
                });
            } else {
                console.log('  - No columns found.');
            }
        }
        console.log('\n--- End of Schema ---');

    } catch (error) {
        console.error('\nAn error occurred while exploring the database schema:', error.message);
    }
}

exploreDbSchema();