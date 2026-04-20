import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
dotenv.config();

export const pool = new Pool(); // Uses PGHOST, PGUSER, PGPASSWORD, PGDATABASE, PGPORT from .env

export const initDB = async () => {
    // Enable Vector Extension
    await pool.query('CREATE EXTENSION IF NOT EXISTS vector;');

    // LTM Table
    await pool.query(`
        CREATE TABLE IF NOT EXISTS document_chunks (
            id SERIAL PRIMARY KEY,
            content TEXT NOT NULL,
            embedding vector(768)
        );
    `);

    // IVFFlat Index for Vector Search
    await pool.query(`
        CREATE INDEX IF NOT EXISTS document_chunks_embedding_idx
        ON document_chunks USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 100);
    `);

    // STM & Logging Table
    await pool.query(`
        CREATE TABLE IF NOT EXISTS messages (
            id SERIAL PRIMARY KEY,
            role VARCHAR(10) NOT NULL,
            content TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // State Table (Message Counters, etc.)
    await pool.query(`
        CREATE TABLE IF NOT EXISTS bot_state (
            id SERIAL PRIMARY KEY,
            key VARCHAR(50) UNIQUE NOT NULL,
            value INTEGER NOT NULL
        );
    `);

    // Initialize global counter
    await pool.query(`
        INSERT INTO bot_state (key, value) VALUES ('message_count', 0)
        ON CONFLICT (key) DO NOTHING;
    `);
};