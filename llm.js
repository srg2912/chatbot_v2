import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import { logger } from './logger.js'; // Import logger to see when retries happen
dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
const modelName = process.env.LLM_MODEL || 'gemini-2.5-flash';
const embedModel = process.env.EMBEDDING_MODEL || 'gemini-embedding-2-preview';

// --- Auto-Retry Wrapper ---
// This function will attempt the API call up to 3 times before giving up
const withRetry = async (apiCall, retries = 3) => {
    for (let i = 0; i < retries; i++) {
        try {
            return await apiCall();
        } catch (error) {
            const isTransientError = error.message.includes('500') || error.message.includes('503') || error.message.includes('429');
            if (i === retries - 1 || !isTransientError) {
                throw error; // If out of retries, or if it's a permanent error (like bad API key), crash.
            }
            logger.log('WARN', `Google API Error (${error.message}). Retrying in 2 seconds... (Attempt ${i + 1} of ${retries})`);
            await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
        }
    }
};

export const llm = {
    generateResponse: async (prompt) => {
        return await withRetry(async () => {
            const response = await ai.models.generateContent({
                model: modelName,
                contents: prompt,
            });
            return response.text;
        });
    },
    getEmbedding: async (text) => {
        return await withRetry(async () => {
            const response = await ai.models.embedContent({
                model: embedModel,
                contents: text,
            });
            return response.embeddings[0].values;
        });
    },
    reflectOnMessages: async (messages) => {
        return await withRetry(async () => {
            const prompt = `
You are a Meta-Cognitive Analyst. Review the following recent conversation history of a chatbot.
Your output must be a minimal, actionable suggestion (e.g., 'Be more empathetic when discussing finances' or 'Use more historical references'). Do not write a full paragraph.

Conversation:
${messages.map(m => `${m.role}: ${m.content}`).join('\n')}
            `.trim();
            
            const response = await ai.models.generateContent({
                model: modelName,
                contents: prompt,
            });
            return response.text.trim();
        });
    }
};