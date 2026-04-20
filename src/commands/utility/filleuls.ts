import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import config from '../../config/config.js';
import logger from '../../utils/logger.js';
import { getUserReferralStats } from '../../utils/referralSystem.js';
import { getUserXP } from '../../utils/xpSystem.js';
import { getRankByXP } from '../../config/ranks.js';

export default {
    data: new SlashCommandBuilder()
        .setName('filleuls')
        .setDescription('Affiche tes filleuls validés et en attente'),

    category: 'utility',
    cooldown: 5,

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const userId = interaction.user.id;
            const stats = await getUserReferralStats(userId);

            if (!stats.inviteCode) {
                return await interaction.editReply({
                    content: `${config.emojis.error} Tu n'as pas encore créé de lien de parrainage.\n\nUtilise \`/parrainage\` pour générer ton lien !`
                });
            }

            const embed = new EmbedBuilder()
                .setTitle('🤝 Tes Filleuls')
                .setColor(config.colors.primary)
                .setThumbnail(interaction.user.displayAvatarURL())
                .setFooter({
                    text: `Total: ${stats.totalReferrals} filleul${stats.totalReferrals > 1 ? 's' : ''} validé${stats.totalReferrals > 1 ? 's' : ''}`,
                    iconURL: interaction.user.displayAvatarURL()
                })
                .setTimestamp();

            // Validated referrals
            if (stats.validatedReferrals.length > 0) {
                const validatedList = await Promise.all(
                    stats.validatedReferrals.slice(0, 10).map(async (ref, index) => {
                        try {
                            const user = await interaction.client.users.fetch(ref.userId);
                            const validatedDate = new Date(ref.validatedAt);
                            return `**${index + 1}.** ${user.tag} - <t:${Math.floor(validatedDate.getTime() / 1000)}:R>`;
                        } catch (error) {
                            return `**${index + 1}.** Utilisateur inconnu`;
                        }
                    })
                );

                embed.addFields({
                    name: `✅ Filleuls Validés (${stats.validatedReferrals.length})`,
                    value: validatedList.join('\n') || 'Aucun',
                    inline: false
                });

                if (stats.validatedReferrals.length > 10) {
                    embed.addFields({
                        name: '\u200B',
                        value: `_... et ${stats.validatedReferrals.length - 10} de plus_`,
                        inline: false
                    });
                }
            } else {
                embed.addFields({
                    name: '✅ Filleuls Validés (0)',
                    value: 'Aucun filleul validé pour le moment',
                    inline: false
                });
            }

            // Pending referrals
            if (stats.pendingReferrals.length > 0) {
                const pendingList = await Promise.all(
                    stats.pendingReferrals.slice(0, 10).map(async (pending, index) => {
                        try {
                            const user = await interaction.client.users.fetch(pending.userId);
                            const daysSinceJoin = Math.floor((Date.now() - pending.joinedAt) / (24 * 60 * 60 * 1000));

                            // Get user rank
                            const userXPData = await getUserXP(interaction.guild.id, pending.userId);
                            const userRank = getRankByXP(userXPData.xp);

                            const progress = [];
                            progress.push(daysSinceJoin >= 7 ? '✅ 7j' : `⏳ ${daysSinceJoin}/7j`);
                            progress.push(userRank.level >= 2 ? '✅ Robusta' : `⏳ ${userRank.name}`);

                            return `**${index + 1}.** ${user.tag}\n${progress.join(' • ')}`;
                        } catch (error) {
                            return `**${index + 1}.** Utilisateur inconnu (a quitté ?)`;
                        }
                    })
                );

                embed.addFields({
                    name: `⏳ En Attente de Validation (${stats.pendingReferrals.length})`,
                    value: pendingList.join('\n\n') || 'Aucun',
                    inline: false
                });

                if (stats.pendingReferrals.length > 10) {
                    embed.addFields({
                        name: '\u200B',
                        value: `_... et ${stats.pendingReferrals.length - 10} de plus_`,
                        inline: false
                    });
                }
            } else {
                embed.addFields({
                    name: '⏳ En Attente de Validation (0)',
                    value: 'Aucun filleul en attente',
                    inline: false
                });
            }

            // Reward progress
            const rewardTiers = [
                { count: 1, reward: 'Rate limit x2 + Badge 🤝' },
                { count: 3, reward: 'Pas de rate limit + Cooldown XP réduit' },
                { count: 5, reward: '+25% XP + Bypass modération' },
                { count: 10, reward: '+50% XP + Accès prioritaire bot' }
            ];

            let nextTier = rewardTiers.find(tier => stats.totalReferrals < tier.count);

            if (nextTier) {
                const remaining = nextTier.count - stats.totalReferrals;
                embed.addFields({
                    name: '🎁 Prochaine Récompense',
                    value: `**${remaining} filleul${remaining > 1 ? 's' : ''} restant${remaining > 1 ? 's' : ''}** pour débloquer:\n${nextTier.reward}`,
                    inline: false
                });
            } else {
                embed.addFields({
                    name: '🎁 Récompenses',
                    value: '🏆 Toutes les récompenses débloquées !',
                    inline: false
                });
            }

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            logger.error('Error in filleuls command:', error);

            await interaction.editReply({
                content: `${config.emojis.error} Erreur lors de la récupération de tes filleuls: ${error.message}`
            });
        }
    }
};
