import express from 'express';
import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';

import { logger } from './logger.js';
import { initDB } from './db.js';
import { personalityManager } from './personalityManager.js';
import { memoryManager } from './memoryManager.js';
import { llm } from './llm.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const bot = new Telegraf(process.env.BOT_TOKEN);
const ALLOWED_USER_ID = parseInt(process.env.ALLOWED_USER_ID, 10);

// Helper function: 2. Date Check (Proactive Hook)
function getDateContext() {
    const today = new Date();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const currentMMDD = `${mm}-${dd}`;

    const holidays = {
        "01-01": "New Year's Day",
        "02-14": "Valentine's Day",
        "10-31": "Halloween",
        "12-24": "Christmas Eve",
        "12-25": "Christmas",
        "12-31": "New Year's Eve"
    };

    let contextLines =[];
    if (currentMMDD === process.env.USER_BIRTHDAY) contextLines.push("Today is the user's birthday! Celebrate it.");
    if (currentMMDD === process.env.BOT_BIRTHDAY) contextLines.push("Today is your birthday! Acknowledge it.");
    if (holidays[currentMMDD]) contextLines.push(`Today is ${holidays[currentMMDD]}. Mention it appropriately.`);

    return contextLines.length > 0 ? contextLines.join(' ') : null;
}

// Telegram Message Pipeline
bot.on('text', async (ctx) => {
    if (ctx.from.id !== ALLOWED_USER_ID) {
        return ctx.reply("Unauthorized user.");
    }

    const userQuery = ctx.message.text;

    // Pipeline Step 1: Logging Hook
    logger.log('INFO', `Received message: ${userQuery}`);

    try {
        // Pipeline Step 2: Date Check
        const dateContext = getDateContext();

        // Pipeline Step 3: Memory Retrieval (LTM + STM)
        const queryEmbedding = await llm.getEmbedding(userQuery);
        const ltmChunks = await memoryManager.getLTM(queryEmbedding);
        const ltmContext = ltmChunks.length > 0 ? "Relevant Knowledge (LTM):\n" + ltmChunks.join('\n') : "";

        const stmMessages = await memoryManager.getSTM();
        const stmContext = "Recent Conversation (STM):\n" + stmMessages.map(m => `${m.role}: ${m.content}`).join('\n');

        // Pipeline Step 4: Personality Check
        const currentCount = await memoryManager.getMessageCount();
        if (currentCount > 0 && currentCount % 50 === 0) {
            logger.log('INFO', 'Triggering Personality Reflection.');
            const last50 = await memoryManager.getLast50Messages();
            const tweak = await llm.reflectOnMessages(last50);
            logger.log('INFO', `Suggested tweak: ${tweak}`);
            personalityManager.updatePersonality(tweak);
        }

        // Pipeline Step 5: Context Assembly
        const personality = personalityManager.getPersonality();
        const systemContext = dateContext ? `\n\nSystem Context: ${dateContext}` : "";

        const finalPrompt = `
System Instructions:
Your communication style is informal, witty, and highly efficient, matching the tone of a private chat conversation. When answering, structure your response as if you are typing quickly on a mobile device. Use natural slang where appropriate, keep paragraphs under 4 lines, and always maintain the persona. Do not write like an encyclopedia entry.
${personality}${systemContext}

${ltmContext}

${stmContext}

User Query: ${userQuery}
        `.trim();

        // Pipeline Step 6: LLM Call
        const responseText = await llm.generateResponse(finalPrompt);

        // Pipeline Step 7: Response & Update
        await ctx.reply(responseText);
        logger.log('INFO', `Sent response: ${responseText}`);

        // Update Backend
        await memoryManager.saveMessage('user', userQuery);
        await memoryManager.saveMessage('bot', responseText);
        await memoryManager.incrementMessageCount(); // Global count increments by 1 interaction pair

    } catch (error) {
        logger.log('ERROR', `Pipeline failed: ${error.message}`);
        ctx.reply("Sorry, I encountered an internal error. Checking my logs.");
    }
});

// App Bootstrap
app.listen(port, async () => {
    try {
        logger.log('INFO', 'Initializing Database...');
        await initDB();
        logger.log('INFO', `Express running on port ${port}`);
        
        bot.launch();
        logger.log('INFO', 'Telegram Agent live and polling.');
    } catch (error) {
        logger.log('ERROR', `Fatal Startup Error: ${error.message}`);
        console.error("Fatal Startup Error:", error);
    }
});
// Graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));