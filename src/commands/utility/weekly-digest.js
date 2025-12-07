import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import config from '../../config/config.js';
import { postWeeklyDigest } from '../../utils/scheduler.js';
import logger from '../../utils/logger.js';

const SERVER_ID = '1387172171872211045';

export default {
    data: new SlashCommandBuilder()
        .setName('weekly-digest')
        .setDescription('Génère et poste le weekly digest manuellement')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .setDMPermission(false),

    category: 'utility',
    cooldown: 60,

    async execute(interaction) {
        // Check if user is owner
        const ownerIds = process.env.OWNER_IDS?.split(',') || [];
        if (!ownerIds.includes(interaction.user.id)) {
            return interaction.reply({
                content: `${config.emojis.error} Cette commande est réservée aux administrateurs du bot.`,
                ephemeral: true
            });
        }

        // Check if we're in the right server
        if (interaction.guild.id !== SERVER_ID) {
            return interaction.reply({
                content: `${config.emojis.error} Cette commande ne fonctionne que dans le serveur configuré.`,
                ephemeral: true
            });
        }

        await interaction.deferReply({ ephemeral: true });

        logger.info(`[DIGEST] Manual trigger by ${interaction.user.tag}`);

        try {
            const result = await postWeeklyDigest(interaction.client);

            if (result.success) {
                await interaction.editReply({
                    content: `${config.emojis.success} Weekly digest posté avec succès!`
                });
            } else {
                await interaction.editReply({
                    content: `${config.emojis.error} Échec du digest: ${result.error}`
                });
            }
        } catch (error) {
            logger.error('[DIGEST] Error in manual trigger:', error);
            await interaction.editReply({
                content: `${config.emojis.error} Une erreur est survenue: ${error.message}`
            });
        }
    }
};
