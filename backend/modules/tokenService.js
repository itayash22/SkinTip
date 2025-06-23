// backend/modules/tokenService.js

import { createClient } = from '@supabase/supabase-js'; // Changed to ESM import

// Initialize Supabase client (use your environment variables for security)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY; // Use a service role key for backend operations for security!
                                                    // This key has full bypass RLS access.
                                                    // MAKE SURE TO SET THIS IN YOUR RENDER ENVIRONMENT VARIABLES!

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const tokenService = {

    /**
     * Deducts a specified amount of tokens from a user's balance and logs the transaction.
     * @param {string} userId The ID of the user.
     * @param {string} actionType The type of action (e.g., 'FLUX_PLACEMENT', 'SORA_IDEAS').
     * @param {number} amount The number of tokens to deduct.
     * @param {string} [description=''] Optional: A description for the transaction log.
     * @returns {Promise<number>} The user's new token balance.
     * @throws {Error} If user not found, insufficient tokens, or database error occurs.
     */
    deductTokens: async (userId, actionType, amount, description = '') => {
        if (!userId || !actionType || amount <= 0) {
            throw new Error('Invalid parameters for token deduction.');
        }

        const { data: user, error: userError } = await supabase
            .from('users')
            .select('tokens_remaining')
            .eq('id', userId)
            .single();

        if (userError || !user) {
            console.error('Token deduction: User not found or DB error:', userError);
            throw new Error('User not found or failed to retrieve token balance.');
        }

        if (user.tokens_remaining < amount) {
            throw new Error('Insufficient tokens for this action.');
        }

        const newBalance = user.tokens_remaining - amount;

        const { error: updateError } = await supabase
            .from('users')
            .update({ tokens_remaining: newBalance })
            .eq('id', userId);

        if (updateError) {
            console.error('Token deduction: Failed to update user balance:', updateError);
            throw new Error('Failed to deduct tokens.');
        }

        // Log the transaction
        const { error: logError } = await supabase
            .from('transactions')
            .insert({
                user_id: userId,
                action_type: actionType,
                tokens_amount: -amount, // Negative for deduction
                description: description
            });

        if (logError) {
            console.warn('Token deduction: Failed to log transaction, but tokens were deducted:', logError);
            // This is a warning, as the core deduction happened. You might want a more robust retry/logging system here.
        }

        console.log(`User ${userId} deducted ${amount} tokens for ${actionType}. New balance: ${newBalance}`);
        return newBalance;
    },

    /**
     * Checks if a user has sufficient tokens without deducting them.
     * @param {string} userId The ID of the user.
     * @param {string} actionType The type of action for which to check (e.g., 'FLUX_PLACEMENT').
     * @param {number} amount The number of tokens required.
     * @returns {Promise<boolean>} True if sufficient, false otherwise.
     * @throws {Error} If user not found or database error occurs.
     */
    checkTokens: async (userId, actionType, amount) => {
        if (!userId || !actionType || amount <= 0) {
            throw new Error('Invalid parameters for token check.');
        }

        const { data: user, error: userError } = await supabase
            .from('users')
            .select('tokens_remaining')
            .eq('id', userId)
            .single();

        if (userError || !user) {
            console.error('Token check: User not found or DB error:', userError);
            throw new Error('User not found or failed to retrieve token balance for check.');
        }

        return user.tokens_remaining >= amount;
    },

    /**
     * Adds tokens to a user's balance and logs the transaction.
     * (For future payment integration)
     * @param {string} userId The ID of the user.
     * @param {number} amount The number of tokens to add.
     * @param {string} [description=''] Optional: A description for the transaction log.
     * @returns {Promise<number>} The user's new token balance.
     * @throws {Error} If user not found or database error occurs.
     */
    addTokens: async (userId, amount, description = 'Token purchase') => {
        if (!userId || amount <= 0) {
            throw new Error('Invalid parameters for token addition.');
        }

        const { data: user, error: userError } = await supabase
            .from('users')
            .select('tokens_remaining')
            .eq('id', userId)
            .single();

        if (userError || !user) {
            console.error('Token addition: User not found or DB error:', userError);
            throw new Error('User not found or failed to retrieve token balance.');
        }

        const newBalance = user.tokens_remaining + amount;

        const { error: updateError } = await supabase
            .from('users')
            .update({ tokens_remaining: newBalance })
            .eq('id', userId);

        if (updateError) {
            console.error('Token addition: Failed to update user balance:', updateError);
            throw new Error('Failed to add tokens.');
        }

        // Log the transaction
        const { error: logError } = await supabase
            .from('transactions')
            .insert({
                user_id: userId,
                action_type: 'TOKEN_PURCHASE',
                tokens_amount: amount,
                description: description
            });

        if (logError) {
            console.warn('Token addition: Failed to log transaction, but tokens were added:', logError);
        }

        console.log(`User ${userId} added ${amount} tokens. New balance: ${newBalance}`);
        return newBalance;
    }
};

export default tokenService; // Changed from module.exports to ES Module default export
