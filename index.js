import express from 'express';
import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';

import { logger } from './modules/logger.js';
import { initDB } from './modules/db.js';
import { personalityManager } from './modules/personalityManager.js';
import { memoryManager } from './modules/memoryManager.js';
import { llm } from './modules/llm.js';

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

// Emergency Loop-Breaker Command
bot.command('reset', async (ctx) => {
    if (ctx.from.id !== ALLOWED_USER_ID) return;
    
    await memoryManager.clearSTM();
    logger.log('INFO', 'User triggered STM reset to break conversational loop.');
    ctx.reply("🧠 *Shakes head* Whoa... I just completely cleared my short-term memory cache. What were we just talking about? (Loop broken!)", { parse_mode: 'Markdown' });
});

// Listen to both text and photos
bot.on(['text', 'photo'], async (ctx) => {
    if (ctx.from.id !== ALLOWED_USER_ID) {
        return ctx.reply("Unauthorized user.");
    }

    let userQuery = "";
    let imagePart = null;

    try {
        // Handle normal text messages
        if (ctx.message.text) {
            userQuery = ctx.message.text;
        } 
        // Handle image messages
        else if (ctx.message.photo) {
            // If you send a photo without a caption, use a default fallback for the LTM embedding
            userQuery = ctx.message.caption || "Please look at this image and respond to it.";
            
            // Telegram sends multiple resolutions. .pop() gets the highest quality one.
            const highestResPhoto = ctx.message.photo.pop();
            const fileLink = await ctx.telegram.getFileLink(highestResPhoto.file_id);
            
            // Download the image directly from Telegram
            const response = await fetch(fileLink.href);
            const arrayBuffer = await response.arrayBuffer();
            const base64Image = Buffer.from(arrayBuffer).toString('base64');
            
            // Format it for the Google GenAI SDK
            imagePart = {
                inlineData: {
                    data: base64Image,
                    mimeType: 'image/jpeg'
                }
            };
        }

        // Pipeline Step 1: Logging Hook
        logger.log('INFO', `Received message/image with text: ${userQuery}`);

        // Pipeline Step 2: Date Check
        const dateContext = getDateContext();

        // Pipeline Step 3: Short & Long-Term Memory Retrieval
        const queryEmbedding = await llm.getEmbedding(userQuery);
        const ltmChunks = await memoryManager.getLTM(queryEmbedding);
        const ltmContext = ltmChunks.length > 0 ? "Relevant Knowledge (LTM):\n" + ltmChunks.join('\n') : "";

        const stmMessages = await memoryManager.getSTM();
        const stmContext = "Recent Conversation (STM):\n" + stmMessages.map(m => `${m.role}: ${m.content}`).join('\n');

        // NEW Pipeline Step 3.5: Mid-Term Memory (Diary) Retrieval
        const diaryEntries = await memoryManager.getLast5DiaryEntries();
        const mtmContext = diaryEntries.length > 0 
            ? "Mid-Term Memory (Recent Diary Entries):\n" + diaryEntries.map((e, i) => `Entry ${i + 1}: ${e}`).join('\n') 
            : "";

        // Pipeline Step 4: System States (Diary & Personality Checks)
        const currentCount = await memoryManager.getMessageCount();
        
        // Check for Mid-Term Memory update (Every 20 interactions)
        if (currentCount > 0 && currentCount % 20 === 0) {
            logger.log('INFO', 'Triggering Diary Entry Generation.');
            const last40 = await memoryManager.getMessagesForDiary();
            
            // Only generate if we actually have messages to summarize
            if (last40.length > 0) { 
                const diaryEntry = await llm.generateDiaryEntry(last40);
                await memoryManager.saveDiaryEntry(diaryEntry);
                logger.log('INFO', `Diary entry saved.`);
            }
        }

        // Check for Personality Evolution (Every 50 interactions)
        if (currentCount > 0 && currentCount % 50 === 0) {
            logger.log('INFO', 'Triggering Personality Evolution.');
            const last50 = await memoryManager.getLast50Messages();
            const currentPersonality = personalityManager.getPersonality();
            const newPersonality = await llm.evolvePersonality(currentPersonality, last50);
            
            if (newPersonality && newPersonality.length > 50) {
                logger.log('INFO', `Personality organically evolved.`);
                personalityManager.updatePersonality(newPersonality);
            }
        }

        // Pipeline Step 5: Context Assembly
        const personality = personalityManager.getPersonality();
        const systemContext = dateContext ? `\n\nSystem Context: ${dateContext}` : "";
        const agentContext = `\n\n[AGENT CAPABILITIES ENABLED]
You now have access to the Raspberry Pi terminal and filesystem via Tools.
- You can write code, run Python/Bash scripts, ping servers, and manage files.
- Your designated workspace is: ../agent_workspace
- SYSTEM SAFETY RULE: You are STRICTLY FORBIDDEN from reading, modifying, or deleting your own source code. The backend will block these attempts.
- Be proactive! If the user asks you to write a script, use 'write_file' and 'execute_terminal' to actually create and run it on the system!`;

        const finalPromptText = `
System Instructions:
${personality}${systemContext}${agentContext}

CRITICAL COMMUNICATION RULE:
Do NOT repeat the same sentence structures, formatting, or conversational patterns over and over. Vary your responses, keep them natural, and be highly dynamic.When answering, structure your response as if you are typing quickly on a mobile device. Use natural slang where appropriate but don't overdoit, keep paragraphs under 4 lines, and always maintain the persona.

${ltmContext}

${mtmContext}

${stmContext}

User Query: ${userQuery}
        `.trim();

        // Create the prompt payload. If there is an image, append it to the text prompt!
        const promptPayload = [{ text: finalPromptText }];
        if (imagePart) promptPayload.push(imagePart);

        // Pipeline Step 6: LLM Call
        const responseText = await llm.generateResponse(promptPayload);

        // Pipeline Step 7: Response & Update
        await ctx.reply(responseText);
        logger.log('INFO', `Sent response: ${responseText}`);

        // Update Backend
        await memoryManager.saveMessage('user', userQuery);
        await memoryManager.saveMessage('bot', responseText);
        await memoryManager.incrementMessageCount();

    } catch (error) {
        const errorDetails = JSON.stringify(error, Object.getOwnPropertyNames(error));
        logger.log('ERROR', `Pipeline failed. Message: ${error.message} | Full Dump: ${errorDetails}`);
        ctx.reply("Sorry, my brain just glitched for a second. Could you repeat that?");
    }
});

// App Bootstrap
app.listen(port, async () => {
    try {
        logger.log('INFO', 'Initializing Database...');
        await initDB();
        logger.log('INFO', `Express running on port ${port}`);

        // ADD THESE TWO LINES:
        await bot.telegram.deleteWebhook({ drop_pending_updates: true });
        logger.log('INFO', 'Webhook cleared, starting polling...');

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