/**
 * Rank system configuration
 * Theme: Coffee Types ☕
 *
 * Beautiful gradient: Blue → Purple → Gold
 * Optimized for both Discord dark & light themes
 */

export const ranks = [
    {
        level: 1,
        name: '🌱︱Grain',
        description: 'Le début de tout',
        xpRequired: 0,
        color: 0x1565c0,        // Blue 800 - deep blue
        emoji: '🌱'
    },
    {
        level: 2,
        name: '🫘︱Robusta',
        description: 'Café corsé et fort',
        xpRequired: 100,
        color: 0x2196f3,        // Blue 500 - vibrant blue
        emoji: '🫘'
    },
    {
        level: 3,
        name: '☕︱Arabica',
        description: 'Plus raffiné',
        xpRequired: 300,
        color: 0x00bcd4,        // Cyan 500 - bright cyan
        emoji: '☕'
    },
    {
        level: 4,
        name: '🔥︱Espresso',
        description: 'Intense et concentré',
        xpRequired: 600,
        color: 0x00e676,        // Green A400 - vivid green
        emoji: '🔥'
    },
    {
        level: 5,
        name: '⚡︱Ristretto',
        description: 'Ultra concentré',
        xpRequired: 1000,
        color: 0x6a1b9a,        // Purple 800 - deep purple
        emoji: '⚡'
    },
    {
        level: 6,
        name: '💧︱Lungo',
        description: 'Version allongée',
        xpRequired: 1500,
        color: 0x9c27b0,        // Purple 500 - vibrant purple
        emoji: '💧'
    },
    {
        level: 7,
        name: '☁️︱Cappuccino',
        description: 'Mousse crémeuse',
        xpRequired: 2200,
        color: 0xe91e63,        // Pink 500 - vibrant pink
        emoji: '☁️'
    },
    {
        level: 8,
        name: '🎨︱Macchiato',
        description: 'Taché de lait',
        xpRequired: 3000,
        color: 0xff5722,        // Deep Orange 500 - bright orange
        emoji: '🎨'
    },
    {
        level: 9,
        name: '🍨︱Affogato',
        description: 'Café glacé',
        xpRequired: 4000,
        color: 0xff9800,        // Orange 500 - vivid orange
        emoji: '🍨'
    },
    {
        level: 10,
        name: '👑︱Moka',
        description: 'Le summum',
        xpRequired: 5500,
        color: 0xffd700,        // Gold
        emoji: '👑'
    }
];

/**
 * Get rank by level
 */
export function getRankByLevel(level) {
    return ranks.find(r => r.level === level) || ranks[0];
}

/**
 * Get rank by XP
 */
export function getRankByXP(xp) {
    // Find the highest rank the user qualifies for
    let currentRank = ranks[0];

    for (const rank of ranks) {
        if (xp >= rank.xpRequired) {
            currentRank = rank;
        } else {
            break;
        }
    }

    return currentRank;
}

/**
 * Get next rank info
 */
export function getNextRank(currentLevel) {
    const nextLevel = currentLevel + 1;
    return ranks.find(r => r.level === nextLevel) || null;
}

/**
 * Calculate XP needed for next rank
 */
export function getXPToNextRank(currentXP) {
    const currentRank = getRankByXP(currentXP);
    const nextRank = getNextRank(currentRank.level);

    if (!nextRank) {
        return 0; // Max rank reached
    }

    return nextRank.xpRequired - currentXP;
}

/**
 * Get progress percentage to next rank
 */
export function getRankProgress(currentXP) {
    const currentRank = getRankByXP(currentXP);
    const nextRank = getNextRank(currentRank.level);

    if (!nextRank) {
        return 100; // Max rank
    }

    const xpInCurrentRank = currentXP - currentRank.xpRequired;
    const xpNeededForNext = nextRank.xpRequired - currentRank.xpRequired;

    return Math.floor((xpInCurrentRank / xpNeededForNext) * 100);
}
