import logger from './logger.js';

// Global keystore instance (set by bot on startup)
let keystore = null;

/**
 * Set the keystore instance
 */
export function setKeystore(keystoreInstance) {
    keystore = keystoreInstance;
    logger.info('RoleReactions: Keystore configured');
}

/**
 * Load role reactions from keystore
 */
async function loadRoleReactions() {
    if (!keystore) {
        logger.error('Keystore not initialized in roleReactions');
        return [];
    }

    try {
        const data = await keystore.getStore('role-reactions');
        // Store as object with reactions array
        return data?.reactions || [];
    } catch (error) {
        logger.error('Error loading role reactions:', error);
        return [];
    }
}

/**
 * Save role reactions to keystore
 */
async function saveRoleReactions(reactions) {
    if (!keystore) {
        logger.error('Keystore not initialized in roleReactions');
        return;
    }

    try {
        await keystore.setStore('role-reactions', { reactions });
    } catch (error) {
        logger.error('Error saving role reactions:', error);
        throw error;
    }
}

/**
 * Add a new role reaction mapping
 */
export async function addRoleReaction(guildId, channelId, messageId, emoji, roleId) {
    const reactions = await loadRoleReactions();

    // Normalize emoji (remove variation selectors for consistency)
    const normalizedEmoji = emoji.replace(/[\u{FE00}-\u{FE0F}]/gu, '');

    const newReaction = {
        guildId,
        channelId,
        messageId,
        emoji: normalizedEmoji,
        roleId,
        createdAt: new Date().toISOString()
    };

    reactions.push(newReaction);
    await saveRoleReactions(reactions);

    logger.info(`Added role reaction: ${emoji} -> ${roleId} on message ${messageId}`);
}

/**
 * Get role for a specific message and emoji
 */
export async function getRoleForReaction(messageId, emoji) {
    const reactions = await loadRoleReactions();

    // Normalize emoji (remove variation selectors for consistency)
    const normalizedEmoji = emoji.replace(/[\u{FE00}-\u{FE0F}]/gu, '');

    const match = reactions.find(
        r => r.messageId === messageId && r.emoji === normalizedEmoji
    );

    return match ? match.roleId : null;
}

/**
 * Remove a role reaction mapping
 */
export async function removeRoleReaction(messageId, emoji) {
    const reactions = await loadRoleReactions();

    // Normalize emoji
    const normalizedEmoji = emoji.replace(/[\u{FE00}-\u{FE0F}]/gu, '');

    const filtered = reactions.filter(
        r => !(r.messageId === messageId && r.emoji === normalizedEmoji)
    );

    await saveRoleReactions(filtered);
    logger.info(`Removed role reaction: ${emoji} from message ${messageId}`);
}

/**
 * Get all role reactions for a guild
 */
export async function getRoleReactionsForGuild(guildId) {
    const reactions = await loadRoleReactions();
    return reactions.filter(r => r.guildId === guildId);
}

/**
 * Clean up deleted messages/roles
 */
export async function cleanupRoleReactions(client) {
    const reactions = await loadRoleReactions();
    const validReactions = [];

    for (const reaction of reactions) {
        try {
            const guild = await client.guilds.fetch(reaction.guildId);
            const role = await guild.roles.fetch(reaction.roleId);

            if (role) {
                validReactions.push(reaction);
            } else {
                logger.info(`Removing role reaction for deleted role: ${reaction.roleId}`);
            }
        } catch (error) {
            logger.warn(`Failed to validate reaction on message ${reaction.messageId}:`, error.message);
        }
    }

    if (validReactions.length !== reactions.length) {
        await saveRoleReactions(validReactions);
        logger.info(`Cleaned up ${reactions.length - validReactions.length} invalid role reactions`);
    }
}
