import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import config from '../../config/config.js';
import { generateTechQuestion, filterQuestionsByChannel } from '../../utils/openrouter.js';
import logger from '../../utils/logger.js';
import { addQuestionToHistory, fetchExistingBotMessages } from '../../utils/questionHistory.js';

const CATEGORY_ID = '1387175784862716115';
const SERVER_ID = '1387172171872211045';

let autoPostInterval = null;

export default {
    data: new SlashCommandBuilder()
        .setName('auto-discussion')
        .setDescription('Configure les discussions tech automatiques')
        .addSubcommand(subcommand =>
            subcommand.setName('start')
                .setDescription('Démarre les posts automatiques')
                .addIntegerOption(option =>
                    option.setName('heures')
                        .setDescription('Intervalle en heures (1-24)')
                        .setRequired(true)
                        .setMinValue(1)
                        .setMaxValue(24)))
        .addSubcommand(subcommand =>
            subcommand.setName('stop')
                .setDescription('Arrête les posts automatiques'))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .setDMPermission(false),

    category: 'fun',
    cooldown: 10,

    async execute(interaction) {
        // Check if user is owner
        const ownerIds = process.env.OWNER_IDS?.split(',') || [];
        if (!ownerIds.includes(interaction.user.id)) {
            return interaction.reply({
                content: `${config.emojis.error} Cette commande est réservée aux administrateurs du bot.`,
                ephemeral: true
            });
        }

        if (interaction.guild.id !== SERVER_ID) {
            return interaction.reply({
                content: `${config.emojis.error} Cette commande ne fonctionne que dans le serveur configuré.`,
                ephemeral: true
            });
        }

        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'start') {
            const hours = interaction.options.getInteger('heures');
            const milliseconds = hours * 60 * 60 * 1000;

            // Clear existing interval if any
            if (autoPostInterval) {
                clearInterval(autoPostInterval);
            }

            // Post immediately
            await postDiscussion(interaction.client, interaction.guild);

            // Set up recurring posts
            autoPostInterval = setInterval(async () => {
                await postDiscussion(interaction.client, interaction.guild);
            }, milliseconds);

            await interaction.reply({
                content: `${config.emojis.success} Posts automatiques activés toutes les ${hours} heures.`,
                ephemeral: true
            });

            logger.info(`Auto-discussion started with ${hours} hour interval`);

        } else if (subcommand === 'stop') {
            if (autoPostInterval) {
                clearInterval(autoPostInterval);
                autoPostInterval = null;

                await interaction.reply({
                    content: `${config.emojis.success} Posts automatiques désactivés.`,
                    ephemeral: true
                });

                logger.info('Auto-discussion stopped');
            } else {
                await interaction.reply({
                    content: `${config.emojis.info} Les posts automatiques ne sont pas actifs.`,
                    ephemeral: true
                });
            }
        }
    }
};

async function postDiscussion(client, guild) {
    try {
        const category = guild.channels.cache.get(CATEGORY_ID);

        if (!category || category.type !== 4) {
            logger.warn('Category not found for auto-discussion');
            return;
        }

        const textChannels = category.children.cache.filter(
            channel => channel.type === 0 &&
            channel.permissionsFor(guild.members.me).has(['SendMessages', 'ViewChannel'])
        );

        if (textChannels.size === 0) {
            logger.warn('No accessible channels in category for auto-discussion');
            return;
        }

        // Choose a random channel first
        const channelArray = Array.from(textChannels.values());
        const randomChannel = channelArray[Math.floor(Math.random() * channelArray.length)];

        logger.info(`Auto-discussion: Selected channel ${randomChannel.name}`);

        // Get question history from Discord only (stateless)
        const discordHistory = await fetchExistingBotMessages(
            client,
            guild.id,
            CATEGORY_ID,
            100 // Fetch last 100 messages per channel to have better history
        );
        const fullHistory = discordHistory;

        // Generate question tailored to this channel - only use history from this channel
        const channelHistory = filterQuestionsByChannel(fullHistory, randomChannel.name);

        let question;
        try {
            question = await generateTechQuestion(
                randomChannel.name,
                randomChannel.topic,
                channelHistory
            );
        } catch (error) {
            logger.error('[CRITICAL] Auto-discussion failed to generate question:', error);
            logger.error('[CRITICAL] Skipping this auto-discussion cycle');
            return; // Exit without posting anything
        }

        // Save to history only if generation succeeded
        addQuestionToHistory(question, randomChannel.name);

        const embed = {
            title: '☁️ Discussion DevOps/Cloud du Jour',
            description: question,
            color: config.colors.primary,
            fields: [{
                name: '\u200B',
                value: '⬆️ Question pertinente\n⬇️ Pas pertinent',
                inline: false
            }],
            footer: {
                text: 'Partagez vos expériences DevOps et opinions!',
                icon_url: client.user.displayAvatarURL()
            },
            timestamp: new Date().toISOString()
        };

        const sentMessage = await randomChannel.send({ embeds: [embed] });

        // Add upvote/downvote reactions
        await sentMessage.react('⬆️').catch(() => {});
        await sentMessage.react('⬇️').catch(() => {});

        logger.info(`Auto-discussion posted in ${randomChannel.name}`);

    } catch (error) {
        logger.error('Error in auto-discussion post:', error);
    }
}