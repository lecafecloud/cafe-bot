export default {
    prefix: process.env.PREFIX || '!',
    owners: process.env.OWNER_IDS?.split(',') || [],
    defaultCooldown: 3,

    // Community roles
    memberRoleId: process.env.MEMBER_ROLE_ID || null,
    introductionChannelId: process.env.INTRODUCTION_CHANNEL_ID || null,

    // Moderation
    moderationLogChannelId: '1388521766787219557',

    colors: {
        primary: 0x5865F2,
        success: 0x57F287,
        warning: 0xFEE75C,
        error: 0xED4245,
        info: 0x5865F2
    },
    emojis: {
        success: '✅',
        error: '❌',
        warning: '⚠️',
        info: 'ℹ️',
        loading: '⏳'
    }
};