import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import config from '../../config/config.js';
import logger from '../../utils/logger.js';
import { ranks } from '../../config/ranks.js';

export default {
    data: new SlashCommandBuilder()
        .setName('setup-ranks')
        .setDescription('Crée tous les rôles de rang avec un magnifique dégradé de couleurs')
        .addBooleanOption(option =>
            option.setName('recreate')
                .setDescription('Supprimer et recréer tous les rangs existants')
                .setRequired(false))
        .addBooleanOption(option =>
            option.setName('update-colors')
                .setDescription('Mettre à jour uniquement les couleurs des rôles existants')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .setDMPermission(false),

    category: 'utility',
    cooldown: 30,

    async execute(interaction) {
        const recreate = interaction.options.getBoolean('recreate') || false;
        const updateColors = interaction.options.getBoolean('update-colors') || false;

        await interaction.deferReply({ ephemeral: true });

        try {
            const guild = interaction.guild;
            let createdCount = 0;
            let skippedCount = 0;
            let deletedCount = 0;
            let updatedCount = 0;
            const results = [];

            // If update-colors is true, just update colors of existing roles
            if (updateColors) {
                logger.info('Update colors mode: Updating role colors...');

                for (const rankConfig of ranks) {
                    const role = guild.roles.cache.find(r => r.name === rankConfig.name);

                    if (role) {
                        try {
                            await role.setColor(rankConfig.color, 'Updating rank colors via /setup-ranks');
                            updatedCount++;
                            results.push(`🎨 **${rankConfig.name}** - Couleur mise à jour`);
                            logger.info(`Updated color for ${rankConfig.name}: ${rankConfig.color.toString(16)}`);
                            await new Promise(resolve => setTimeout(resolve, 300));
                        } catch (error) {
                            logger.error(`Failed to update color for ${rankConfig.name}:`, error);
                            results.push(`❌ **${rankConfig.name}** - Erreur`);
                        }
                    } else {
                        results.push(`⚠️ **${rankConfig.name}** - Rôle introuvable`);
                    }
                }

                let responseMessage = `${config.emojis.success} **Mise à jour des couleurs terminée!**\n\n`;
                responseMessage += `🎨 **Couleurs mises à jour:** ${updatedCount}/${ranks.length}\n\n`;
                responseMessage += `**🎨 Nouveau dégradé:**\n`;
                responseMessage += `🔵 **Bleu foncé** → 🟣 **Violet** → 👑 **Or**\n\n`;
                responseMessage += `**Détails:**\n${results.join('\n')}`;

                await interaction.editReply({ content: responseMessage });
                logger.info(`Update-colors completed: ${updatedCount} updated`);
                return;
            }

            // If recreate is true, delete existing rank roles first
            if (recreate) {
                logger.info('Recreate mode: Deleting existing rank roles...');

                for (const rankConfig of ranks) {
                    const existingRole = guild.roles.cache.find(r => r.name === rankConfig.name);

                    if (existingRole) {
                        try {
                            await existingRole.delete('Recreating rank roles via /setup-ranks');
                            deletedCount++;
                            logger.info(`Deleted existing role: ${rankConfig.name}`);
                        } catch (error) {
                            logger.error(`Failed to delete role ${rankConfig.name}:`, error);
                        }
                    }
                }

                if (deletedCount > 0) {
                    // Wait a bit to ensure Discord processes deletions
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }

            // Get bot's highest role position
            const botMember = guild.members.me;
            const botHighestRole = botMember.roles.highest;
            let targetPosition = botHighestRole.position - 1;

            // Create roles in reverse order (highest rank first)
            // This ensures proper role hierarchy in Discord
            for (let i = ranks.length - 1; i >= 0; i--) {
                const rankConfig = ranks[i];

                // Check if role already exists
                let role = guild.roles.cache.find(r => r.name === rankConfig.name);

                if (role && !recreate) {
                    skippedCount++;
                    results.push(`⚠️ **${rankConfig.name}** - Existe déjà`);
                    logger.info(`Role already exists: ${rankConfig.name}`);
                    continue;
                }

                // Create the role
                try {
                    role = await guild.roles.create({
                        name: rankConfig.name,
                        color: rankConfig.color,
                        reason: `Rank system setup via /setup-ranks (Level ${rankConfig.level})`,
                        hoist: false, // Don't separate in member list, but keep username color
                        mentionable: false
                    });

                    createdCount++;
                    logger.info(`Created rank role: ${rankConfig.name} (Level ${rankConfig.level}, Color: ${rankConfig.color.toString(16)})`);

                    // Position the role just below the bot's highest role
                    try {
                        if (targetPosition > 0) {
                            await role.setPosition(targetPosition, {
                                reason: 'Position rank role for color display'
                            });
                            logger.info(`Positioned ${rankConfig.name} at position ${targetPosition}`);
                        }
                    } catch (posError) {
                        logger.warn(`Could not position role ${rankConfig.name}:`, posError.message);
                    }

                    results.push(`✅ **${rankConfig.name}** - Créé (${rankConfig.description})`);

                    // Small delay to avoid rate limits
                    await new Promise(resolve => setTimeout(resolve, 500));

                } catch (error) {
                    logger.error(`Failed to create role ${rankConfig.name}:`, error);
                    results.push(`❌ **${rankConfig.name}** - Erreur lors de la création`);
                }
            }

            // Build response message
            let responseMessage = `${config.emojis.success} **Configuration du système de rangs terminée!**\n\n`;

            if (recreate && deletedCount > 0) {
                responseMessage += `🗑️ **Rangs supprimés:** ${deletedCount}\n`;
            }

            responseMessage += `✅ **Rangs créés:** ${createdCount}\n`;

            if (skippedCount > 0) {
                responseMessage += `⚠️ **Rangs existants ignorés:** ${skippedCount}\n`;
            }

            responseMessage += `\n**Total des rangs:** ${ranks.length}\n\n`;

            // Show gradient preview
            responseMessage += `**🎨 Dégradé de couleurs:**\n`;
            responseMessage += `🔵 **Bleu foncé** → 🟣 **Violet** → 👑 **Or**\n\n`;

            // Add detailed results (limit to avoid message too long)
            if (results.length <= 15) {
                responseMessage += `**Détails:**\n${results.join('\n')}`;
            } else {
                responseMessage += `**Premiers résultats:**\n${results.slice(0, 10).join('\n')}\n... et ${results.length - 10} autres`;
            }

            // Add instructions
            responseMessage += `\n\n💡 **Astuce:** Utilisez \`/ranks\` pour voir la progression des rangs`;

            await interaction.editReply({ content: responseMessage });

            logger.info(`Setup-ranks completed: ${createdCount} created, ${skippedCount} skipped, ${deletedCount} deleted`);

        } catch (error) {
            logger.error('Error in setup-ranks command:', error);

            let errorMessage = `${config.emojis.error} Erreur lors de la configuration des rangs.`;

            if (error.code === 50013) {
                errorMessage += '\n**Permissions insuffisantes** - Vérifiez que le bot a la permission de gérer les rôles.';
            } else if (error.code === 30005) {
                errorMessage += '\n**Limite de rôles atteinte** - Le serveur a atteint la limite maximale de rôles (250).';
            }

            await interaction.editReply({ content: errorMessage });
        }
    }
};
