import logger from './logger.js';
import { getUserXP } from './xpSystem.js';
import { getRankByXP } from '../config/ranks.js';

// Keystore instance
let keystore = null;

/**
 * Set the keystore instance
 */
export function setKeystore(keystoreInstance) {
    keystore = keystoreInstance;
    logger.info('Referral System: Keystore configured');
}

/**
 * Load referral data from keystore
 */
async function loadReferralData() {
    if (!keystore) {
        return { invites: {}, users: {} };
    }

    try {
        const data = await keystore.getStore('referral-system');
        return data || { invites: {}, users: {} };
    } catch (error) {
        logger.error('Error loading referral data:', error);
        return { invites: {}, users: {} };
    }
}

/**
 * Save referral data to keystore
 */
async function saveReferralData(data) {
    if (!keystore) {
        return;
    }

    try {
        await keystore.setStore('referral-system', data);
    } catch (error) {
        logger.error('Error saving referral data:', error);
    }
}

/**
 * Register a new invite code for a user
 */
export async function registerInvite(inviteCode, userId) {
    const data = await loadReferralData();

    // Ensure data structure exists
    if (!data.invites) data.invites = {};
    if (!data.users) data.users = {};

    // Store the mapping: inviteCode -> userId
    data.invites[inviteCode] = userId;

    // Initialize user data if doesn't exist
    if (!data.users[userId]) {
        data.users[userId] = {
            inviteCode,
            referrals: [],      // Validated referrals
            pending: [],        // Pending validation
            totalReferrals: 0
        };
    } else {
        data.users[userId].inviteCode = inviteCode;
    }

    await saveReferralData(data);
    logger.info(`Registered invite ${inviteCode} for user ${userId}`);
}

/**
 * Get user ID from invite code
 */
export async function getUserFromInvite(inviteCode) {
    const data = await loadReferralData();
    if (!data || !data.invites) return null;
    return data.invites[inviteCode] || null;
}

/**
 * Add a pending referral (needs validation)
 */
export async function addPendingReferral(referrerId, referredId, joinedAt) {
    const data = await loadReferralData();

    // Ensure data structure exists
    if (!data.users) data.users = {};

    if (!data.users[referrerId]) {
        data.users[referrerId] = {
            inviteCode: null,
            referrals: [],
            pending: [],
            totalReferrals: 0
        };
    }

    // Add to pending list
    data.users[referrerId].pending.push({
        userId: referredId,
        joinedAt,
        validated: false
    });

    await saveReferralData(data);
    logger.info(`Added pending referral: ${referredId} referred by ${referrerId}`);
}

/**
 * Check and validate pending referrals
 * Returns array of validated referrals: [{ referrerId, referredId, referredTag }]
 */
export async function validatePendingReferrals(guild) {
    const data = await loadReferralData();
    const validated = [];
    const now = Date.now();
    const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

    // Safety check: ensure users object exists
    if (!data || !data.users) {
        return validated;
    }

    for (const [referrerId, userData] of Object.entries(data.users)) {
        const stillPending = [];

        for (const pending of userData.pending) {
            const daysSinceJoin = (now - pending.joinedAt) / (24 * 60 * 60 * 1000);

            // Check if still on server
            try {
                const member = await guild.members.fetch(pending.userId);

                // Check validation conditions
                const daysOk = daysSinceJoin >= 7;

                // Check if user has reached Robusta rank (level 2+)
                const userXPData = await getUserXP(guild.id, pending.userId);
                const userRank = getRankByXP(userXPData.xp);
                const rankOk = userRank.level >= 2; // Robusta is level 2

                if (daysOk && rankOk) {
                    // Validate!
                    userData.referrals.push({
                        userId: pending.userId,
                        validatedAt: now
                    });
                    userData.totalReferrals++;

                    validated.push({
                        referrerId,
                        referredId: pending.userId,
                        referredTag: member.user.tag
                    });

                    logger.info(`✅ Validated referral: ${pending.userId} referred by ${referrerId}`);
                } else {
                    // Still pending
                    stillPending.push(pending);
                }
            } catch (error) {
                // Member left the server, remove from pending
                logger.info(`❌ Referral failed: ${pending.userId} left the server`);
            }
        }

        userData.pending = stillPending;
    }

    if (validated.length > 0) {
        await saveReferralData(data);
    }

    return validated;
}

/**
 * Get user referral stats
 */
export async function getUserReferralStats(userId) {
    const data = await loadReferralData();

    // Safety check: ensure users object exists
    if (!data || !data.users) {
        return {
            inviteCode: null,
            totalReferrals: 0,
            validatedReferrals: [],
            pendingReferrals: []
        };
    }

    const userData = data.users[userId];

    if (!userData) {
        return {
            inviteCode: null,
            totalReferrals: 0,
            validatedReferrals: [],
            pendingReferrals: []
        };
    }

    return {
        inviteCode: userData.inviteCode,
        totalReferrals: userData.totalReferrals,
        validatedReferrals: userData.referrals,
        pendingReferrals: userData.pending
    };
}

/**
 * Get leaderboard of top referrers
 */
export async function getReferralLeaderboard(limit = 10) {
    const data = await loadReferralData();

    // Safety check: ensure users object exists
    if (!data || !data.users) {
        return [];
    }

    const leaderboard = Object.entries(data.users)
        .map(([userId, userData]) => ({
            userId,
            totalReferrals: userData.totalReferrals
        }))
        .filter(u => u.totalReferrals > 0)
        .sort((a, b) => b.totalReferrals - a.totalReferrals)
        .slice(0, limit);

    return leaderboard;
}

/**
 * Find who referred a specific user (check pending referrals)
 * Returns referrer user ID or null
 */
export async function findReferrer(referredId) {
    const data = await loadReferralData();

    // Safety check: ensure users object exists
    if (!data || !data.users) {
        return null;
    }

    // Search through all users' pending referrals
    for (const [referrerId, userData] of Object.entries(data.users)) {
        if (userData.pending && userData.pending.some(p => p.userId === referredId)) {
            return referrerId;
        }
    }

    return null;
}

/**
 * Get referral perks for a user
 * Returns object with perks based on referral count
 */
export async function getUserReferralPerks(userId) {
    const stats = await getUserReferralStats(userId);
    const count = stats.totalReferrals;

    const perks = {
        rateLimitMultiplier: 1,     // 1x = normal, 2x = double, 999 = no limit
        xpCooldownMs: 60000,         // Default 60s
        xpMultiplier: 1.0,           // 1.0 = normal, 1.25 = +25%, 1.5 = +50%
        bypassModeration: false,     // Skip light moderation
        priorityAccess: false,       // Priority bot access
        badge: null                  // Badge emoji
    };

    // 1+ filleuls: Rate limit x2 + Badge 🤝
    if (count >= 1) {
        perks.rateLimitMultiplier = 2;
        perks.badge = '🤝';
    }

    // 3+ filleuls: No rate limit + XP cooldown reduced to 30s
    if (count >= 3) {
        perks.rateLimitMultiplier = 999; // Effectively no limit
        perks.xpCooldownMs = 30000; // 30s instead of 60s
    }

    // 5+ filleuls: +25% XP + Bypass light moderation
    if (count >= 5) {
        perks.xpMultiplier = 1.25;
        perks.bypassModeration = true;
    }

    // 10+ filleuls: +50% XP + Priority access
    if (count >= 10) {
        perks.xpMultiplier = 1.5;
        perks.priorityAccess = true;
    }

    return perks;
}
