import fs from 'fs';

const LOG_FILE = '../logs.txt';
const MAX_LINES = 50;

export const logger = {
    log: (level, message) => {
        const timestamp = new Date().toISOString();
        const logEntry = `[${timestamp}] [${level}] ${message}`;

        // Ensure file exists
        if (!fs.existsSync(LOG_FILE)) {
            fs.writeFileSync(LOG_FILE, '');
        }

        // Append the new log entry
        fs.appendFileSync(LOG_FILE, logEntry + '\n');

        // Truncate to keep only the last 50 lines
        const fileContent = fs.readFileSync(LOG_FILE, 'utf-8').trim();
        const lines = fileContent.split('\n');
        
        if (lines.length > MAX_LINES) {
            const truncated = lines.slice(-MAX_LINES).join('\n') + '\n';
            fs.writeFileSync(LOG_FILE, truncated);
        }
    }
};