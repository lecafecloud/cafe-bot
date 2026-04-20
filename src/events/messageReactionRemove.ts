import { Events } from 'discord.js';
import logger from '../utils/logger.js';
import { getRoleForReaction } from '../utils/roleReactions.js';

export default {
    name: Events.MessageReactionRemove,
    async execute(reaction, user) {
        try {
            // Ignore bot reactions
            if (user.bot) return;

            // Handle partial reactions
            if (reaction.partial) {
                try {
                    await reaction.fetch();
                } catch (error) {
                    logger.error('[REACTION_ROLE] Failed to fetch partial reaction:', error);
                    return;
                }
            }

            // Get emoji string
            const emoji = reaction.emoji.name;
            const messageId = reaction.message.id;

            logger.info(`[REACTION_ROLE] User ${user.tag} removed reaction ${emoji} from message ${messageId}`);

            // Check if this reaction is mapped to a role
            const roleId = await getRoleForReaction(messageId, emoji);

            if (!roleId) {
                logger.debug(`[REACTION_ROLE] No role mapping found for emoji ${emoji} on message ${messageId}`);
                return;
            }

            // Get the guild member
            const guild = reaction.message.guild;
            const member = await guild.members.fetch(user.id);

            if (!member) {
                logger.warn(`[REACTION_ROLE] Could not fetch member ${user.id}`);
                return;
            }

            // Check if member has the role
            if (!member.roles.cache.has(roleId)) {
                logger.info(`[REACTION_ROLE] User ${user.tag} doesn't have role ${roleId}`);
                return;
            }

            // Get the role
            const role = await guild.roles.fetch(roleId);

            if (!role) {
                logger.warn(`[REACTION_ROLE] Role ${roleId} not found in guild`);
                return;
            }

            // Remove the role from the member
            await member.roles.remove(role);
            logger.info(`[REACTION_ROLE] Successfully removed role ${role.name} from ${user.tag}`);

        } catch (error) {
            logger.error('[REACTION_ROLE] Error handling reaction removal:', error);
        }
    }
};
