import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import { logger } from './logger.js';
import { tools, executeTool } from './agent.js'; // Import the new agent capabilities

dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
const modelName = process.env.LLM_MODEL || 'gemini-2.5-flash';
const embedModel = process.env.EMBEDDING_MODEL || 'gemini-embedding-2-preview';

const withRetry = async (apiCall, retries = 3) => {
    for (let i = 0; i < retries; i++) {
        try {
            return await apiCall();
        } catch (error) {
            const isTransientError = error.message.includes('500') || error.message.includes('503') || error.message.includes('429');
            if (i === retries - 1 || !isTransientError) throw error;
            logger.log('WARN', `Google API Error (${error.message}). Retrying...`);
            await new Promise(resolve => setTimeout(resolve, (i + 1) * 3000)); // Exponential backoff
        }
    }
};

export const llm = {
generateResponse: async (promptData) => {
        return await withRetry(async () => {
            // If it's a simple string, wrap it. If it's already an array (text + image), use it directly.
            const parts = Array.isArray(promptData) ? promptData : [{ text: promptData }];
            let messages =[{ role: 'user', parts: parts }];
            
            // Loop up to 5 times allowing bot to chain commands (e.g. Write file -> Run file -> Fix error -> Run again)
            for (let turn = 0; turn < 5; turn++) {
                const response = await ai.models.generateContent({
                    model: modelName,
                    contents: messages,
                    config: {
                        tools: tools // <--- Now it is correctly passed to Google!
                    }
                });

                // Check if bot decided to use a terminal command
                if (response.functionCalls && response.functionCalls.length > 0) {
                    let toolResponses = [];
                    let modelParts =[];

                    // If bot also spoke some text before running the command, save it
                    if (response.text) modelParts.push({ text: response.text });

                    for (const call of response.functionCalls) {
                        logger.log('INFO', `Agent executing tool: ${call.name} | Args: ${JSON.stringify(call.args)}`);
                        
                        // Execute the terminal command physically on the Pi
                        const result = await executeTool(call.name, call.args || {});
                        
                        modelParts.push({ functionCall: call });
                        
                        // Truncate terminal output to 4000 chars so massive logs don't crash the prompt
                        toolResponses.push({
                            functionResponse: {
                                name: call.name,
                                response: { result: String(result).slice(0, 4000) }
                            }
                        });
                    }
                    
                    // Add the terminal output to the conversation history and loop back so bot can see it
                    messages.push({ role: 'model', parts: modelParts });
                    messages.push({ role: 'user', parts: toolResponses });
                } else {
                    // If no tools were called, the bot is just talking. Return the text.
                    return response.text;
                }
            }
            return "Agent stopped: Reached maximum number of consecutive terminal operations.";
        });
    },
    getEmbedding: async (text) => {
        return await withRetry(async () => {
            const response = await ai.models.embedContent({ model: embedModel, contents: text });
            return response.embeddings[0].values;
        });
    },
    reflectOnMessages: async (messages) => {
        return await withRetry(async () => {
            const prompt = `You are a Meta-Cognitive Analyst... \n\nConversation:\n${messages.map(m => `${m.role}: ${m.content}`).join('\n')}`;
            const response = await ai.models.generateContent({ model: modelName, contents: prompt });
            return response.text.trim();
        });
    }
};