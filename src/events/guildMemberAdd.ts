import logger from '../utils/logger.js';
import { ranks } from '../config/ranks.js';
import { getUserFromInvite, addPendingReferral } from '../utils/referralSystem.js';

// Cache of invites with their uses count
const inviteCache = new Map();

/**
 * Update invite cache for a guild
 */
async function updateInviteCache(guild) {
    try {
        const invites = await guild.invites.fetch();
        inviteCache.set(guild.id, new Map(invites.map(inv => [inv.code, inv.uses])));
    } catch (error) {
        logger.error('Error updating invite cache:', error);
    }
}

/**
 * Initialize invite cache when bot starts
 */
export async function initializeInviteCache(client) {
    try {
        for (const guild of client.guilds.cache.values()) {
            await updateInviteCache(guild);
            logger.info(`Initialized invite cache for ${guild.name}`);
        }
    } catch (error) {
        logger.error('Error initializing invite cache:', error);
    }
}

export default {
    name: 'guildMemberAdd',
    once: false,

    async execute(member, client) {
        try {
            const guild = member.guild;

            // ===== REFERRAL TRACKING =====
            try {
                // Fetch current invites
                const currentInvites = await guild.invites.fetch();
                const cachedInvites = inviteCache.get(guild.id) || new Map();

                // Find which invite was used by comparing uses
                let usedInvite = null;

                for (const [code, invite] of currentInvites) {
                    const cachedUses = cachedInvites.get(code) || 0;
                    const currentUses = invite.uses;

                    if (currentUses > cachedUses) {
                        usedInvite = invite;
                        break;
                    }
                }

                // Update cache
                await updateInviteCache(guild);

                if (usedInvite) {
                    logger.info(`${member.user.tag} joined using invite ${usedInvite.code}`);

                    // Check if this invite is a referral invite
                    const referrerId = await getUserFromInvite(usedInvite.code);

                    if (referrerId) {
                        // Add as pending referral
                        await addPendingReferral(referrerId, member.id, Date.now());

                        logger.info(`🤝 ${member.user.tag} was referred by user ${referrerId}`);

                        // Try to notify the referrer
                        try {
                            const referrer = await guild.members.fetch(referrerId);
                            await referrer.send(
                                `🎉 Quelqu'un a rejoint le serveur avec ton lien de parrainage !\n\n` +
                                `**Nouveau membre :** ${member.user.tag}\n` +
                                `Il sera validé comme filleul après 7 jours s'il remplit les conditions. ⏳\n\n` +
                                `💡 **Astuce :** Si ${member.user.tag} a des questions, encourage-le à te contacter directement. Tu peux l'aider à s'intégrer dans la communauté !`
                            );
                        } catch (error) {
                            logger.warn(`Could not DM referrer ${referrerId}:`, error.message);
                        }
                    }
                } else {
                    logger.info(`${member.user.tag} joined but could not determine which invite was used`);
                }
            } catch (error) {
                logger.error('Error tracking referral:', error);
            }

            // ===== DEFAULT RANK ASSIGNMENT =====
            const firstRank = ranks[0];

            if (!firstRank) {
                logger.warn('No ranks configured, cannot assign default rank');
                return;
            }

            // Find the role in the guild
            const rankRole = guild.roles.cache.find(r => r.name === firstRank.name);

            if (!rankRole) {
                logger.warn(`Default rank role "${firstRank.name}" not found in guild ${guild.name}`);
                return;
            }

            // Assign the role to the new member
            await member.roles.add(rankRole);

            logger.info(`Assigned default rank ${firstRank.name} to new member ${member.user.tag}`);

        } catch (error) {
            logger.error('Error in guildMemberAdd:', error);
        }
    }
};
