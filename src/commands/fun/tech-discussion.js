import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import config from '../../config/config.js';
import { generateTechQuestion } from '../../utils/openrouter.js';
import logger from '../../utils/logger.js';
import { addQuestionToHistory, fetchExistingBotMessages } from '../../utils/questionHistory.js';

const CATEGORY_ID = '1387175784862716115';
const SERVER_ID = '1387172171872211045';

export default {
    data: new SlashCommandBuilder()
        .setName('tech-discussion')
        .setDescription('Post une question tech dans un canal aléatoire de la catégorie')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .setDMPermission(false),

    category: 'fun',
    cooldown: 60,

    async execute(interaction) {
        logger.info(`[DEBUG] tech-discussion started by ${interaction.user.tag} in guild ${interaction.guild.id}`);

        // Check if user is owner
        const ownerIds = process.env.OWNER_IDS?.split(',') || [];
        if (!ownerIds.includes(interaction.user.id)) {
            logger.info(`[DEBUG] Unauthorized user: ${interaction.user.id} not in ${ownerIds.join(',')}`);
            return interaction.reply({
                content: `${config.emojis.error} Cette commande est réservée aux administrateurs du bot.`,
                ephemeral: true
            });
        }

        // Check if we're in the right server
        if (interaction.guild.id !== SERVER_ID) {
            logger.info(`[DEBUG] Wrong server: ${interaction.guild.id} !== ${SERVER_ID}`);
            return interaction.reply({
                content: `${config.emojis.error} Cette commande ne fonctionne que dans le serveur configuré.`,
                ephemeral: true
            });
        }

        logger.info('[DEBUG] Deferring reply...');
        await interaction.deferReply({ ephemeral: true });
        logger.info('[DEBUG] Reply deferred');

        try {
            logger.info('[DEBUG] Starting command execution...');
            // Get the category
            logger.info(`[DEBUG] Looking for category ${CATEGORY_ID}`);
            const category = interaction.guild.channels.cache.get(CATEGORY_ID);
            logger.info(`[DEBUG] Category found: ${category ? 'Yes' : 'No'}, type: ${category?.type}`);

            if (!category || category.type !== 4) { // 4 = CategoryChannel
                return interaction.editReply({
                    content: `${config.emojis.error} Catégorie introuvable.`
                });
            }

            // Get all text channels in the category
            logger.info('[DEBUG] Getting text channels in category...');
            const textChannels = category.children.cache.filter(
                channel => channel.type === 0 && // 0 = TextChannel
                channel.permissionsFor(interaction.guild.members.me).has(['SendMessages', 'ViewChannel'])
            );

            logger.info(`[DEBUG] Found ${textChannels.size} accessible text channels`);

            if (textChannels.size === 0) {
                return interaction.editReply({
                    content: `${config.emojis.error} Aucun canal accessible dans cette catégorie.`
                });
            }

            // Choose a random channel first
            const channelArray = Array.from(textChannels.values());
            const randomChannel = channelArray[Math.floor(Math.random() * channelArray.length)];

            logger.info(`[DEBUG] Selected channel: ${randomChannel.name} (topic: ${randomChannel.topic || 'none'})`);

            // Get question history from Discord only (stateless)
            const discordHistory = await fetchExistingBotMessages(
                interaction.client,
                interaction.guild.id,
                CATEGORY_ID,
                100 // Fetch last 100 messages per channel to have better history
            );
            const fullHistory = discordHistory;

            logger.info(`[DEBUG] Total questions in history: ${fullHistory.length}`);

            // Generate question tailored to this channel
            logger.info('[DEBUG] Generating tech question for channel...');
            let question;
            try {
                question = await generateTechQuestion(
                    randomChannel.name,
                    randomChannel.topic,
                    fullHistory.map(h => h.question)
                );
                logger.info(`[DEBUG] Question generated: ${question.substring(0, 50)}...`);
            } catch (apiError) {
                logger.error('[CRITICAL] Failed to generate question:', apiError);
                logger.error('[CRITICAL] Aborting tech-discussion command');

                await interaction.editReply({
                    content: `${config.emojis.error} **Erreur critique:** Impossible de générer une question.\n\`\`\`${apiError.message}\`\`\`\nAucun message n'a été posté. Vérifiez les logs pour plus de détails.`
                });
                return; // Exit without posting anything
            }

            // Add to history only if generation succeeded
            addQuestionToHistory(question, randomChannel.name);

            // Create embed
            const embed = new EmbedBuilder()
                .setTitle('☁️ Discussion DevOps/Cloud du Jour')
                .setDescription(question)
                .setColor(config.colors.primary)
                .addFields({
                    name: '\u200B',
                    value: '👍 Question intéressante !\n🤔 Curieux de lire vos retours d\'expérience',
                    inline: false
                })
                .setFooter({
                    text: 'Partagez vos expériences DevOps et opinions!',
                    iconURL: interaction.client.user.displayAvatarURL()
                })
                .setTimestamp();

            // Send the message to the random channel
            logger.info(`[DEBUG] Sending message to ${randomChannel.name}...`);
            const sentMessage = await randomChannel.send({ embeds: [embed] });
            logger.info('[DEBUG] Message sent successfully');

            // Add reactions for engagement
            const reactions = ['👍', '🤔'];
            for (const reaction of reactions) {
                await sentMessage.react(reaction).catch(() => {});
            }

            // Confirm to the user
            await interaction.editReply({
                content: `${config.emojis.success} Question postée dans ${randomChannel}!\n\n**Question:** ${question}`,
            });

            logger.info(`Tech discussion posted in ${randomChannel.name} by ${interaction.user.tag}`);

        } catch (error) {
            logger.error('[DEBUG] Error in tech-discussion command:', error);
            logger.error('[DEBUG] Error stack:', error.stack);
            await interaction.editReply({
                content: `${config.emojis.error} Une erreur est survenue lors de la publication.`
            });
        }
    }
};