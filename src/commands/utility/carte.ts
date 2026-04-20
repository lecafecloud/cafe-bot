import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getUserXP } from '../../utils/xpSystem.js';
import { getRankByXP, getNextRank, getXPToNextRank, getRankProgress } from '../../config/ranks.js';
import { getUserReferralPerks } from '../../utils/referralSystem.js';
import logger from '../../utils/logger.js';

export default {
    data: new SlashCommandBuilder()
        .setName('carte')
        .setDescription('Affiche ta carte de membre avec ton rang et ta progression')
        .addUserOption(option =>
            option.setName('utilisateur')
                .setDescription('Voir la carte d\'un autre utilisateur')
                .setRequired(false)),

    category: 'utility',
    cooldown: 5,

    async execute(interaction) {
        const targetUser = interaction.options.getUser('utilisateur') || interaction.user;
        const isOwnCard = targetUser.id === interaction.user.id;

        await interaction.deferReply();

        try {
            // Get member data
            const member = await interaction.guild.members.fetch(targetUser.id);

            // Get XP data
            const userData = await getUserXP(interaction.guild.id, targetUser.id);
            const currentRank = getRankByXP(userData.xp);
            const nextRank = getNextRank(currentRank.level);
            const xpToNext = getXPToNextRank(userData.xp);
            const progress = getRankProgress(userData.xp);

            // Get referral perks for badge
            const referralPerks = await getUserReferralPerks(targetUser.id);

            // Create beautiful embed
            const embed = new EmbedBuilder()
                .setColor(currentRank.color)
                .setTimestamp();

            // Set author based on who's viewing
            const badge = referralPerks.badge ? ` ${referralPerks.badge}` : '';
            if (isOwnCard) {
                embed.setAuthor({
                    name: `${targetUser.username}${badge} | Carte de Membre`,
                    iconURL: targetUser.displayAvatarURL()
                });
            } else {
                embed.setAuthor({
                    name: `Carte de ${targetUser.username}${badge}`,
                    iconURL: targetUser.displayAvatarURL()
                });
            }

            // Thumbnail with user avatar
            embed.setThumbnail(targetUser.displayAvatarURL({ size: 256 }));

            // Main rank display - just the name (already has emoji)
            let description = `## ${currentRank.name}\n`;
            description += `*${currentRank.description}*`;

            embed.setDescription(description);

            // Stats section - compact single line
            const rankPos = await getUserRankPosition(interaction.guild.id, targetUser.id);
            const statsText = `Level **${currentRank.level}**/10 • ` +
                `XP **${userData.xp.toLocaleString()}** • ` +
                `Messages **${(userData.messageCount || 0).toLocaleString()}** • ` +
                `Classement **#${rankPos}**`;

            embed.addFields({
                name: '📊 Stats',
                value: statsText,
                inline: false
            });

            // Progress bar - separate section
            if (nextRank) {
                const progressBar = createProgressBar(progress, 15);
                const progressText = `${progressBar} **${progress}%**\n**${xpToNext.toLocaleString()} XP** restants pour **${nextRank.name}**`;

                embed.addFields({
                    name: '🎯 Progression',
                    value: progressText,
                    inline: false
                });
            } else {
                embed.addFields({
                    name: '👑 Rang Maximum',
                    value: `Rang le plus élevé atteint! 🎉`,
                    inline: false
                });
            }

            // Footer with tips - shortened
            if (isOwnCard) {
                embed.setFooter({
                    text: '💡 Gagne de l\'XP en discutant • /rangs pour tous les rangs'
                });
            } else {
                embed.setFooter({
                    text: 'Utilise /carte pour ta progression'
                });
            }

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            logger.error('Error in carte command:', error);
            await interaction.editReply({
                content: '❌ Erreur lors de l\'affichage de la carte.'
            });
        }
    }
};

/**
 * Get user's rank position in the server
 */
async function getUserRankPosition(guildId, userId) {
    try {
        const { getLeaderboard } = await import('../../utils/xpSystem.js');
        const leaderboard = await getLeaderboard(guildId, 1000);
        const position = leaderboard.findIndex(entry => entry.userId === userId);

        return position >= 0 ? position + 1 : '?';
    } catch (error) {
        logger.error('Error getting user rank position:', error);
        return '?';
    }
}

/**
 * Create a beautiful progress bar
 */
function createProgressBar(percentage, length = 20) {
    const filled = Math.round((percentage / 100) * length);
    const empty = length - filled;

    const filledBar = '█'.repeat(Math.max(0, filled));
    const emptyBar = '░'.repeat(Math.max(0, empty));

    return `${filledBar}${emptyBar}`;
}
