import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import config from '../../config/config.js';

export default {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Affiche les commandes disponibles'),

    category: 'utility',
    cooldown: 5,

    async execute(interaction) {
        const embed = new EmbedBuilder()
            .setTitle('☕ Commandes du Café Bot')
            .setDescription('Voici les principales commandes pour interagir avec le bot et progresser sur le serveur !')
            .setColor(config.colors.primary)
            .setThumbnail(interaction.client.user.displayAvatarURL())
            .addFields(
                {
                    name: '📊 Système de Rangs',
                    value:
                        '**`/rangs`** - Affiche tous les rangs disponibles et ta progression\n' +
                        '**`/carte`** - Ta carte de membre avec stats et rang actuel\n' +
                        '**`/leaderboard`** - Classement des membres par XP\n\n' +
                        '*Gagne 5-15 XP par message (cooldown 1min)*',
                    inline: false
                },
                {
                    name: '💬 Interaction avec le Bot',
                    value:
                        '**Mentionne le bot** - Pose tes questions techniques\n' +
                        '*Exemple : @Café Bot c\'est quoi AWS ?*\n\n' +
                        '⚠️ Rate limit : 5 questions / 5 minutes',
                    inline: false
                },
                {
                    name: '🤝 Système de Parrainage',
                    value:
                        '**`/parrainage`** - Génère ton lien de parrainage unique\n' +
                        '**`/filleuls`** - Affiche tes filleuls et leurs progressions\n\n' +
                        '*Récompenses : Rate limit réduit, bonus XP, accès prioritaire...*',
                    inline: false
                },
                {
                    name: '🎯 Les 10 Rangs',
                    value:
                        '🌱 Grain • 🫘 Robusta • ☕ Arabica • 🔥 Espresso • ⚡ Ristretto\n' +
                        '💧 Lungo • ☁️ Cappuccino • 🎨 Macchiato • 🍨 Affogato • 👑 Moka',
                    inline: false
                },
                {
                    name: '💡 Astuces',
                    value:
                        '• Participe activement pour gagner de l\'XP\n' +
                        '• Utilise `/rangs` pour suivre ta progression\n' +
                        '• Les rangs donnent accès à des rôles colorés\n' +
                        '• Mentionne le bot pour des questions tech',
                    inline: false
                }
            )
            .setFooter({
                text: 'Le Café Cloud',
                iconURL: interaction.client.user.displayAvatarURL()
            })
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    }
};