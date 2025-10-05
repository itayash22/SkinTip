import { createClient } from '@supabase/supabase-js';

// --- Supabase Setup ---
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// --- Data Transformation Helpers ---

/**
 * Converts object keys from snake_case to camelCase.
 * @param {object | object[]} obj The object or array of objects to convert.
 * @returns {object | object[]} The converted object or array.
 */
const toCamelCase = (obj) => {
    if (Array.isArray(obj)) {
        return obj.map(v => toCamelCase(v));
    } else if (obj !== null && obj.constructor === Object) {
        return Object.keys(obj).reduce((result, key) => {
            const camelKey = key.replace(/([-_][a-z])/ig, ($1) => {
                return $1.toUpperCase().replace('-', '').replace('_', '');
            });
            result[camelKey] = toCamelCase(obj[key]);
            return result;
        }, {});
    }
    return obj;
};

/**
 * Converts object keys from camelCase to snake_case.
 * @param {object} obj The object to convert.
 * @returns {object} The converted object.
 */
const toSnakeCase = (obj) => {
    if (Array.isArray(obj)) {
        return obj.map(v => toSnakeCase(v));
    } else if (obj !== null && obj.constructor === Object) {
        return Object.keys(obj).reduce((result, key) => {
            const snakeKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
            result[snakeKey] = toSnakeCase(obj[key]);
            return result;
        }, {});
    }
    return obj;
};


// --- Database Interaction Logic ---

const getLatestFluxSettings = async () => {
    const { data, error } = await supabase
        .from('flux_settings')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

    if (error) {
        if (error.code === 'PGRST116') { // "single() requested but 0 rows returned"
            console.log('No settings found in DB, returning null.');
            return null;
        }
        console.error('Error fetching latest flux settings:', error);
        throw new Error('Could not fetch latest FLUX settings.');
    }

    return toCamelCase(data);
};

const getFluxSettingsHistory = async () => {
    const { data, error } = await supabase
        .from('flux_settings')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error fetching flux settings history:', error);
        throw new Error('Could not fetch FLUX settings history.');
    }

    return toCamelCase(data);
};

const saveFluxSettings = async (settings, userId, source) => {
    const settingsInSnakeCase = toSnakeCase(settings);

    const recordToInsert = {
        ...settingsInSnakeCase,
        user_id: userId,
        source: source, // e.g., 'preset: realistic' or 'manual'
    };

    // Remove id and createdAt if they exist, as they are auto-generated
    delete recordToInsert.id;
    delete recordToInsert.created_at;

    const { data, error } = await supabase
        .from('flux_settings')
        .insert(recordToInsert)
        .select()
        .single();

    if (error) {
        console.error('Error saving flux settings:', error);
        throw new Error(`Could not save FLUX settings: ${error.message}`);
    }

    return toCamelCase(data);
};

export default {
    getLatestFluxSettings,
    getFluxSettingsHistory,
    saveFluxSettings,
    // also exporting the utility for use in other parts of the server
    toCamelCase,
};