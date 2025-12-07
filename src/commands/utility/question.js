import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import config from '../../config/config.js';
import logger from '../../utils/logger.js';
import { checkRateLimit, setRateLimit, removeRateLimit, fetchMessageHistory, queryAI } from '../../utils/aiAssistant.js';

export default {
    data: new SlashCommandBuilder()
        .setName('question')
        .setDescription('Pose une question à l\'IA sur les derniers messages du salon')
        .addStringOption(option =>
            option.setName('question')
                .setDescription('Ta question sur la conversation')
                .setRequired(true)),

    category: 'utility',
    cooldown: 3,

    async execute(interaction) {
        const userId = interaction.user.id;

        // Check rate limit
        const rateLimitCheck = checkRateLimit(userId);
        if (!rateLimitCheck.allowed) {
            return interaction.reply({
                content: `${config.emojis.warning} **Rate limit**: Tu peux utiliser cette commande dans ${rateLimitCheck.remainingTime}`,
                ephemeral: true
            });
        }

        // Set cooldown
        setRateLimit(userId);

        await interaction.deferReply();

        try {
            const userQuestion = interaction.options.getString('question');
            logger.info(`[QUESTION] User ${interaction.user.tag} asking: ${userQuestion}`);

            // Fetch message history
            const { history: messageHistory, userIds } = await fetchMessageHistory(interaction.channel, 20);

            // Query AI with context for memory system
            const answer = await queryAI(userQuestion, messageHistory, {
                channelId: interaction.channel.id,
                channelName: interaction.channel.name,
                userId: interaction.user.id,
                username: interaction.user.username,
                userIds: userIds
            });

            // Create response embed
            const embed = new EmbedBuilder()
                .setTitle('🤖 Réponse de l\'Assistant')
                .setDescription(answer.substring(0, 4000))  // Discord embed description limit
                .setColor(config.colors.primary)
                .addFields({
                    name: '❓ Question',
                    value: userQuestion,
                    inline: false
                })
                .setFooter({
                    text: `Demandé par ${interaction.user.tag} • Limite: 1 fois/5min`,
                    iconURL: interaction.user.displayAvatarURL()
                })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            logger.error('[QUESTION] Error:', error);

            await interaction.editReply({
                content: `${config.emojis.error} **Erreur**: Impossible de traiter la demande.\n\`\`\`${error.message}\`\`\``
            });

            // Remove cooldown on error
            removeRateLimit(userId);
        }
    }
};