import { ActivityType } from 'discord.js';
import logger from './logger.js';
import { loadUserData } from './xpSystem.js';

/**
 * Get community statistics
 */
async function getCommunityStats(client) {
    try {
        const stats = {
            totalMembers: 0,
            totalXP: 0,
            totalMessages: 0,
            activeToday: 0
        };

        // Get member count from first guild
        const guild = client.guilds.cache.first();
        if (guild) {
            stats.totalMembers = guild.memberCount;
        }

        // Get XP stats
        try {
            const userData = await loadUserData();
            const now = Date.now();
            const oneDayAgo = now - (24 * 60 * 60 * 1000);

            for (const [key, data] of Object.entries(userData)) {
                // Support both array and object formats
                let xp, messageCount, lastMessageTime;

                if (Array.isArray(data)) {
                    xp = data[0] || 0;
                    lastMessageTime = data[1] || 0;
                    messageCount = data[2] || 0;
                } else {
                    xp = data.xp || 0;
                    lastMessageTime = data.lastMessageTime || 0;
                    messageCount = data.messageCount || 0;
                }

                stats.totalXP += xp;
                stats.totalMessages += messageCount;

                if (lastMessageTime >= oneDayAgo) {
                    stats.activeToday++;
                }
            }
        } catch (error) {
            logger.warn('Failed to load XP stats for status:', error.message);
        }

        return stats;
    } catch (error) {
        logger.error('Error getting community stats:', error);
        return {
            totalMembers: 0,
            totalXP: 0,
            totalMessages: 0,
            activeToday: 0
        };
    }
}

/**
 * Format number for display (k, M notation)
 */
function formatNumber(num) {
    if (num >= 1000000) {
        return (num / 1000000).toFixed(1) + 'M';
    } else if (num >= 1000) {
        return (num / 1000).toFixed(1) + 'k';
    }
    return num.toString();
}

/**
 * Get status rotation array
 */
async function getStatusRotation(client) {
    const stats = await getCommunityStats(client);

    // Calculate "coffees served" based on total XP (1 coffee = 100 XP)
    const coffeesServed = Math.floor(stats.totalXP / 100);

    const statuses = [
        {
            type: ActivityType.Watching,
            name: `${formatNumber(stats.totalMembers)} membres ☕`,
        },
        {
            type: ActivityType.Playing,
            name: `${formatNumber(coffeesServed)} cafés servis ☕`,
        },
        {
            type: ActivityType.Listening,
            name: `${formatNumber(stats.totalMessages)} messages 💬`,
        },
        {
            type: ActivityType.Watching,
            name: `${stats.activeToday} actifs aujourd'hui 🔥`,
        },
        {
            type: ActivityType.Playing,
            name: `Café & Cloud Engineering ☁️`,
        },
        {
            type: ActivityType.Listening,
            name: '/rangs pour ta progression 📊',
        }
    ];

    return statuses;
}

/**
 * Update bot status
 */
export async function updateStatus(client) {
    try {
        const statuses = await getStatusRotation(client);

        // Pick a random status from the rotation
        const status = statuses[Math.floor(Math.random() * statuses.length)];

        await client.user.setPresence({
            activities: [{
                name: status.name,
                type: status.type
            }],
            status: 'online'
        });

        logger.debug(`Updated status to: ${status.name}`);
    } catch (error) {
        logger.error('Error updating status:', error);
    }
}

/**
 * Start status rotation
 * Changes status every X minutes
 */
export function startStatusRotation(client, intervalMinutes = 5) {
    // Set initial status
    updateStatus(client);

    // Rotate status every X minutes
    const interval = setInterval(() => {
        updateStatus(client);
    }, intervalMinutes * 60 * 1000);

    logger.info(`Status rotation started (every ${intervalMinutes} minutes)`);

    return interval;
}

/**
 * Stop status rotation
 */
export function stopStatusRotation(interval) {
    if (interval) {
        clearInterval(interval);
        logger.info('Status rotation stopped');
    }
}
