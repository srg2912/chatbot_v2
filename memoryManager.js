import { pool } from './db.js';

export const memoryManager = {
    // Get current message count
    getMessageCount: async () => {
        const res = await pool.query(`SELECT value FROM bot_state WHERE key = 'message_count'`);
        return res.rows[0].value;
    },
    // Increment message count after completion
    incrementMessageCount: async () => {
        await pool.query(`UPDATE bot_state SET value = value + 1 WHERE key = 'message_count'`);
    },
    // Save Message to STM
    saveMessage: async (role, content) => {
        await pool.query(
            'INSERT INTO messages (role, content) VALUES ($1, $2)',
            [role, content]
        );
    },
    // Fetch last 20 message pairs (40 total messages) for context
    getSTM: async () => {
        const res = await pool.query(`
            SELECT role, content FROM messages
            ORDER BY id DESC LIMIT 20;
        `);
        return res.rows.reverse();
    },
    clearSTM: async () => {
        // Deletes the recent conversational history to break loops
        await pool.query('DELETE FROM messages;');
    },
    // LTM vector similarity search
    getLTM: async (embedding) => {
        const res = await pool.query(`
            SELECT content FROM document_chunks
            ORDER BY embedding <=> $1::vector
            LIMIT 5;
        `, [JSON.stringify(embedding)]);
        return res.rows.map(r => r.content);
    },
    // Fetch last 50 messages for reflection
    getLast50Messages: async () => {
        const res = await pool.query(`
            SELECT role, content FROM messages
            ORDER BY id DESC LIMIT 50;
        `);
        return res.rows.reverse();
    }
};