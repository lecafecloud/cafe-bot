import { readdirSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import logger from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default async (client) => {
    const commandsPath = join(__dirname, '..', 'commands');
    const commandFolders = readdirSync(commandsPath);

    for (const folder of commandFolders) {
        const folderPath = join(commandsPath, folder);
        const commandFiles = readdirSync(folderPath).filter(file => file.endsWith('.js'));

        for (const file of commandFiles) {
            const filePath = join(folderPath, file);
            const command = await import(filePath);

            if (command.default?.data && command.default?.execute) {
                client.commands.set(command.default.data.name, command.default);
                logger.info(`Loaded command: ${command.default.data.name}`);
            } else {
                logger.warn(`Command at ${filePath} is missing required properties`);
            }
        }
    }
};