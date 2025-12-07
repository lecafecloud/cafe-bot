import { EmbedBuilder } from 'discord.js';
import logger from '../utils/logger.js';
import config from '../config/config.js';
import {
    addUserXP,
    canGainXP,
    getRandomMessageXP,
    getUserXP,
    updateUserRankRole
} from '../utils/xpSystem.js';
import { getNextRank } from '../config/ranks.js';
import { scheduleMessageDeletion } from '../utils/messageCleanup.js';
import { checkRateLimit, setRateLimit, removeRateLimit, fetchMessageHistory, queryAI, claimMessage, moderateMessage, checkBotCooldown } from '../utils/aiAssistant.js';
import { sanitizeMentions } from '../utils/sanitize.js';
import { getUserReferralPerks } from '../utils/referralSystem.js';

export default {
    name: 'messageCreate',
    once: false,

    async execute(message, client) {
        // Ignore bot messages
        if (message.author.bot) return;

        // Ignore DMs
        if (!message.guild) return;

        // Ignore system messages
        if (message.system) return;

        try {
            // Check if bot is mentioned
            const botMention = `<@${client.user.id}>`;
            const isBotMentioned = message.mentions.has(client.user.id) || message.content.includes(botMention);

            if (isBotMentioned) {
                await handleBotMention(message, client);
                return; // Don't process XP for bot mentions
            }

            // Check XP cooldown - apply referral perks
            const userData = await getUserXP(message.guild.id, message.author.id);
            const referralPerks = await getUserReferralPerks(message.author.id);

            if (!canGainXP(userData.lastMessageTime, referralPerks.xpCooldownMs)) {
                return; // User on cooldown
            }

            // Calculate XP gain with referral multiplier
            const baseXP = getRandomMessageXP();
            const xpGain = Math.floor(baseXP * referralPerks.xpMultiplier);

            // Add XP and check for level up
            const result = await addUserXP(message.guild.id, message.author.id, xpGain);

            if (result.leveledUp) {
                logger.info(`${message.author.tag} ranked up to ${result.newRank.name}!`);

                // Update user's rank role
                const member = await message.guild.members.fetch(message.author.id);
                await updateUserRankRole(member, result.newRank);

                // Add reaction to the message with the rank emoji
                try {
                    await message.react(result.newRank.emoji);
                } catch (error) {
                    logger.warn('Failed to add rank emoji reaction:', error.message);
                }

                // Check if user is a member
                const isMember = config.memberRoleId
                    ? member.roles.cache.has(config.memberRoleId)
                    : true; // If no member role configured, assume everyone is a member

                // Build the level up message
                const levelUpEmbed = await buildLevelUpEmbed(
                    message.author,
                    result,
                    isMember
                );

                // Send level up message in channel (will auto-delete in 10 minutes)
                try {
                    const levelUpMessage = await message.channel.send({
                        content: `${message.author}`,
                        embeds: [levelUpEmbed]
                    });

                    // Store message for auto-deletion in keystore
                    await scheduleMessageDeletion(
                        message.guild.id,
                        message.channel.id,
                        levelUpMessage.id,
                        15 * 1000 // 15 seconds in milliseconds
                    );

                    logger.info(`Sent level up message for ${message.author.tag}, scheduled deletion in 15 seconds`);

                } catch (error) {
                    logger.error('Failed to send level up message:', error);
                }
            }

        } catch (error) {
            logger.error('Error in messageCreate XP handler:', error);
        }
    }
};

/**
 * Build the level up embed message
 */
