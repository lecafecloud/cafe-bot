import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { getScheduledDeletionsStats } from '../../utils/messageCleanup.js';
import logger from '../../utils/logger.js';

export default {
    data: new SlashCommandBuilder()
        .setName('cleanup-stats')
        .setDescription('Affiche les statistiques des messages programmés pour suppression')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .setDMPermission(false),

    category: 'utility',
    cooldown: 10,

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const stats = await getScheduledDeletionsStats();

            const embed = new EmbedBuilder()
                .setTitle('🗑️ Statistiques de Nettoyage Automatique')
                .setDescription('Messages programmés pour suppression automatique')
                .setColor(0x5865f2)
                .setTimestamp();

            embed.addFields(
                {
                    name: '📊 Total',
                    value: `${stats.total} message(s)`,
                    inline: true
                },
                {
                    name: '⏳ En attente',
                    value: `${stats.pending} message(s)`,
                    inline: true
                },
                {
                    name: '⚠️ En retard',
                    value: `${stats.overdue} message(s)`,
                    inline: true
                }
            );

            embed.addFields({
                name: 'ℹ️ Informations',
                value: '• Les messages de level up sont supprimés après **10 minutes**\n' +
                    '• Le job de nettoyage s\'exécute **toutes les minutes**\n' +
                    '• Les données sont stockées dans le **Discord Keystore**',
                inline: false
            });

            if (stats.overdue > 0) {
                embed.addFields({
                    name: '⚡ Action',
                    value: `${stats.overdue} message(s) seront supprimés lors du prochain cycle (< 60s)`,
                    inline: false
                });
            }

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            logger.error('Error in cleanup-stats command:', error);
            await interaction.editReply({
                content: '❌ Erreur lors de la récupération des statistiques.'
            });
        }
    }
};
