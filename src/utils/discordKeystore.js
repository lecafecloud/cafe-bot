import logger from './logger.js';
import { setTimeout as sleep } from 'timers/promises';

/**
 * DiscordKeystore - Use a Discord channel as a key-value store
 *
 * Stores data in Discord messages and syncs periodically
 * Each "store" gets its own message in the channel
 */
export class DiscordKeystore {
    constructor(client, channelId, syncIntervalMs = 5 * 60 * 1000) {
        this.client = client;
        this.channelId = channelId;
        this.syncIntervalMs = syncIntervalMs;
        this.stores = new Map(); // storeName -> { data, messageIds: [], dirty }
        this.channel = null;
        this.initialized = false;
        this.syncInterval = null;
        this.isSyncing = false;
        this.maxMessageSize = 1900; // Leave some margin under Discord's 2000 limit
    }

    /**
     * Initialize the keystore
     */
    async initialize() {
        if (this.initialized) {
            logger.warn('DiscordKeystore already initialized');
            return;
        }

        try {
            // Fetch the channel
            this.channel = await this.client.channels.fetch(this.channelId);

            if (!this.channel || !this.channel.isTextBased()) {
                throw new Error(`Channel ${this.channelId} is not a text channel`);
            }

            logger.info(`DiscordKeystore initialized with channel: ${this.channel.name}`);

            // Load existing data from channel
            await this.loadFromChannel();

            // Start auto-sync
            this.startAutoSync();

            this.initialized = true;

            logger.info(`DiscordKeystore ready with ${this.stores.size} stores`);

        } catch (error) {
            logger.error('Failed to initialize DiscordKeystore:', error);
            throw error;
        }
    }

    /**
     * Load all data from the Discord channel
     */
    async loadFromChannel() {
        try {
            const messages = await this.channel.messages.fetch({ limit: 100 });

            // Group messages by store name with timestamp for auto-healing
            const storeMessages = new Map(); // storeName -> array of {part, total, data, messageId, timestamp, message}

            for (const [messageId, message] of messages) {
                // Skip messages not from the bot
                if (message.author.id !== this.client.user.id) continue;

                // Skip empty messages
                if (!message.content) continue;

                try {
                    // Parse the message content
                    const parsed = JSON.parse(message.content);

                    // Support both old and new format for backward compatibility
                    const storeName = parsed.s || parsed.__storeName;
                    const data = parsed.d || parsed.__data;
                    const partNum = parsed.p || 1; // Part number (1-indexed)
                    const totalParts = parsed.tp || 1; // Total parts
                    const timestamp = parsed.t || 0;

                    if (storeName && data !== undefined) {
                        if (!storeMessages.has(storeName)) {
                            storeMessages.set(storeName, []);
                        }

                        storeMessages.get(storeName).push({
                            part: partNum,
                            total: totalParts,
                            data: data,
                            messageId: messageId,
                            timestamp: timestamp,
                            message: message
                        });
                    }
                } catch (parseError) {
                    logger.warn(`Failed to parse message ${messageId}:`, parseError.message);
                }
            }

            // Auto-healing: detect and remove duplicates (keep most recent)
            let duplicatesRemoved = 0;
            for (const [storeName, parts] of storeMessages) {
                // Group by part number to find duplicates
                const partGroups = new Map(); // partNum -> [{timestamp, messageId, message, data, total}]

                for (const part of parts) {
                    if (!partGroups.has(part.part)) {
                        partGroups.set(part.part, []);
                    }
                    partGroups.get(part.part).push(part);
                }

                // For each part number, if there are duplicates, keep the newest
                for (const [partNum, group] of partGroups) {
                    if (group.length > 1) {
                        // Sort by timestamp (newest first)
                        group.sort((a, b) => b.timestamp - a.timestamp);

                        // Delete all except the first (newest)
                        for (let i = 1; i < group.length; i++) {
                            try {
                                await group[i].message.delete();
                                duplicatesRemoved++;
                                logger.debug(`Auto-healing: deleted duplicate for store "${storeName}" part ${partNum}`);

                                // Remove from the main parts array
                                const index = parts.indexOf(group[i]);
                                if (index > -1) {
                                    parts.splice(index, 1);
                                }

                                await sleep(100); // Small delay to avoid rate limits
                            } catch (error) {
                                logger.warn(`Failed to delete duplicate message ${group[i].messageId}:`, error.message);
                            }
                        }
                    }
                }
            }

            if (duplicatesRemoved > 0) {
                logger.info(`Auto-healing: removed ${duplicatesRemoved} duplicate message(s) from keystore`);
            }

            // Reconstruct stores from parts
            for (const [storeName, parts] of storeMessages) {
                // Sort by part number
                parts.sort((a, b) => a.part - b.part);

                if (parts.length === 1 && parts[0].total === 1) {
                    // Single-part store
                    this.stores.set(storeName, {
                        data: parts[0].data,
                        messageIds: [parts[0].messageId],
                        dirty: false
                    });
                    logger.info(`Loaded store "${storeName}" from message ${parts[0].messageId}`);
                } else {
                    // Multi-part store - merge the data
                    const mergedData = {};
                    const messageIds = [];

                    for (const part of parts) {
                        Object.assign(mergedData, part.data);
                        messageIds.push(part.messageId);
                    }

                    this.stores.set(storeName, {
                        data: mergedData,
                        messageIds: messageIds,
                        dirty: false
                    });
                    logger.info(`Loaded store "${storeName}" from ${parts.length} messages (${parts.length}/${parts[0].total} parts)`);
                }
            }

        } catch (error) {
            logger.error('Failed to load data from channel:', error);
        }
    }

