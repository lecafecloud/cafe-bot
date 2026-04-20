import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import config from '../../config/config.js';

export default {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Check bot latency and response time'),

    category: 'utility',
    cooldown: 5,

    async execute(interaction) {
        const sent = await interaction.reply({
            content: `${config.emojis.loading} Calculating ping...`,
            fetchReply: true
        });

        const latency = sent.createdTimestamp - interaction.createdTimestamp;
        const apiLatency = Math.round(interaction.client.ws.ping);

        const embed = new EmbedBuilder()
            .setTitle('🏓 Pong!')
            .setColor(config.colors.primary)
            .addFields(
                { name: 'Bot Latency', value: `${latency}ms`, inline: true },
                { name: 'API Latency', value: `${apiLatency}ms`, inline: true }
            )
            .setTimestamp()
            .setFooter({ text: `Requested by ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL() });

        await interaction.editReply({ content: null, embeds: [embed] });
    }
};