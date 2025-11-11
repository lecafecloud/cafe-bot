import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import config from '../../config/config.js';
import logger from '../../utils/logger.js';
import { registerInvite, getUserReferralStats } from '../../utils/referralSystem.js';

export default {
    data: new SlashCommandBuilder()
        .setName('parrainage')
        .setDescription('Génère ton lien de parrainage unique'),

    category: 'utility',
    cooldown: 10,

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const userId = interaction.user.id;
            const guild = interaction.guild;

            // Get user stats
            const stats = await getUserReferralStats(userId);

            // Check if user already has an active invite
            if (stats.inviteCode) {
                try {
                    // Try to get the existing invite
                    const existingInvite = await guild.invites.fetch(stats.inviteCode);

                    if (existingInvite) {
                        // Invite still exists, return it
                        const embed = buildReferralEmbed(interaction.user, existingInvite, stats);
                        return await interaction.editReply({ embeds: [embed] });
                    }
                } catch (error) {
                    // Invite expired or deleted, create a new one
                    logger.info(`Invite ${stats.inviteCode} expired for user ${userId}, creating new one`);
                }
            }

            // Find a suitable channel to create invite (prefer #général or first text channel)
            let inviteChannel = guild.channels.cache.find(ch =>
                ch.isTextBased() &&
                ch.permissionsFor(guild.members.me).has('CreateInstantInvite') &&
                (ch.name.includes('general') || ch.name.includes('général'))
            );

            if (!inviteChannel) {
                inviteChannel = guild.channels.cache.find(ch =>
                    ch.isTextBased() &&
                    ch.permissionsFor(guild.members.me).has('CreateInstantInvite')
                );
            }

            if (!inviteChannel) {
                return await interaction.editReply({
                    content: `${config.emojis.error} Je n'ai pas la permission de créer des invitations sur ce serveur.`
                });
            }

            // Create a permanent invite for this user
            const invite = await inviteChannel.createInvite({
                maxAge: 0, // Permanent
                maxUses: 0, // Unlimited uses
                unique: true, // Create a unique code
                reason: `Lien de parrainage pour ${interaction.user.tag}`
            });

            // Register the invite in our system
            await registerInvite(invite.code, userId);

            logger.info(`Created referral invite ${invite.code} for ${interaction.user.tag}`);

            const embed = buildReferralEmbed(interaction.user, invite, stats);

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            logger.error('Error in parrainage command:', error);

            await interaction.editReply({
                content: `${config.emojis.error} Erreur lors de la génération du lien de parrainage: ${error.message}`
            });
        }
    }
};

/**
 * Build the referral embed
 */
function buildReferralEmbed(user, invite, stats) {
    const embed = new EmbedBuilder()
        .setTitle('🤝 Ton Lien de Parrainage')
        .setDescription(
            `Partage ce lien pour inviter des personnes sur le serveur !\n\n` +
            `**Ton lien :** https://discord.gg/${invite.code}\n\n` +
            `Chaque personne qui rejoint avec ton lien devient ton filleul. ✨`
        )
        .setColor(config.colors.primary)
        .setThumbnail(user.displayAvatarURL())
        .addFields(
            {
                name: '📊 Tes Stats',
                value:
                    `**Filleuls validés :** ${stats.totalReferrals}\n` +
                    `**En attente de validation :** ${stats.pendingReferrals.length}`,
                inline: false
            },
            {
                name: '✅ Conditions de Validation',
                value:
                    `Un filleul est validé si :\n` +
                    `• Reste 7+ jours sur le serveur\n` +
                    `• Atteint le rang Robusta (niveau 2)`,
                inline: false
            },
            {
                name: '🎁 Récompenses',
                value:
                    `**1 filleul :** Rate limit bot x2 + Badge 🤝\n` +
                    `**3 filleuls :** Pas de rate limit + Cooldown XP réduit\n` +
                    `**5 filleuls :** +25% XP + Bypass modération\n` +
                    `**10 filleuls :** +50% XP + Accès prioritaire bot`,
                inline: false
            }
        )
        .setFooter({
            text: 'Le lien est permanent et illimité',
            iconURL: user.displayAvatarURL()
        })
        .setTimestamp();

    return embed;
}
