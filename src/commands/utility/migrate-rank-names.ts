import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import config from '../../config/config.js';
import logger from '../../utils/logger.js';
import { ranks } from '../../config/ranks.js';

// Old rank names mapping (before emoji change)
const oldRankNames = [
    '☕︱Grain',
    '☕︱Robusta',
    '☕︱Arabica',
    '☕︱Espresso',
    '☕︱Ristretto',
    '☕︱Lungo',
    '☕︱Cappuccino',
    '☕︱Macchiato',
    '☕︱Affogato',
    '👑︱Moka'
];

export default {
    data: new SlashCommandBuilder()
        .setName('migrate-rank-names')
        .setDescription('Migre les anciens noms de rangs vers les nouveaux (avec nouveaux emojis)')
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
            let alreadyCorrectCount = 0;
            const results = [];

            // Process each rank
            for (let i = 0; i < ranks.length; i++) {
                const newRankConfig = ranks[i];
                const oldRankName = oldRankNames[i];

                // Try to find the role by old name or new name
                let role = guild.roles.cache.find(r => r.name === oldRankName);
                const isOldName = !!role;

                if (!role) {
                    // Maybe it's already the new name?
                    role = guild.roles.cache.find(r => r.name === newRankConfig.name);
                    if (role) {
                        alreadyCorrectCount++;
                        results.push(`✅ **${newRankConfig.name}** - Déjà à jour`);
                        continue;
                    } else {
                        notFoundCount++;
                        results.push(`⚠️ **${oldRankName}** → **${newRankConfig.name}** - Rôle introuvable`);
                        logger.warn(`Role not found: ${oldRankName} or ${newRankConfig.name}`);
                        continue;
                    }
                }

                // Check if name needs to be updated
                if (role.name === newRankConfig.name) {
                    alreadyCorrectCount++;
                    results.push(`ℹ️ **${newRankConfig.name}** - Déjà correct`);
                    continue;
                }

                // Update role name
                try {
                    await role.setName(newRankConfig.name, 'Migration des noms de rangs vers nouveaux emojis via /migrate-rank-names');
                    updatedCount++;
                    results.push(`🔄 **${oldRankName}** → **${newRankConfig.name}** - Renommé`);
                    logger.info(`Renamed role: ${oldRankName} → ${newRankConfig.name}`);

                    // Small delay to avoid rate limits
                    await new Promise(resolve => setTimeout(resolve, 300));
                } catch (error) {
                    logger.error(`Failed to rename role ${oldRankName}:`, error);
                    results.push(`❌ **${oldRankName}** → **${newRankConfig.name}** - Erreur`);
                }
            }

            // Build response message
            let responseMessage = `${config.emojis.success} **Migration des noms de rangs terminée!**\n\n`;
            responseMessage += `🔄 **Rangs renommés:** ${updatedCount}/${ranks.length}\n`;
            responseMessage += `✅ **Déjà à jour:** ${alreadyCorrectCount}/${ranks.length}\n`;

            if (notFoundCount > 0) {
                responseMessage += `⚠️ **Rangs introuvables:** ${notFoundCount}\n`;
            }

            responseMessage += `\n**Détails:**\n`;

            // Add detailed results
            if (results.length <= 15) {
                responseMessage += results.join('\n');
            } else {
                responseMessage += `${results.slice(0, 10).join('\n')}\n... et ${results.length - 10} autres`;
            }

            await interaction.editReply({ content: responseMessage });

            logger.info(`Migrate-rank-names completed: ${updatedCount} roles renamed, ${alreadyCorrectCount} already correct`);

        } catch (error) {
            logger.error('Error in migrate-rank-names command:', error);

            await interaction.editReply({
                content: `${config.emojis.error} Erreur lors de la migration des noms de rangs: ${error.message}`
            });
        }
    }
};