    /**
     * Get or create a store
     */
    async getStore(storeName) {
        if (!this.initialized) {
            await this.initialize();
        }

        if (!this.stores.has(storeName)) {
            // Create new store
            this.stores.set(storeName, {
                data: {},
                messageIds: [],
                dirty: true
            });

            logger.info(`Created new store: ${storeName}`);
        }

        return this.stores.get(storeName).data;
    }

    /**
     * Set data in a store
     */
    async setStore(storeName, data) {
        if (!this.initialized) {
            await this.initialize();
        }

        const store = this.stores.get(storeName);

        if (store) {
            store.data = data;
            store.dirty = true;
        } else {
            this.stores.set(storeName, {
                data: data,
                messageIds: [],
                dirty: true
            });
        }

        logger.debug(`Store "${storeName}" marked dirty`);
    }

    /**
     * Mark a store as dirty (needs sync)
     */
    markDirty(storeName) {
        const store = this.stores.get(storeName);
        if (store) {
            store.dirty = true;
        }
    }

    /**
     * Sync all dirty stores to Discord
     */
    async sync(force = false) {
        if (!this.initialized) {
            logger.warn('Cannot sync: DiscordKeystore not initialized');
            return;
        }

        if (this.isSyncing) {
            logger.debug('Sync already in progress, skipping');
            return;
        }

        this.isSyncing = true;

        try {
            let syncedCount = 0;

            for (const [storeName, store] of this.stores) {
                if (!store.dirty && !force) {
                    continue; // Skip clean stores
                }

                try {
                    const timestamp = Date.now();
                    const fullData = JSON.stringify(store.data);

                    // Calculate if we need pagination
                    const testMessage = JSON.stringify({
                        s: storeName,
                        t: timestamp,
                        d: store.data
                    });

                    let messageParts = [];

                    if (testMessage.length <= this.maxMessageSize) {
                        // Single message is enough
                        messageParts = [{
                            s: storeName,
                            t: timestamp,
                            p: 1,
                            tp: 1,
                            d: store.data
                        }];
                    } else {
                        // Need to split into multiple messages
                        logger.info(`Store "${storeName}" is too large (${testMessage.length} chars), splitting into parts...`);

                        // Split the data object into chunks
                        const entries = Object.entries(store.data);
                        const parts = [];
                        let currentPart = {};
                        let currentSize = 0;

                        for (const [key, value] of entries) {
                            const entrySize = JSON.stringify({[key]: value}).length;
                            const partTestSize = JSON.stringify({
                                s: storeName,
                                t: timestamp,
                                p: 1,
                                tp: 999,
                                d: {...currentPart, [key]: value}
                            }).length;

                            if (partTestSize > this.maxMessageSize && Object.keys(currentPart).length > 0) {
                                // Current part is full, save it
                                parts.push({...currentPart});
                                currentPart = {[key]: value};
                            } else {
                                currentPart[key] = value;
                            }
                        }

                        // Add the last part
                        if (Object.keys(currentPart).length > 0) {
                            parts.push(currentPart);
                        }

                        // Create message parts
                        const totalParts = parts.length;
                        messageParts = parts.map((partData, index) => ({
                            s: storeName,
                            t: timestamp,
                            p: index + 1,
                            tp: totalParts,
                            d: partData
                        }));

                        logger.info(`Split store "${storeName}" into ${totalParts} parts`);
                    }

                    // Delete ALL old messages for this store (scan channel to handle multi-instance race conditions)
                    // This prevents duplicate messages when multiple bot instances sync simultaneously
                    const allMessages = await this.channel.messages.fetch({ limit: 100 });
                    let deletedCount = 0;

                    for (const [messageId, message] of allMessages) {
                        if (message.author.id !== this.client.user.id) continue;
                        if (!message.content) continue;

                        try {
                            const parsed = JSON.parse(message.content);
                            const msgStoreName = parsed.s || parsed.__storeName;

                            if (msgStoreName === storeName) {
                                await message.delete();
                                deletedCount++;
                                logger.debug(`Deleted old message ${messageId} for store "${storeName}"`);
                                await sleep(100); // Small delay to avoid rate limits
                            }
                        } catch (error) {
                            // Not a valid store message, skip
                        }
                    }

                    if (deletedCount > 0) {
                        logger.debug(`Deleted ${deletedCount} old message(s) for store "${storeName}"`);
                    }

                    // Send new messages
                    const newMessageIds = [];
                    for (const part of messageParts) {
                        const messageContent = JSON.stringify(part);
                        const newMessage = await this.channel.send(messageContent);
                        newMessageIds.push(newMessage.id);

                        logger.debug(`Created message ${newMessage.id} for store "${storeName}" part ${part.p}/${part.tp}`);

                        // Small delay to avoid rate limits
                        await sleep(100);
                    }

                    store.messageIds = newMessageIds;
                    store.dirty = false;
                    syncedCount++;

                    if (messageParts.length > 1) {
                        logger.info(`Synced store "${storeName}" using ${messageParts.length} messages`);
                    }

                } catch (error) {
                    logger.error(`Failed to sync store "${storeName}":`, error);
                }
            }

            if (syncedCount > 0) {
                logger.info(`Synced ${syncedCount} stores to Discord`);
            }

        } catch (error) {
            logger.error('Error during sync:', error);
        } finally {
            this.isSyncing = false;
        }
    }

