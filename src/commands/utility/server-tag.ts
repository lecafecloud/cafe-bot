import { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } from 'discord.js';
import config from '../../config/config.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default {
    data: new SlashCommandBuilder()
        .setName('tag')
        .setDescription('Apprends comment ajouter le tag CAFE à ton profil Discord'),

    category: 'utility',
    cooldown: 30,

    async execute(interaction) {
        const embed = new EmbedBuilder()
            .setTitle('☕ Affiche fièrement ton tag CAFE ! ☕')
            .setDescription(
                '**Ajoute le tag CAFE à ton profil !**\n\n' +
                'Visible sur tous tes autres serveurs Discord.\n' +
                'Permet aux autres de rejoindre le Café Cloud en un clic.\n\n' +
                '**Montre ton appartenance à la communauté ! 💪**'
            )
            .setColor(config.colors.primary)
            .addFields(
                {
                    name: '🖥️ Sur PC',
                    value:
                        '1️⃣ Clique sur **Le Café Cloud** en haut à gauche\n' +
                        '2️⃣ Sélectionne **Tag du serveur**\n' +
                        '3️⃣ Appuie sur **Utiliser le tag**',
                    inline: false
                },
                {
                    name: '📱 Sur Mobile',
                    value:
                        '1️⃣ Appuie sur ton avatar en bas à droite\n' +
                        '2️⃣ Appuie sur **Modifier le profil**\n' +
                        '3️⃣ Descends jusqu\'à voir les **tags du serveur**\n' +
                        '4️⃣ Sélectionne **Le Café Cloud**',
                    inline: false
                }
            )
            .setImage('attachment://server-tag-tutorial.png')
            .setFooter({
                text: `Demandé par ${interaction.user.tag}`,
                iconURL: interaction.user.displayAvatarURL()
            })
            .setTimestamp();

        // Attach the tutorial image
        const imagePath = path.join(__dirname, '../../../assets/images/server-tag-tutorial.png');
        const attachment = new AttachmentBuilder(imagePath, { name: 'server-tag-tutorial.png' });

        await interaction.reply({
            embeds: [embed],
            files: [attachment]
        });
    }
};
