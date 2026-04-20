import fs from 'fs';

const FILE_PATH = 'personality.txt';
const MAX_CHARS = 2000;

export const personalityManager = {
    getPersonality: () => {
        try {
            return fs.readFileSync(FILE_PATH, 'utf-8');
        } catch (e) {
            return "You are a helpful companion."; // Safe fallback
        }
    },
    updatePersonality: (tweak) => {
        const current = personalityManager.getPersonality();
        let updated = current + `\n\n[Suggested Tweak]: ${tweak}`;

        if (updated.length > MAX_CHARS) {
            // Keep the foundational 1000 characters intact, drop older tweaks, keep the newest
            const keepStart = 1000;
            const beginning = updated.slice(0, keepStart);
            const end = updated.slice(-(MAX_CHARS - keepStart - 5)); // -5 for \n...\n
            updated = beginning + "\n...\n" + end;
        }

        fs.writeFileSync(FILE_PATH, updated);
    }
};