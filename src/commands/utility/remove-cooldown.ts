import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import config from '../../config/config.js';
import logger from '../../utils/logger.js';

export default {
    data: new SlashCommandBuilder()
        .setName('remove-cooldown')
        .setDescription('Retirer le cooldown bot d\'un utilisateur')
        .addUserOption(option =>
            option.setName('utilisateur')
                .setDescription('L\'utilisateur dont retirer le cooldown')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .setDMPermission(false),

    category: 'utility',
    cooldown: 5,

    async execute(interaction) {
        const targetUser = interaction.options.getUser('utilisateur');

        await interaction.deferReply({ ephemeral: true });

        try {
            // Import the function we need
            const { removeBotCooldown } = await import('../../utils/aiAssistant.js');

            // Remove the cooldown
            const result = await removeBotCooldown(targetUser.id);

            if (!result.removed) {
                await interaction.editReply({
                    content: `${config.emojis.info} **${targetUser.username}** n'a pas de cooldown bot actif.`
                });
                return;
            }

            await interaction.editReply({
                content: `${config.emojis.success} **Cooldown retiré!**\n\n` +
                    `**Utilisateur:** ${targetUser}\n` +
                    `**Temps restant annulé:** ${result.remainingMinutes} minute(s)\n\n` +
                    `${targetUser.username} peut maintenant utiliser le bot immédiatement.`
            });

            logger.info(`${interaction.user.tag} removed bot cooldown for ${targetUser.tag} (${result.remainingMinutes}min remaining)`);

        } catch (error) {
            logger.error('Error in remove-cooldown command:', error);

            await interaction.editReply({
                content: `${config.emojis.error} Erreur lors de la suppression du cooldown: ${error.message}`
            });
        }
    }
};
