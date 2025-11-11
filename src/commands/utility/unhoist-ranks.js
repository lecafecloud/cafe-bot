import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import config from '../../config/config.js';
import logger from '../../utils/logger.js';
import { ranks } from '../../config/ranks.js';

export default {
    data: new SlashCommandBuilder()
        .setName('unhoist-ranks')
        .setDescription('Désactive la séparation des rangs dans la liste des membres')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .setDMPermission(false),

    category: 'utility',
    cooldown: 10,

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const guild = interaction.guild;
            let updatedCount = 0;
            let notFoundCount = 0;
            const results = [];

            // Process each rank
            for (const rankConfig of ranks) {
                const role = guild.roles.cache.find(r => r.name === rankConfig.name);

                if (!role) {
                    notFoundCount++;
                    results.push(`⚠️ **${rankConfig.name}** - Rôle introuvable`);
                    logger.warn(`Role not found: ${rankConfig.name}`);
                    continue;
                }

                // Check if already not hoisted
                if (!role.hoist) {
                    results.push(`ℹ️ **${rankConfig.name}** - Déjà non-séparé`);
                    continue;
                }

                // Update role to disable hoist
                try {
                    await role.setHoist(false, 'Désactivation de la séparation des rangs via /unhoist-ranks');
                    updatedCount++;
                    results.push(`✅ **${rankConfig.name}** - Séparation désactivée`);
                    logger.info(`Disabled hoist for role: ${rankConfig.name}`);

                    // Small delay to avoid rate limits
                    await new Promise(resolve => setTimeout(resolve, 300));
                } catch (error) {
                    logger.error(`Failed to unhoist role ${rankConfig.name}:`, error);
                    results.push(`❌ **${rankConfig.name}** - Erreur`);
                }
            }

            // Build response message
            let responseMessage = `${config.emojis.success} **Séparation des rangs désactivée!**\n\n`;
            responseMessage += `✅ **Rangs modifiés:** ${updatedCount}/${ranks.length}\n`;

            if (notFoundCount > 0) {
                responseMessage += `⚠️ **Rangs introuvables:** ${notFoundCount}\n`;
            }

            responseMessage += `\n**Résultat:**\n`;
            responseMessage += `Les membres ne sont plus séparés par rang dans la liste des membres.\n`;
            responseMessage += `Tous les membres avec des rangs apparaissent maintenant dans la section principale.\n\n`;

            // Add detailed results (limit to avoid message too long)
            if (results.length <= 15) {
                responseMessage += `**Détails:**\n${results.join('\n')}`;
            } else {
                responseMessage += `**Premiers résultats:**\n${results.slice(0, 10).join('\n')}\n... et ${results.length - 10} autres`;
            }

            responseMessage += `\n\n💡 **Pour réactiver:** Utilisez \`/hoist-ranks\``;

            await interaction.editReply({ content: responseMessage });

            logger.info(`Unhoist-ranks completed: ${updatedCount} roles updated`);

        } catch (error) {
            logger.error('Error in unhoist-ranks command:', error);

            await interaction.editReply({
                content: `${config.emojis.error} Erreur lors de la désactivation de la séparation des rangs: ${error.message}`
            });
        }
    }
};
