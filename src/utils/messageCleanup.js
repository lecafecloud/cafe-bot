import logger from './logger.js';

// Global keystore instance (set by bot on startup)
let keystore = null;

/**
 * Set the keystore instance
 */
export function setKeystore(keystoreInstance) {
    keystore = keystoreInstance;
    logger.info('MessageCleanup: Keystore configured');
}

/**
 * Schedule a message for deletion
 */
export async function scheduleMessageDeletion(guildId, channelId, messageId, delayMs) {
    if (!keystore) {
        logger.error('Keystore not initialized in messageCleanup');
        return;
    }

    try {
        const scheduledMessages = await keystore.getStore('scheduled-deletions');

        if (!scheduledMessages.messages) {
            scheduledMessages.messages = [];
        }

        // Add the new scheduled deletion
        scheduledMessages.messages.push({
            guildId,
            channelId,
            messageId,
            deleteAt: Date.now() + delayMs,
            createdAt: Date.now()
        });

        // Save to keystore
        await keystore.setStore('scheduled-deletions', scheduledMessages);

        logger.debug(`Scheduled message ${messageId} for deletion in ${delayMs / 1000}s`);

    } catch (error) {
        logger.error('Error scheduling message deletion:', error);
    }
}

/**
 * Process scheduled message deletions
 */
export async function processScheduledDeletions(client) {
    if (!keystore) {
        logger.warn('Keystore not initialized, skipping scheduled deletions');
        return;
    }

    try {
        const scheduledMessages = await keystore.getStore('scheduled-deletions');

        if (!scheduledMessages.messages || scheduledMessages.messages.length === 0) {
            return; // Nothing to process
        }

        const now = Date.now();
        const remainingMessages = [];
        let deletedCount = 0;

        for (const scheduled of scheduledMessages.messages) {
            if (now >= scheduled.deleteAt) {
                // Time to delete this message
                try {
                    const guild = await client.guilds.fetch(scheduled.guildId);
                    const channel = await guild.channels.fetch(scheduled.channelId);

                    if (channel && channel.isTextBased()) {
                        const message = await channel.messages.fetch(scheduled.messageId);
                        await message.delete();
                        deletedCount++;
                        logger.info(`Auto-deleted message ${scheduled.messageId} from channel ${channel.name}`);
                    }
                } catch (error) {
                    // Message might already be deleted or channel/guild might not exist
                    if (error.code === 10008) {
                        logger.debug(`Message ${scheduled.messageId} already deleted`);
                    } else {
                        logger.warn(`Failed to delete message ${scheduled.messageId}:`, error.message);
                    }
                }
            } else {
                // Not yet time to delete, keep it
                remainingMessages.push(scheduled);
            }
        }

        // Update the keystore with remaining messages
        scheduledMessages.messages = remainingMessages;
        await keystore.setStore('scheduled-deletions', scheduledMessages);

        if (deletedCount > 0) {
            logger.info(`Auto-deleted ${deletedCount} messages, ${remainingMessages.length} remaining`);
        }

    } catch (error) {
        logger.error('Error processing scheduled deletions:', error);
    }
}

/**
 * Start the cleanup job
 */
export function startCleanupJob(client) {
    // Run every minute
    const interval = setInterval(async () => {
        await processScheduledDeletions(client);
    }, 60 * 1000); // 60 seconds

    logger.info('Message cleanup job started (runs every 60 seconds)');

    return interval;
}

/**
 * Get stats about scheduled deletions
 */
export async function getScheduledDeletionsStats() {
    if (!keystore) {
        return { total: 0, pending: 0, overdue: 0 };
    }

    try {
        const scheduledMessages = await keystore.getStore('scheduled-deletions');

        if (!scheduledMessages.messages) {
            return { total: 0, pending: 0, overdue: 0 };
        }

        const now = Date.now();
        const total = scheduledMessages.messages.length;
        const overdue = scheduledMessages.messages.filter(m => m.deleteAt <= now).length;
        const pending = total - overdue;

        return { total, pending, overdue };

    } catch (error) {
        logger.error('Error getting scheduled deletions stats:', error);
        return { total: 0, pending: 0, overdue: 0 };
    }
}
