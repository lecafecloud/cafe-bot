import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { ranks, getRankByXP, getNextRank, getXPToNextRank, getRankProgress } from '../../config/ranks.js';
import { loadUserData } from '../../utils/xpSystem.js';
import logger from '../../utils/logger.js';

export default {
    data: new SlashCommandBuilder()
        .setName('rangs')
        .setDescription('Affiche tous les rangs disponibles et ta progression')
        .addUserOption(option =>
            option.setName('utilisateur')
                .setDescription('Voir les rangs d\'un autre utilisateur')
                .setRequired(false)),

    category: 'utility',
    cooldown: 5,

    async execute(interaction) {
        const targetUser = interaction.options.getUser('utilisateur') || interaction.user;
        const isOwnProfile = targetUser.id === interaction.user.id;

        await interaction.deferReply();

        try {
            // Load user XP data
            const userData = await loadUserData();
            const userKey = `${interaction.guild.id}-${targetUser.id}`;

            // Support both array and object formats
            let userXP = 0;
            if (userData[userKey]) {
                if (Array.isArray(userData[userKey])) {
                    userXP = userData[userKey][0] || 0;
                } else {
                    userXP = userData[userKey].xp || 0;
                }
            }

            const currentRank = getRankByXP(userXP);
            const nextRank = getNextRank(currentRank.level);
            const xpToNext = getXPToNextRank(userXP);
            const progress = getRankProgress(userXP);

            // Create embed
            const embed = new EmbedBuilder()
                .setTitle(`${currentRank.emoji} ${currentRank.name}`)
                .setColor(currentRank.color)
                .setFooter({ text: 'Gagnez de l\'XP en participant au serveur!' })
                .setTimestamp();

            // Add user info
            embed.setAuthor({
                name: isOwnProfile ? targetUser.username : `Profil de ${targetUser.username}`,
                iconURL: targetUser.displayAvatarURL()
            });

            // Current status - compact
            let statusText = `Level **${currentRank.level}**/${ranks.length} • **${userXP.toLocaleString()}** XP`;

            if (nextRank) {
                const progressBar = createProgressBar(progress, 15);
                statusText += `\n\n${progressBar} **${progress}%**\n`;
                statusText += `${xpToNext.toLocaleString()} XP → ${nextRank.name}`;
            } else {
                statusText += `\n\n🎉 **Rang maximum!**`;
            }

            embed.setDescription(statusText);

            // Split ranks into two columns (1-5 and 6-10)
            const midpoint = Math.ceil(ranks.length / 2);
            const leftRanks = ranks.slice(0, midpoint);
            const rightRanks = ranks.slice(midpoint);

            let leftText = '';
            let rightText = '';

            for (const rank of leftRanks) {
                const isCurrent = rank.level === currentRank.level;
                const isUnlocked = userXP >= rank.xpRequired;

                const emoji = isCurrent ? '📍' : (isUnlocked ? '✅' : '🔒');
                leftText += `${emoji} **${rank.name}**\n`;
                leftText += `\`${rank.xpRequired.toLocaleString()} XP\`\n`;
            }

            for (const rank of rightRanks) {
                const isCurrent = rank.level === currentRank.level;
                const isUnlocked = userXP >= rank.xpRequired;

                const emoji = isCurrent ? '📍' : (isUnlocked ? '✅' : '🔒');
                rightText += `${emoji} **${rank.name}**\n`;
                rightText += `\`${rank.xpRequired.toLocaleString()} XP\`\n`;
            }

            embed.addFields(
                { name: '☕ Rangs 1-5', value: leftText, inline: true },
                { name: '☕ Rangs 6-10', value: rightText, inline: true }
            );

            // Compact XP info
            const xpInfo = '💬 Messages **5-15 XP** (1 min cooldown)\nUtilise `/rangs` pour voir ta progression';

            embed.addFields({
                name: '💡 Gagner de l\'XP',
                value: xpInfo,
                inline: false
            });

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            logger.error('Error in rangs command:', error);
            await interaction.editReply({
                content: '❌ Erreur lors de l\'affichage des rangs.'
            });
        }
    }
};

/**
 * Create a text-based progress bar
 */
function createProgressBar(percentage, length = 20) {
    const filled = Math.round((percentage / 100) * length);
    const empty = length - filled;

    const filledBar = '█'.repeat(filled);
    const emptyBar = '░'.repeat(empty);

    return `${filledBar}${emptyBar}`;
}
