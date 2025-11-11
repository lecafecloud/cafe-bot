import logger from './logger.js';
import { getRankByXP, ranks } from '../config/ranks.js';

// Global keystore instance (set by bot on startup)
let keystore = null;

/**
 * Set the keystore instance
 */
export function setKeystore(keystoreInstance) {
    keystore = keystoreInstance;
    logger.info('XP System: Keystore configured');
}

/**
 * Load user level data
 */
export async function loadUserData() {
    if (!keystore) {
        logger.error('Keystore not initialized in xpSystem');
        return {};
    }

    try {
        const data = await keystore.getStore('user-levels');
        return data || {};
    } catch (error) {
        logger.error('Error loading user data:', error);
        return {};
    }
}

/**
 * Save user level data
 */
async function saveUserData(data) {
    if (!keystore) {
        logger.error('Keystore not initialized in xpSystem');
        return;
    }

    try {
        await keystore.setStore('user-levels', data);
    } catch (error) {
        logger.error('Error saving user data:', error);
        throw error;
    }
}

/**
 * Get user XP and level
 */
export async function getUserXP(guildId, userId) {
    const data = await loadUserData();
    const userKey = `${guildId}-${userId}`;

    if (!data[userKey]) {
        return {
            xp: 0,
            lastMessageTime: 0,
            messageCount: 0
        };
    }

    // Support both array format [xp, lastMessageTime, messageCount] and object format
    const userData = data[userKey];
    if (Array.isArray(userData)) {
        return {
            xp: userData[0] || 0,
            lastMessageTime: userData[1] || 0,
            messageCount: userData[2] || 0
        };
    }

    // Legacy object format
    return {
        xp: userData.xp || 0,
        lastMessageTime: userData.lastMessageTime || userData.lmt || 0,
        messageCount: userData.messageCount || userData.mc || 0
    };
}

/**
 * Add XP to user and check for rank up
 * Returns { leveledUp: boolean, oldRank, newRank, totalXP }
 */
export async function addUserXP(guildId, userId, xpAmount) {
    const data = await loadUserData();
    const userKey = `${guildId}-${userId}`;

    // Get current data (supporting both formats)
    const current = await getUserXP(guildId, userId);

    const oldXP = current.xp;
    const oldRank = getRankByXP(oldXP);

    const newXP = oldXP + xpAmount;
    const newMessageCount = current.messageCount + 1;
    const newLastMessageTime = Date.now();

    // Store in compact array format: [xp, lastMessageTime, messageCount]
    data[userKey] = [newXP, newLastMessageTime, newMessageCount];

    const newRank = getRankByXP(newXP);

    await saveUserData(data);

    const leveledUp = newRank.level > oldRank.level;

    return {
        leveledUp,
        oldRank,
        newRank,
        totalXP: newXP,
        xpGained: xpAmount
    };
}

/**
 * Set user XP (admin command)
 */
export async function setUserXP(guildId, userId, xpAmount) {
    const data = await loadUserData();
    const userKey = `${guildId}-${userId}`;

    // Get current data to preserve messageCount and lastMessageTime
    const current = await getUserXP(guildId, userId);

    // Store in compact array format: [xp, lastMessageTime, messageCount]
    data[userKey] = [
        Math.max(0, xpAmount),
        current.lastMessageTime,
        current.messageCount
    ];

    await saveUserData(data);

    return {
        xp: Math.max(0, xpAmount),
        lastMessageTime: current.lastMessageTime,
        messageCount: current.messageCount
    };
}

/**
 * Get leaderboard for a guild
 */
export async function getLeaderboard(guildId, limit = 10) {
    const data = await loadUserData();

    // Filter users from this guild
    const guildUsers = Object.entries(data)
        .filter(([key]) => key.startsWith(`${guildId}-`))
        .map(([key, userData]) => {
            // Support both array and object formats
            let xp, messageCount;
            if (Array.isArray(userData)) {
                xp = userData[0] || 0;
                messageCount = userData[2] || 0;
            } else {
                xp = userData.xp || 0;
                messageCount = userData.messageCount || userData.mc || 0;
            }

            return {
                userId: key.split('-')[1],
                xp,
                messageCount,
                rank: getRankByXP(xp)
            };
        })
        .sort((a, b) => b.xp - a.xp)
        .slice(0, limit);

    return guildUsers;
}

/**
 * Check if user can gain XP (cooldown check)
 */
export function canGainXP(lastMessageTime, cooldownMs = 60000) {
    return Date.now() - lastMessageTime >= cooldownMs;
}

/**
 * Calculate random XP for a message (5-15 XP)
 */
export function getRandomMessageXP() {
    return Math.floor(Math.random() * 11) + 5; // 5 to 15 XP
}

/**
 * Update user's rank role in guild
 */
export async function updateUserRankRole(member, newRank) {
    try {
        // Find all rank roles the user currently has
        const currentRankRoles = member.roles.cache.filter(role =>
            ranks.some(r => r.name === role.name)
        );

        // Remove old rank roles
        if (currentRankRoles.size > 0) {
            await member.roles.remove(currentRankRoles);
            logger.info(`Removed ${currentRankRoles.size} old rank roles from ${member.user.tag}`);
        }

        // Find the new rank role
        const newRankRole = member.guild.roles.cache.find(r => r.name === newRank.name);

        if (newRankRole) {
            await member.roles.add(newRankRole);
            logger.info(`Added rank role ${newRank.name} to ${member.user.tag}`);
            return true;
        } else {
            logger.warn(`Rank role ${newRank.name} not found in guild ${member.guild.name}`);
            return false;
        }
    } catch (error) {
        logger.error('Error updating user rank role:', error);
        return false;
    }
}
