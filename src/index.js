import { Client, Collection, GatewayIntentBits, Partials } from 'discord.js';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readdirSync } from 'fs';
import logger from './utils/logger.js';
import { getKeystore, shutdownKeystore } from './utils/discordKeystore.js';
import { setKeystore as setXPKeystore } from './utils/xpSystem.js';
import { setKeystore as setRoleReactionsKeystore } from './utils/roleReactions.js';
import { setKeystore as setMessageCleanupKeystore, startCleanupJob } from './utils/messageCleanup.js';
import { setKeystore as setAIKeystore } from './utils/aiAssistant.js';
import { setKeystore as setReferralKeystore } from './utils/referralSystem.js';
import { initializeInviteCache } from './events/guildMemberAdd.js';
import { startReferralValidationJob, stopReferralValidationJob } from './utils/referralValidator.js';
import { startStatusRotation, stopStatusRotation } from './utils/statusManager.js';

config();

// Global intervals
let cleanupJobInterval = null;
let referralValidationInterval = null;
let statusRotationInterval = null;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.DirectMessages
    ],
    partials: [
        Partials.Channel,
        Partials.Message,
        Partials.User,
        Partials.GuildMember,
        Partials.Reaction
    ],
    allowedMentions: {
        parse: ['users', 'roles'],
        repliedUser: true
    }
});

client.commands = new Collection();
client.cooldowns = new Collection();

async function loadHandlers() {
    const handlersPath = join(__dirname, 'handlers');
    const handlerFiles = readdirSync(handlersPath).filter(file => file.endsWith('.js'));

    for (const file of handlerFiles) {
        const handler = await import(join(handlersPath, file));
        if (handler.default) {
            await handler.default(client);
            logger.info(`Loaded handler: ${file}`);
        }
    }
}

async function init() {
    try {
        await loadHandlers();
        await client.login(process.env.DISCORD_TOKEN);

        // Wait for client to be ready before initializing keystore
        client.once('ready', async () => {
            logger.info(`Logged in as ${client.user.tag}`);

            // Initialize Discord Keystore
            const keystoreChannelId = process.env.KEYSTORE_CHANNEL_ID;
            if (keystoreChannelId) {
                try {
                    logger.info(`Initializing Discord Keystore with channel ${keystoreChannelId}`);
                    const keystore = await getKeystore(client, keystoreChannelId);

                    // Set keystore for all systems
                    setXPKeystore(keystore);
                    setRoleReactionsKeystore(keystore);
                    setMessageCleanupKeystore(keystore);
                    setAIKeystore(keystore);
                    setReferralKeystore(keystore);

                    logger.info('✅ Discord Keystore initialized successfully!');

                    // Initialize invite cache for referral system
                    await initializeInviteCache(client);

                    // Start message cleanup job
                    cleanupJobInterval = startCleanupJob(client);

                    // Start referral validation job (runs every hour)
                    referralValidationInterval = startReferralValidationJob(client, 60);

                } catch (error) {
                    logger.error('❌ Failed to initialize Discord Keystore:', error);
                    logger.warn('Bot will continue without persistent storage');
                }
            } else {
                logger.warn('⚠️ KEYSTORE_CHANNEL_ID not set - persistence disabled');
            }

            // Start status rotation
            statusRotationInterval = startStatusRotation(client, 5); // Rotate every 5 minutes
        });
    } catch (error) {
        logger.error('Failed to initialize bot:', error);
        process.exit(1);
    }
}

process.on('unhandledRejection', error => {
    logger.error('Unhandled promise rejection:', error);
});

process.on('uncaughtException', error => {
    logger.error('Uncaught exception:', error);
    process.exit(1);
});

// Graceful shutdown
async function shutdown(signal) {
    logger.info(`${signal} received, shutting down gracefully...`);

    try {
        // Stop jobs
        if (cleanupJobInterval) {
            clearInterval(cleanupJobInterval);
            logger.info('Cleanup job stopped');
        }

        if (referralValidationInterval) {
            stopReferralValidationJob(referralValidationInterval);
        }

        if (statusRotationInterval) {
            stopStatusRotation(statusRotationInterval);
        }

        // Sync keystore one last time
        await shutdownKeystore();

        // Destroy Discord client
        client.destroy();

        logger.info('Bot shut down successfully');
        process.exit(0);
    } catch (error) {
        logger.error('Error during shutdown:', error);
        process.exit(1);
    }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

init();