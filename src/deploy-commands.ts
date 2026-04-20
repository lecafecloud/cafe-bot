import { REST, Routes } from 'discord.js';
import { config } from 'dotenv';
import { readdirSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import logger from './utils/logger.js';

config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const commands = [];
const commandsPath = join(__dirname, 'commands');
const commandFolders = readdirSync(commandsPath);

async function loadCommands() {
    for (const folder of commandFolders) {
        const folderPath = join(commandsPath, folder);
        const commandFiles = readdirSync(folderPath).filter(file => file.endsWith('.js'));

        for (const file of commandFiles) {
            const filePath = join(folderPath, file);
            const command = await import(filePath);

            if (command.default?.data) {
                commands.push(command.default.data.toJSON());
                logger.info(`Loaded command: ${command.default.data.name}`);
            }
        }
    }
}

async function deployCommands() {
    try {
        await loadCommands();

        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

        logger.info(`Started refreshing ${commands.length} application (/) commands.`);

        if (process.env.GUILD_ID) {
            await rest.put(
                Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
                { body: commands }
            );
            logger.info(`Successfully deployed commands to guild ${process.env.GUILD_ID}`);
        } else {
            await rest.put(
                Routes.applicationCommands(process.env.CLIENT_ID),
                { body: commands }
            );
            logger.info('Successfully deployed commands globally');
        }

    } catch (error) {
        logger.error('Failed to deploy commands:', error);
        process.exit(1);
    }
}

deployCommands();