import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import config from '../../config/config.js';
import logger from '../../utils/logger.js';
import { ranks } from '../../config/ranks.js';

export default {
    data: new SlashCommandBuilder()
        .setName('fix-rank-positions')
        .setDescription('Réorganise les rôles de rang en haut pour afficher les couleurs sur les pseudos')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .setDMPermission(false),

    category: 'utility',
    cooldown: 30,

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const guild = interaction.guild;
            const botMember = guild.members.me;

            // Find all rank roles
            const rankRoles = [];
            for (const rankConfig of ranks) {
                const role = guild.roles.cache.find(r => r.name === rankConfig.name);
                if (role) {
                    rankRoles.push({ role, level: rankConfig.level });
                }
            }

            if (rankRoles.length === 0) {
                await interaction.editReply({
                    content: `${config.emojis.warning} Aucun rôle de rang trouvé. Utilisez \`/setup-ranks\` pour les créer.`
                });
                return;
            }

            logger.info(`Found ${rankRoles.length} rank roles to reposition`);

            // Sort rank roles by level (descending - highest first)
            rankRoles.sort((a, b) => b.level - a.level);

            // Find all roles sorted by position (highest first)
            const allRoles = Array.from(guild.roles.cache.values())
                .sort((a, b) => b.position - a.position);

            // Find the first non-managed role that's not @everyone and not a rank role
            // This is typically just below admin/mod roles
            let targetPosition = null;
            for (const role of allRoles) {
                // Skip @everyone
                if (role.id === guild.id) continue;

                // Skip managed roles (bot roles, integrations)
                if (role.managed) continue;

                // Skip rank roles themselves
                if (rankRoles.some(r => r.role.id === role.id)) continue;

                // This is a good position - just below this role
                targetPosition = role.position - 1;
                break;
            }

            // Fallback: use position just below bot's role
            if (targetPosition === null || targetPosition <= 0) {
                const botHighestRole = botMember.roles.highest;
                targetPosition = botHighestRole.position - 1;
            }

            // Final check
            if (targetPosition <= 0) {
                await interaction.editReply({
                    content: `${config.emojis.error} Impossible de trouver une position valide. Déplacez le rôle du bot plus haut manuellement.`
                });
                return;
            }

            logger.info(`Target position for rank roles: ${targetPosition}`);

            let movedCount = 0;
            const results = [];

            // Move roles in order (highest rank first)
            for (let i = 0; i < rankRoles.length; i++) {
                const { role, level } = rankRoles[i];
                const newPosition = targetPosition - i;

                try {
                    // Only move if position changed
                    if (role.position !== newPosition) {
                        await role.setPosition(newPosition, {
                            reason: 'Fix rank positions via /fix-rank-positions'
                        });
                        movedCount++;
                        results.push(`✅ **${role.name}** → Position ${newPosition}`);
                        logger.info(`Moved ${role.name} to position ${newPosition}`);

                        // Small delay to avoid rate limits
                        await new Promise(resolve => setTimeout(resolve, 300));
                    } else {
                        results.push(`⚪ **${role.name}** - Déjà bien positionné`);
                    }
                } catch (error) {
                    logger.error(`Failed to move role ${role.name}:`, error);
                    results.push(`❌ **${role.name}** - Erreur`);
                }
            }

            // Build response
            let responseMessage = `${config.emojis.success} **Réorganisation des rôles de rang terminée!**\n\n`;
            responseMessage += `📊 **Rôles trouvés:** ${rankRoles.length}\n`;
            responseMessage += `✅ **Rôles déplacés:** ${movedCount}\n\n`;
            responseMessage += `**Détails:**\n${results.join('\n')}\n\n`;
            responseMessage += `💡 Les couleurs des rangs devraient maintenant s'afficher correctement sur les pseudos!`;

            await interaction.editReply({ content: responseMessage });

            logger.info(`Fix-rank-positions completed: ${movedCount} roles moved`);

        } catch (error) {
            logger.error('Error in fix-rank-positions command:', error);

            let errorMessage = `${config.emojis.error} Erreur lors de la réorganisation des rôles.`;

            if (error.code === 50013) {
                errorMessage += '\n**Permissions insuffisantes** - Vérifiez que le bot a la permission de gérer les rôles et qu\'il est au-dessus des rôles de rang.';
            }

            await interaction.editReply({ content: errorMessage });
        }
    }
};