async function buildLevelUpEmbed(user, result, isMember) {
    const embed = new EmbedBuilder()
        .setTitle(`🎉 Nouveau Rang Débloqué!`)
        .setColor(result.newRank.color)
        .setThumbnail(user.displayAvatarURL())
        .setTimestamp();

    // Congratulations message
    let description = `**Félicitations ${user.username}!**\n\n`;
    description += `Tu as atteint le rang **${result.newRank.name}**!\n`;
    description += `*${result.newRank.description}*`;

    // Add member invitation if not a member
    if (!isMember && config.introductionChannelId) {
        description += `\n\n━━━━━━━━━━━━━━━━━━━━\n\n`;
        description += `👋 **Rejoins la communauté!**\n`;
        description += `Pour débloquer les réactions et faire partie de la commu, `;
        description += `présente-toi dans <#${config.introductionChannelId}>!\n\n`;
        description += `Une fois ta présentation faite, tu auras accès à toutes les fonctionnalités du serveur! ✨`;
    }

    embed.setDescription(description);

    // Stats - compact
    const statsText = `${result.oldRank.name} → ${result.newRank.name}\n` +
        `Level **${result.newRank.level}**/10 • **${result.totalXP.toLocaleString()} XP**`;

    embed.addFields({
        name: '📊 Progression',
        value: statsText,
        inline: false
    });

    // Next rank info
    const nextRank = getNextRank(result.newRank.level);
    if (nextRank) {
        const xpNeeded = nextRank.xpRequired - result.totalXP;
        embed.addFields({
            name: '🎯 Prochain rang',
            value: `**${nextRank.name}**\n${xpNeeded.toLocaleString()} XP restants`,
            inline: false
        });
    } else {
        embed.addFields({
            name: '👑 Rang Maximum',
            value: `Rang le plus élevé atteint! 🎉`,
            inline: false
        });
    }

    return embed;
}

/**
 * Handle when the bot is mentioned/tagged
 */
async function handleBotMention(message, client) {
    try {
        // Try to claim this message for processing (prevents duplicate responses from multiple instances)
        const claimed = await claimMessage(message.id);
        if (!claimed) {
            logger.info(`[MENTION] Message ${message.id} already being processed by another instance, skipping`);
            return;
        }

        const userId = message.author.id;

        // Extract question from message (remove bot mention)
        const botMention = `<@${client.user.id}>`;
        const botMentionWithNickname = `<@!${client.user.id}>`;

        let question = message.content
            .replace(botMention, '')
            .replace(botMentionWithNickname, '')
            .trim();

        // If no question provided, ignore
        if (!question || question.length === 0) {
            await message.react('❓');
            return;
        }

        // Check if user is on bot cooldown (from moderation)
        const cooldownCheck = await checkBotCooldown(userId);
        if (cooldownCheck.onCooldown) {
            logger.info(`[MODERATION] User ${message.author.tag} is on bot cooldown (${cooldownCheck.remainingMinutes}min remaining)`);
            // Silently ignore - no response
            return;
        }

        // Fetch message history for moderation
        const { history: messageHistory, userIds } = await fetchMessageHistory(message.channel, 20);

        // Check referral perks for bypass
        const referralPerks = await getUserReferralPerks(userId);

        // Moderate message - check if appropriate and if user is abusing
        // Skip moderation if user has bypass perk (5+ filleuls)
        const moderationResult = referralPerks.bypassModeration
            ? { action: 'OK' }
            : await moderateMessage(question, messageHistory, message.author.username, userId);

        if (moderationResult.action === 'COOLDOWN') {
            logger.info(`[MODERATION] Bot cooldown ${moderationResult.duration}min applied to ${message.author.tag}`);

            // Log to moderation channel
            await logModerationAction(message, 'COOLDOWN', moderationResult.duration, question, moderationResult.reason);

            return;
        }

        if (moderationResult.action === 'MUTE') {
            logger.info(`[MODERATION] Discord timeout ${moderationResult.duration}min applied to ${message.author.tag}`);
            try {
                const member = await message.guild.members.fetch(userId);
                const muteReason = moderationResult.reason || 'Comportement inapproprié';
                await member.timeout(moderationResult.duration * 60 * 1000, `Modération automatique: ${muteReason}`);
                logger.info(`[MODERATION] Successfully timed out ${message.author.tag} for ${moderationResult.duration} minutes`);

                // Log to moderation channel
                await logModerationAction(message, 'MUTE', moderationResult.duration, question, moderationResult.reason);
            } catch (error) {
                logger.error(`[MODERATION] Failed to timeout ${message.author.tag}:`, error);
            }
            return;
        }

        // If action is 'OK', continue with normal flow

        // Check rate limit with referral multiplier
        const rateLimitCheck = await checkRateLimit(userId, referralPerks.rateLimitMultiplier);
        if (!rateLimitCheck.allowed) {
            // Check if we already warned this user (to avoid spam)
            const { checkWarned, setWarned } = await import('../utils/aiAssistant.js');
            const alreadyWarned = await checkWarned(userId);

            if (!alreadyWarned) {
                await message.reply({
                    content: `${config.emojis.warning} Doucement ! Tu as utilisé tes 5 questions. Réessaie dans **${rateLimitCheck.remainingTime}** ⏳`
                });
                await setWarned(userId);
            }
            // If already warned, just silently ignore
            return;
        }

        // Set cooldown
        await setRateLimit(userId);

        // Show typing indicator
        await message.channel.sendTyping();

        logger.info(`[MENTION] ${message.author.tag} asked: ${question}`);

        // Query AI with context for memory system
        const answer = await queryAI(question, messageHistory, {
            channelId: message.channel.id,
            channelName: message.channel.name,
            userId: message.author.id,
            username: message.author.username,
            userIds: userIds
        });

        // Sanitize the answer to prevent @everyone/@here mentions
        const sanitizedAnswer = sanitizeMentions(answer);

        // Reply as a normal message (no embed, no formatting)
        await message.reply(sanitizedAnswer.substring(0, 2000));

        logger.info(`[MENTION] Responded to ${message.author.tag}`);

    } catch (error) {
        logger.error('[MENTION] Error handling bot mention:', error);

        try {
            await message.reply({
                content: `${config.emojis.error} Désolé, je n'ai pas pu traiter ta question. Réessaie plus tard !`
            });

            // Remove cooldown on error
            await removeRateLimit(message.author.id);
        } catch (replyError) {
            logger.error('[MENTION] Failed to send error message:', replyError);
        }
    }
}

