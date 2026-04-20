import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import config from '../../config/config.js';
import logger from '../../utils/logger.js';
import { getUserXP, setUserXP, addUserXP, updateUserRankRole } from '../../utils/xpSystem.js';
import { getRankByXP } from '../../config/ranks.js';

export default {
    data: new SlashCommandBuilder()
        .setName('manage-xp')
        .setDescription('Gérer l\'XP des utilisateurs')
        .addSubcommand(subcommand =>
            subcommand
                .setName('set')
                .setDescription('Définir l\'XP d\'un utilisateur')
                .addUserOption(option =>
                    option.setName('utilisateur')
                        .setDescription('L\'utilisateur à modifier')
                        .setRequired(true))
                .addIntegerOption(option =>
                    option.setName('xp')
                        .setDescription('Montant d\'XP à définir')
                        .setMinValue(0)
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Ajouter de l\'XP à un utilisateur')
                .addUserOption(option =>
                    option.setName('utilisateur')
                        .setDescription('L\'utilisateur à modifier')
                        .setRequired(true))
                .addIntegerOption(option =>
                    option.setName('xp')
                        .setDescription('Montant d\'XP à ajouter')
                        .setMinValue(1)
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('view')
                .setDescription('Voir l\'XP d\'un utilisateur')
                .addUserOption(option =>
                    option.setName('utilisateur')
                        .setDescription('L\'utilisateur à consulter')
                        .setRequired(true)))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .setDMPermission(false),

    category: 'utility',
    cooldown: 5,

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const targetUser = interaction.options.getUser('utilisateur');

        await interaction.deferReply({ ephemeral: true });

        try {
            const member = await interaction.guild.members.fetch(targetUser.id);

            if (subcommand === 'view') {
                const userData = await getUserXP(interaction.guild.id, targetUser.id);
                const rank = getRankByXP(userData.xp);

                await interaction.editReply({
                    content: `${config.emojis.success} **Statistiques de ${targetUser.username}**\n\n` +
                        `**Rang:** ${rank.name}\n` +
                        `**XP Total:** ${userData.xp.toLocaleString()} XP\n` +
                        `**Messages:** ${userData.messageCount.toLocaleString()}\n` +
                        `**Level:** ${rank.level}/10`
                });
                return;
            }

            if (subcommand === 'set') {
                const xpAmount = interaction.options.getInteger('xp');
                const oldData = await getUserXP(interaction.guild.id, targetUser.id);
                const oldRank = getRankByXP(oldData.xp);

                await setUserXP(interaction.guild.id, targetUser.id, xpAmount);

                const newRank = getRankByXP(xpAmount);

                // Update rank role
                await updateUserRankRole(member, newRank);

                const rankChanged = oldRank.level !== newRank.level;

                let message = `${config.emojis.success} XP de **${targetUser.username}** défini à **${xpAmount.toLocaleString()} XP**\n\n`;

                if (rankChanged) {
                    message += `**Rang:** ${oldRank.name} → ${newRank.name}`;
                } else {
                    message += `**Rang:** ${newRank.name}`;
                }

                await interaction.editReply({ content: message });

                logger.info(`${interaction.user.tag} set ${targetUser.tag}'s XP to ${xpAmount}`);
            }

            if (subcommand === 'add') {
                const xpAmount = interaction.options.getInteger('xp');
                const result = await addUserXP(interaction.guild.id, targetUser.id, xpAmount);

                // Update rank role if leveled up
                if (result.leveledUp) {
                    await updateUserRankRole(member, result.newRank);
                }

                let message = `${config.emojis.success} **${xpAmount.toLocaleString()} XP** ajouté à **${targetUser.username}**\n\n`;
                message += `**XP Total:** ${result.totalXP.toLocaleString()} XP\n`;

                if (result.leveledUp) {
                    message += `**Rang:** ${result.oldRank.name} → ${result.newRank.name} 🎉`;
                } else {
                    message += `**Rang:** ${result.newRank.name}`;
                }

                await interaction.editReply({ content: message });

                logger.info(`${interaction.user.tag} added ${xpAmount} XP to ${targetUser.tag}`);
            }

        } catch (error) {
            logger.error('Error in manage-xp command:', error);

            let errorMessage = `${config.emojis.error} Erreur lors de la gestion de l'XP.`;

            if (error.code === 50013) {
                errorMessage += '\n**Permissions insuffisantes** - Vérifiez que le bot peut gérer les rôles.';
            }

            await interaction.editReply({ content: errorMessage });
        }
    }
};
