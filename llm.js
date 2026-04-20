import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
const modelName = process.env.LLM_MODEL || 'gemini-2.5-flash';
const embedModel = 'text-embedding-004';

export const llm = {
    generateResponse: async (prompt) => {
        const response = await ai.models.generateContent({
            model: modelName,
            contents: prompt,
        });
        return response.text;
    },
    getEmbedding: async (text) => {
        const response = await ai.models.embedContent({
            model: embedModel,
            contents: text,
        });
        return response.embeddings[0].values;
    },
    reflectOnMessages: async (messages) => {
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
    }
};