    /**
     * Start auto-sync interval
     */
    startAutoSync() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
        }

        this.syncInterval = setInterval(async () => {
            logger.debug('Auto-sync triggered');
            await this.sync();
        }, this.syncIntervalMs);

        logger.info(`Auto-sync started (every ${this.syncIntervalMs / 1000}s)`);
    }

    /**
     * Stop auto-sync and perform final sync
     */
    async shutdown() {
        logger.info('Shutting down DiscordKeystore...');

        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
        }

        // Final sync
        await this.sync(true);

        logger.info('DiscordKeystore shut down');
    }

    /**
     * Get stats about the keystore
     */
    getStats() {
        const stats = {
            totalStores: this.stores.size,
            dirtyStores: 0,
            totalSize: 0
        };

        for (const [storeName, store] of this.stores) {
            if (store.dirty) stats.dirtyStores++;

            const size = JSON.stringify(store.data).length;
            stats.totalSize += size;
        }

        return stats;
    }
}

// Singleton instance
let keystoreInstance = null;

/**
 * Get or create the keystore instance
 */
export async function getKeystore(client, channelId) {
    if (!keystoreInstance) {
        keystoreInstance = new DiscordKeystore(client, channelId);
        await keystoreInstance.initialize();
    }
    return keystoreInstance;
}

/**
 * Shutdown the keystore (call before bot stops)
 */
export async function shutdownKeystore() {
    if (keystoreInstance) {
        await keystoreInstance.shutdown();
        keystoreInstance = null;
    }
}
