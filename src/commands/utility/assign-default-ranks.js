import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import config from '../../config/config.js';
import logger from '../../utils/logger.js';
import { ranks } from '../../config/ranks.js';

export default {
    data: new SlashCommandBuilder()
        .setName('assign-default-ranks')
        .setDescription('Attribue le rôle Grain à tous les membres qui n\'ont pas de rang')
        .addBooleanOption(option =>
            option.setName('dry-run')
                .setDescription('Voir combien de membres seraient affectés sans appliquer les changements')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .setDMPermission(false),

    category: 'utility',
    cooldown: 30,

    async execute(interaction) {
        const dryRun = interaction.options.getBoolean('dry-run') || false;

        await interaction.deferReply({ ephemeral: true });

        try {
            const guild = interaction.guild;

            // Get the first rank (Grain - Level 1)
            const firstRank = ranks[0];

            if (!firstRank) {
                await interaction.editReply({
                    content: `${config.emojis.error} Aucun rang configuré dans le système.`
                });
                return;
            }

            // Find the default rank role
            const defaultRankRole = guild.roles.cache.find(r => r.name === firstRank.name);

            if (!defaultRankRole) {
                await interaction.editReply({
                    content: `${config.emojis.error} Le rôle "${firstRank.name}" n'existe pas sur ce serveur.\n` +
                        `Utilisez \`/setup-ranks\` pour créer les rôles d'abord.`
                });
                return;
            }

            // Get all rank role names
            const rankRoleNames = ranks.map(r => r.name);

            // Fetch all members (this might take time for large servers)
            await interaction.editReply({
                content: `${config.emojis.loading} Récupération de tous les membres du serveur...`
            });

            await guild.members.fetch();

            // Find members without any rank role
            const membersWithoutRank = guild.members.cache.filter(member => {
                // Skip bots
                if (member.user.bot) return false;

                // Check if member has any rank role
                const hasRankRole = member.roles.cache.some(role =>
                    rankRoleNames.includes(role.name)
                );

                return !hasRankRole;
            });

            if (membersWithoutRank.size === 0) {
                await interaction.editReply({
                    content: `${config.emojis.success} Tous les membres ont déjà un rôle de rang!`
                });
                return;
            }

            if (dryRun) {
                // Dry run - just show stats
                await interaction.editReply({
                    content: `${config.emojis.info} **Mode test (dry-run)**\n\n` +
                        `**Membres sans rang:** ${membersWithoutRank.size}\n` +
                        `**Rôle qui serait attribué:** ${firstRank.name}\n\n` +
                        `Relancez la commande sans l'option \`dry-run\` pour appliquer les changements.`
                });
                return;
            }

            // Actually assign the roles
            await interaction.editReply({
                content: `${config.emojis.loading} Attribution du rôle "${firstRank.name}" à ${membersWithoutRank.size} membre(s)...\n` +
                    `Cela peut prendre quelques minutes pour un grand nombre de membres.`
            });

            let successCount = 0;
            let errorCount = 0;
            const errors = [];

            // Process in batches to avoid rate limits
            const memberArray = Array.from(membersWithoutRank.values());
            const batchSize = 10;

            for (let i = 0; i < memberArray.length; i += batchSize) {
                const batch = memberArray.slice(i, i + batchSize);

                await Promise.all(
                    batch.map(async (member) => {
                        try {
                            await member.roles.add(defaultRankRole);
                            successCount++;
                            logger.debug(`Assigned ${firstRank.name} to ${member.user.tag}`);
                        } catch (error) {
                            errorCount++;
                            errors.push(`${member.user.tag}: ${error.message}`);
                            logger.error(`Failed to assign rank to ${member.user.tag}:`, error);
                        }
                    })
                );

                // Update progress every batch
                if ((i + batchSize) % 50 === 0 || i + batchSize >= memberArray.length) {
                    const progress = Math.min(i + batchSize, memberArray.length);
                    await interaction.editReply({
                        content: `${config.emojis.loading} Progression: ${progress}/${memberArray.length} membres traités...`
                    });
                }

                // Small delay to avoid rate limits
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            // Build final response
            let responseMessage = `${config.emojis.success} **Attribution des rangs terminée!**\n\n`;
            responseMessage += `**Rôle attribué:** ${firstRank.name}\n`;
            responseMessage += `**Succès:** ${successCount} membre(s)\n`;

            if (errorCount > 0) {
                responseMessage += `**Échecs:** ${errorCount} membre(s)\n\n`;

                if (errors.length <= 5) {
                    responseMessage += `**Erreurs:**\n${errors.join('\n')}`;
                } else {
                    responseMessage += `**Erreurs:** ${errors.slice(0, 5).join('\n')}\n... et ${errors.length - 5} autres`;
                }
            }

            await interaction.editReply({ content: responseMessage });

            logger.info(`Assigned default rank to ${successCount} members (${errorCount} failures)`);

        } catch (error) {
            logger.error('Error in assign-default-ranks command:', error);

            let errorMessage = `${config.emojis.error} Erreur lors de l'attribution des rangs.`;

            if (error.code === 50013) {
                errorMessage += '\n**Permissions insuffisantes** - Vérifiez que le bot a la permission de gérer les rôles.';
            }

            await interaction.editReply({ content: errorMessage });
        }
    }
};