/**
 * Log moderation action to the moderation log channel
 */
async function logModerationAction(message, action, duration, userMessage, reason) {
    try {
        const logChannel = await message.guild.channels.fetch(config.moderationLogChannelId);

        if (!logChannel || !logChannel.isTextBased()) {
            logger.warn('[MODERATION] Log channel not found or not a text channel');
            return;
        }

        const embed = new EmbedBuilder()
            .setAuthor({
                name: message.author.tag,
                iconURL: message.author.displayAvatarURL()
            })
            .setTimestamp()
            .setFooter({ text: `User ID: ${message.author.id}` });

        if (action === 'COOLDOWN') {
            embed
                .setTitle('🔇 Bot Cooldown Appliqué')
                .setColor(config.colors.warning)
                .setDescription(`Un cooldown bot de **${duration} minutes** a été appliqué automatiquement.`)
                .addFields(
                    { name: 'Utilisateur', value: `${message.author}`, inline: true },
                    { name: 'Durée', value: `${duration} min`, inline: true },
                    { name: 'Canal', value: `${message.channel}`, inline: true },
                    { name: 'Message', value: userMessage.substring(0, 1024), inline: false },
                    { name: 'Raison', value: reason || 'Aucune raison spécifiée', inline: false }
                );
        } else if (action === 'MUTE') {
            embed
                .setTitle('⛔ Timeout Discord Appliqué')
                .setColor(config.colors.error)
                .setDescription(`Un timeout Discord de **${duration} minutes** a été appliqué automatiquement.`)
                .addFields(
                    { name: 'Utilisateur', value: `${message.author}`, inline: true },
                    { name: 'Durée', value: `${duration} min`, inline: true },
                    { name: 'Canal', value: `${message.channel}`, inline: true },
                    { name: 'Message', value: userMessage.substring(0, 1024), inline: false },
                    { name: 'Raison', value: reason || 'Comportement inapproprié', inline: false }
                );
        }

        await logChannel.send({ embeds: [embed] });
        logger.info(`[MODERATION] Logged ${action} action to moderation channel`);

    } catch (error) {
        logger.error('[MODERATION] Failed to log moderation action:', error);
    }
}
