import fs from 'fs';
import path from 'path';


const FILE_PATH = path.resolve(process.cwd(), 'personality.txt');
const MAX_CHARS = 4000;

export const personalityManager = {
    getPersonality: () => {
        try {
            return fs.readFileSync(FILE_PATH, 'utf-8');
        } catch (e) {
            return "You are a helpful companion."; // Safe fallback
        }
    },
    updatePersonality: (newPersonalityText) => {
        let updated = newPersonalityText.trim();

        // Safety fallback: If the LLM generates a novel, strictly cut it off.
        if (updated.length > MAX_CHARS) {
            updated = updated.slice(0, MAX_CHARS);
        }

        fs.writeFileSync(FILE_PATH, updated);
    }
};