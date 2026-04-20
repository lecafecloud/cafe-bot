import { Events } from 'discord.js';
import logger from '../utils/logger.js';
import { getRoleForReaction } from '../utils/roleReactions.js';

export default {
    name: Events.MessageReactionAdd,
    async execute(reaction, user) {
        try {
            // Ignore bot reactions
            if (user.bot) return;

            // Handle partial reactions (fetch the full reaction if needed)
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

            logger.info(`[REACTION_ROLE] User ${user.tag} reacted with ${emoji} on message ${messageId}`);

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

            // Check if member already has the role
            if (member.roles.cache.has(roleId)) {
                logger.info(`[REACTION_ROLE] User ${user.tag} already has role ${roleId}`);
                return;
            }

            // Get the role
            const role = await guild.roles.fetch(roleId);

            if (!role) {
                logger.warn(`[REACTION_ROLE] Role ${roleId} not found in guild`);
                return;
            }

            // Add the role to the member
            await member.roles.add(role);
            logger.info(`[REACTION_ROLE] Successfully added role ${role.name} to ${user.tag}`);

        } catch (error) {
            logger.error('[REACTION_ROLE] Error handling reaction:', error);
        }
    }
};
