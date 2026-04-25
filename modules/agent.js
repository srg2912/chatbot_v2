import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';

const execAsync = promisify(exec);

// Safety Definitions
const PROJECT_DIR = process.cwd(); 
const PROJECT_DIR_NAME = path.basename(PROJECT_DIR); 

// Create a safe sandbox directory one level above the project folder
const WORKSPACE_DIR = path.resolve(PROJECT_DIR, '../agent_workspace');
if (!fs.existsSync(WORKSPACE_DIR)) {
    fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
}

// Words the bot is completely banned from using in terminal commands
const DANGEROUS_KEYWORDS =[
    PROJECT_DIR_NAME, 
    'chatbot_v2', 
    'personality.txt', 
    'logs.txt', 
    '.env', 
    'index.js', 
    'db.js'
];

// Tool Definitions for Gemini
export const tools = [{
    functionDeclarations:[
        {
            name: 'execute_terminal',
            description: 'Executes a bash command on the terminal.',
            parameters: {
                type: 'OBJECT',
                properties: {
                    command: { type: 'STRING', description: 'The bash command to run' }
                },
                required: ['command']
            }
        },
        {
            name: 'read_file',
            description: 'Reads the contents of a file in the workspace.',
            parameters: {
                type: 'OBJECT',
                properties: {
                    filename: { type: 'STRING', description: 'Name of the file to read' }
                },
                required: ['filename']
            }
        },
        {
            name: 'write_file',
            description: 'Writes code or text to a file in the workspace.',
            parameters: {
                type: 'OBJECT',
                properties: {
                    filename: { type: 'STRING', description: 'Name of the file' },
                    content: { type: 'STRING', description: 'The exact content to write' }
                },
                required: ['filename', 'content']
            }
        }
    ]
}];

export const executeTool = async (name, args) => {
    try {
        if (name === 'execute_terminal') {
            const cmd = args.command;
            
            // Safety Check
            for (const kw of DANGEROUS_KEYWORDS) {
                if (cmd.includes(kw)) {
                    return `[SYSTEM ERROR] Access Denied: Command blocked to protect system files.`;
                }
            }

            // Run command with a 15-second timeout inside the Sandbox
            const { stdout, stderr } = await execAsync(cmd, { cwd: WORKSPACE_DIR, timeout: 15000 });
            return stdout || stderr || "Command executed successfully with no output.";
        }

        if (name === 'read_file' || name === 'write_file') {
            const targetPath = path.resolve(WORKSPACE_DIR, args.filename);
            
            // Prevent directory traversal (e.g., passing "../../chatbot_v2/index.js")
            if (!targetPath.startsWith(WORKSPACE_DIR)) {
                return `[SYSTEM ERROR] Access Denied: You must stay within the workspace.`;
            }

            if (name === 'read_file') {
                if (!fs.existsSync(targetPath)) return "Error: File not found.";
                return fs.readFileSync(targetPath, 'utf-8');
            }

            if (name === 'write_file') {
                fs.writeFileSync(targetPath, args.content, 'utf-8');
                return "File written successfully.";
            }
        }

        return "Error: Unknown tool.";
    } catch (error) {
        return `Execution Error: ${error.message}`;
    }
};