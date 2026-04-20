import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import config from '../../config/config.js';
import logger from '../../utils/logger.js';
import { ranks, getRankByXP } from '../../config/ranks.js';
import { loadUserData } from '../../utils/xpSystem.js';

export default {
    data: new SlashCommandBuilder()
        .setName('sync-ranks')
        .setDescription('Synchronise les rôles de rang de tous les membres avec leur XP actuel')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .setDMPermission(false),

    category: 'utility',
    cooldown: 60,

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const guild = interaction.guild;

            // Fetch ALL members from the guild
            await guild.members.fetch();
            const allMembers = Array.from(guild.members.cache.values())
                .filter(member => !member.user.bot); // Skip bots

            logger.info(`Found ${allMembers.length} members in guild`);

            // Load all user XP data
            const userData = await loadUserData();

            // Find all rank roles
            const rankRoles = new Map();
            for (const rankConfig of ranks) {
                const role = guild.roles.cache.find(r => r.name === rankConfig.name);
                if (role) {
                    rankRoles.set(rankConfig.level, role);
                } else {
                    logger.warn(`Rank role not found: ${rankConfig.name}`);
                }
            }

            if (rankRoles.size === 0) {
                await interaction.editReply({
                    content: `${config.emojis.error} Aucun rôle de rang trouvé. Utilisez \`/setup-ranks\` pour les créer.`
                });
                return;
            }

            let updatedCount = 0;
            let skippedCount = 0;
            let errorCount = 0;
            const results = [];

            logger.info(`Processing ${allMembers.length} members for rank sync`);

            // Process each member
            for (const member of allMembers) {
                const userId = member.user.id;
                const userKey = `${guild.id}-${userId}`;

                // Get user's XP (default to 0 if not found)
                let xp = 0;
                const userXPData = userData[userKey];
                if (userXPData) {
                    if (Array.isArray(userXPData)) {
                        xp = userXPData[0] || 0;
                    } else {
                        xp = userXPData.xp || 0;
                    }
                }

                try {

                    // Get the rank they should have
                    const targetRank = getRankByXP(xp);
                    const targetRole = rankRoles.get(targetRank.level);

                    if (!targetRole) {
                        logger.warn(`Target role not found for level ${targetRank.level}`);
                        continue;
                    }

                    // Check if bot can manage this member (check role hierarchy)
                    const botMember = guild.members.me;
                    if (member.roles.highest.position >= botMember.roles.highest.position) {
                        // Skip members with roles higher than or equal to bot's role
                        skippedCount++;
                        logger.debug(`Skipping ${member.user.tag}: member role too high`);
                        continue;
                    }

                    // Get current rank roles the user has
                    const currentRankRoles = member.roles.cache.filter(role =>
                        Array.from(rankRoles.values()).some(r => r.id === role.id)
                    );

                    // Check if user already has the correct role
                    if (currentRankRoles.size === 1 && currentRankRoles.has(targetRole.id)) {
                        skippedCount++;
                        continue; // Already has correct role
                    }

                    // Remove old rank roles
                    if (currentRankRoles.size > 0) {
                        await member.roles.remove(currentRankRoles);
                    }

                    // Add correct rank role
                    await member.roles.add(targetRole);
                    updatedCount++;

                    results.push(`✅ <@${userId}> → **${targetRank.name}** (${xp} XP)`);
                    logger.info(`Synced rank for ${member.user.tag}: ${targetRank.name}`);

                    // Small delay to avoid rate limits
                    if (updatedCount % 10 === 0) {
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }

                } catch (error) {
                    // Check if it's a permission error
                    if (error.code === 50013) {
                        // Missing permissions - skip this user
                        skippedCount++;
                        logger.debug(`Skipping ${userId}: missing permissions`);
                    } else {
                        errorCount++;
                        logger.error(`Error syncing rank for user ${userId}:`, error);
                        results.push(`❌ <@${userId}> - Erreur`);
                    }
                }
            }

            // Build response
            let responseMessage = `${config.emojis.success} **Synchronisation des rangs terminée!**\n\n`;
            responseMessage += `📊 **Membres traités:** ${allMembers.length}\n`;
            responseMessage += `✅ **Rangs mis à jour:** ${updatedCount}\n`;
            responseMessage += `⚪ **Déjà corrects:** ${skippedCount}\n`;

            if (errorCount > 0) {
                responseMessage += `❌ **Erreurs:** ${errorCount}\n`;
            }

            responseMessage += `\n`;

            // Show sample results (limit to avoid message too long)
            if (results.length > 0) {
                const sampleResults = results.slice(0, 15);
                responseMessage += `**Exemples de mises à jour:**\n${sampleResults.join('\n')}`;

                if (results.length > 15) {
                    responseMessage += `\n... et ${results.length - 15} autres`;
                }
            }

            // Split message if too long
            if (responseMessage.length > 2000) {
                responseMessage = responseMessage.substring(0, 1950) + '\n\n... (message tronqué)';
            }

            await interaction.editReply({ content: responseMessage });

            logger.info(`Sync-ranks completed: ${updatedCount} updated, ${skippedCount} skipped, ${errorCount} errors`);

        } catch (error) {
            logger.error('Error in sync-ranks command:', error);

            let errorMessage = `${config.emojis.error} Erreur lors de la synchronisation des rangs.`;

            if (error.code === 50013) {
                errorMessage += '\n**Permissions insuffisantes** - Vérifiez que le bot a la permission de gérer les rôles.';
            }

            await interaction.editReply({ content: errorMessage });
        }
    }
};
