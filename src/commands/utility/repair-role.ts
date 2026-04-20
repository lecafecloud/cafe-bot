import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import config from '../../config/config.js';
import logger from '../../utils/logger.js';

/**
 * Normalize a string by removing accents and converting to lowercase
 */
function normalizeString(str) {
    return str
        .normalize('NFD') // Décompose les caractères accentués
        .replace(/[\u0300-\u036f]/g, '') // Retire les accents
        .toLowerCase();
}

/**
 * Check if a role name has accents
 */
function hasAccents(str) {
    return str.normalize('NFD') !== str.normalize('NFC').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Get role reactions from keystore
 */
async function getRoleReactions(guildId) {
    try {
        // Access keystore through the global instance
        const keystoreChannelId = process.env.KEYSTORE_CHANNEL_ID;
        if (!keystoreChannelId) {
            return [];
        }

        // Import dynamically to avoid circular dependency
        const { getKeystore } = await import('../../utils/discordKeystore.js');
        const keystore = await getKeystore();

        const data = await keystore.getStore('role-reactions');
        const reactions = data?.reactions || [];

        return reactions.filter(r => r.guildId === guildId);
    } catch (error) {
        logger.error('Error loading role reactions:', error);
        return [];
    }
}

/**
 * Save role reactions to keystore
 */
async function saveRoleReactions(guildId, guildReactions, allReactions) {
    try {
        const keystoreChannelId = process.env.KEYSTORE_CHANNEL_ID;
        if (!keystoreChannelId) {
            return;
        }

        const { getKeystore } = await import('../../utils/discordKeystore.js');
        const keystore = await getKeystore();

        // Merge updated guild reactions with other guilds
        const otherGuildsReactions = allReactions.filter(r => r.guildId !== guildId);
        await keystore.setStore('role-reactions', {
            reactions: [...otherGuildsReactions, ...guildReactions]
        });
    } catch (error) {
        logger.error('Error saving role reactions:', error);
    }
}

export default {
    data: new SlashCommandBuilder()
        .setName('repair-role')
        .setDescription('Fusionne les rôles en double (même nom avec/sans accents)')
        .addStringOption(option =>
            option.setName('rolename')
                .setDescription('Le nom du rôle à réparer (laissez vide pour réparer tous les doublons)')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .setDMPermission(false),

    category: 'utility',
    cooldown: 10,

    async execute(interaction) {
        const specificRoleName = interaction.options.getString('rolename');

        await interaction.deferReply({ ephemeral: true });

        try {
            const guild = interaction.guild;

            // Build a map of NORMALIZED role names to role arrays
            const rolesByNormalizedName = new Map();

            for (const role of guild.roles.cache.values()) {
                // Skip @everyone role
                if (role.name === '@everyone') continue;

                const normalizedName = normalizeString(role.name);

                if (!rolesByNormalizedName.has(normalizedName)) {
                    rolesByNormalizedName.set(normalizedName, []);
                }
                rolesByNormalizedName.get(normalizedName).push(role);
            }

            // Filter for duplicates (groups with more than 1 role)
            let duplicateRoleGroups = Array.from(rolesByNormalizedName.entries())
                .filter(([normalizedName, roles]) => roles.length > 1);

            // If specific role name is provided, filter for that role only
            if (specificRoleName) {
                const normalizedSearch = normalizeString(specificRoleName);
                duplicateRoleGroups = duplicateRoleGroups.filter(([normalizedName]) =>
                    normalizedName.includes(normalizedSearch)
                );
            }

            if (duplicateRoleGroups.length === 0) {
                const message = specificRoleName
                    ? `Aucun doublon trouvé pour le rôle contenant "${specificRoleName}".`
                    : 'Aucun doublon de rôle trouvé sur ce serveur.';

                await interaction.editReply({
                    content: `${config.emojis.success} ${message}`
                });
                return;
            }

            // Load role reactions for updating
            const allRoleReactions = await getRoleReactions(guild.id);
            const guildRoleReactions = [...allRoleReactions]; // Make a copy

            let repairSummary = [];
            let totalMerged = 0;
            let totalDeleted = 0;

            // Process each group of duplicate roles
            for (const [normalizedName, roles] of duplicateRoleGroups) {
                // Sort roles:
                // 1. Prefer roles WITH accents
                // 2. Then by creation date (oldest first)
                const sortedRoles = roles.sort((a, b) => {
                    const aHasAccents = hasAccents(a.name);
                    const bHasAccents = hasAccents(b.name);

                    // If only one has accents, prefer that one
                    if (aHasAccents && !bHasAccents) return -1;
                    if (!aHasAccents && bHasAccents) return 1;

                    // Otherwise, prefer older role
                    return a.createdTimestamp - b.createdTimestamp;
                });

                const keepRole = sortedRoles[0];
                const duplicatesToDelete = sortedRoles.slice(1);

                const displayNames = roles.map(r => r.name).join(', ');
                logger.info(`Processing duplicate roles: ${displayNames}`);
                logger.info(`  Keeping role: ${keepRole.name} (${keepRole.id}) - has accents: ${hasAccents(keepRole.name)}`);
                logger.info(`  Created: ${new Date(keepRole.createdTimestamp).toISOString()}`);

                let membersMoved = 0;

                // Transfer members from duplicate roles to the kept role
                for (const duplicateRole of duplicatesToDelete) {
                    logger.info(`  Merging duplicate role: ${duplicateRole.id}`);

                    // Get all members with this duplicate role
                    const membersWithRole = duplicateRole.members;

                    for (const [memberId, member] of membersWithRole) {
                        try {
                            // Add the kept role if they don't have it
                            if (!member.roles.cache.has(keepRole.id)) {
                                await member.roles.add(keepRole);
                                membersMoved++;
                            }

                            // Remove the duplicate role
                            await member.roles.remove(duplicateRole);
                        } catch (error) {
                            logger.error(`  Failed to transfer role for member ${memberId}:`, error);
                        }
                    }

                    // Update role reactions to point to the kept role
                    for (const reaction of guildRoleReactions) {
                        if (reaction.roleId === duplicateRole.id) {
                            reaction.roleId = keepRole.id;
                            logger.info(`  Updated role reaction mapping: ${reaction.messageId} ${reaction.emoji} -> ${keepRole.id}`);
                        }
                    }

                    // Delete the duplicate role
                    try {
                        await duplicateRole.delete(`Merged into ${keepRole.name} via /repair-role command`);
                        totalDeleted++;
                        logger.info(`  Deleted duplicate role: ${duplicateRole.id}`);
                    } catch (error) {
                        logger.error(`  Failed to delete duplicate role ${duplicateRole.id}:`, error);
                    }
                }

                totalMerged++;
                repairSummary.push({
                    keptName: keepRole.name,
                    mergedNames: duplicatesToDelete.map(r => r.name),
                    duplicatesRemoved: duplicatesToDelete.length,
                    membersMoved: membersMoved
                });
            }

            // Save updated role reactions
            if (guildRoleReactions.length > 0) {
                await saveRoleReactions(guild.id, guildRoleReactions, allRoleReactions);
            }

            // Build response message
            let responseMessage = `${config.emojis.success} **Réparation des rôles terminée!**\n\n`;
            responseMessage += `**Rôles fusionnés:** ${totalMerged}\n`;
            responseMessage += `**Rôles supprimés:** ${totalDeleted}\n\n`;

            if (repairSummary.length > 0) {
                responseMessage += `**Détails:**\n`;
                for (const summary of repairSummary) {
                    responseMessage += `• **Conservé:** ${summary.keptName}\n`;
                    responseMessage += `  **Fusionné:** ${summary.mergedNames.join(', ')}\n`;
                    responseMessage += `  ${summary.duplicatesRemoved} doublon(s) supprimé(s)`;
                    if (summary.membersMoved > 0) {
                        responseMessage += ` • ${summary.membersMoved} membre(s) transféré(s)`;
                    }
                    responseMessage += `\n\n`;
                }
            }

            await interaction.editReply({ content: responseMessage });

            logger.info(`Repair-role command completed: ${totalMerged} roles merged, ${totalDeleted} duplicates deleted`);

        } catch (error) {
            logger.error('Error in repair-role command:', error);

            let errorMessage = `${config.emojis.error} Erreur lors de la réparation des rôles.`;

            if (error.code === 50013) {
                errorMessage += '\n**Permissions insuffisantes** - Vérifiez que le bot a la permission de gérer les rôles et que son rôle est au-dessus des rôles à fusionner.';
            }

            await interaction.editReply({ content: errorMessage });
        }
    }
};
