import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getLeaderboard } from '../../utils/xpSystem.js';
import logger from '../../utils/logger.js';

export default {
    data: new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('Affiche le classement des membres les plus actifs')
        .addIntegerOption(option =>
            option.setName('limite')
                .setDescription('Nombre de membres à afficher (par défaut: 10)')
                .setMinValue(5)
                .setMaxValue(25)
                .setRequired(false)),

    category: 'utility',
    cooldown: 10,

    async execute(interaction) {
        const limit = interaction.options.getInteger('limite') || 10;

        await interaction.deferReply();

        try {
            const leaderboard = await getLeaderboard(interaction.guild.id, limit);

            if (leaderboard.length === 0) {
                await interaction.editReply({
                    content: '☕ Aucun membre n\'a encore d\'XP. Commencez à discuter pour gagner de l\'expérience!'
                });
                return;
            }

            // Create embed
            const embed = new EmbedBuilder()
                .setTitle('🏆 Classement du Serveur')
                .setDescription('Les membres les plus actifs du café')
                .setColor(0x6d4c41) // Coffee brown
                .setFooter({ text: `Top ${leaderboard.length} membres` })
                .setTimestamp();

            // Build leaderboard text
            let leaderboardText = '';
            const medals = ['🥇', '🥈', '🥉'];

            for (let i = 0; i < leaderboard.length; i++) {
                const entry = leaderboard[i];
                const position = i + 1;
                const medal = medals[i] || `**${position}.**`;

                try {
                    const user = await interaction.client.users.fetch(entry.userId);
                    const username = user.username;

                    leaderboardText += `${medal} **${username}**\n`;
                    leaderboardText += `   ${entry.rank.emoji} ${entry.rank.name} • ${entry.xp.toLocaleString()} XP\n`;
                    leaderboardText += `   💬 ${entry.messageCount.toLocaleString()} messages\n\n`;

                } catch (error) {
                    logger.warn(`Could not fetch user ${entry.userId}:`, error.message);
                }
            }

            embed.setDescription(leaderboardText || 'Classement vide');

            // Add user's position if not in top
            const userEntry = leaderboard.find(e => e.userId === interaction.user.id);
            const allUsers = await getLeaderboard(interaction.guild.id, 1000);
            const userPosition = allUsers.findIndex(e => e.userId === interaction.user.id) + 1;

            if (!userEntry && userPosition > 0) {
                const userData = allUsers.find(e => e.userId === interaction.user.id);
                embed.addFields({
                    name: '📍 Ta Position',
                    value: `**Position #${userPosition}**\n` +
                        `${userData.rank.emoji} ${userData.rank.name} • ${userData.xp.toLocaleString()} XP\n` +
                        `💬 ${userData.messageCount.toLocaleString()} messages`,
                    inline: false
                });
            }

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            logger.error('Error in leaderboard command:', error);
            await interaction.editReply({
                content: '❌ Erreur lors de l\'affichage du classement.'
            });
        }
    }
};
