import cron from 'node-cron';
import logger from './logger.js';
import { generateTechQuestion, filterQuestionsByChannel } from './openrouter.js';
import { fetchExistingBotMessages } from './questionHistory.js';
import { collectWeeklyMessages, collectWeeklyQuestions, generateWeeklyDigest } from './weeklyDigest.js';
import { EmbedBuilder, AttachmentBuilder } from 'discord.js';
import config from '../config/config.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CATEGORY_ID = '1387175784862716115';
const SERVER_ID = '1387172171872211045';
const DIGEST_CHANNEL_ID = '1387177709406519366';

export function initializeScheduler(client) {
    // Schedule daily post at 13:00 Paris time (Europe/Paris timezone)
    // Cron format: minute hour * * * (0 13 * * * = 13:00 every day)
    const techDiscussionTask = cron.schedule('0 13 * * *', async () => {
        logger.info('[CRON] Starting scheduled tech discussion post at 13:00 Paris time');

        try {
            await postScheduledDiscussion(client);
        } catch (error) {
            logger.error('[CRON] Failed to post scheduled discussion:', error);
        }
    }, {
        timezone: "Europe/Paris",
        scheduled: true
    });

    // Schedule server tag reminder at 05:00 Paris time
    const serverTagTask = cron.schedule('0 5 * * *', async () => {
        logger.info('[CRON] Starting scheduled server tag reminder at 05:00 Paris time');

        try {
            await postServerTagReminder(client);
        } catch (error) {
            logger.error('[CRON] Failed to post server tag reminder:', error);
        }
    }, {
        timezone: "Europe/Paris",
        scheduled: true
    });

    // Schedule weekly digest on Sunday at 12:00 Paris time
    const weeklyDigestTask = cron.schedule('0 12 * * 0', async () => {
        logger.info('[CRON] Starting weekly digest post at Sunday 12:00 Paris time');

        try {
            await postWeeklyDigest(client);
        } catch (error) {
            logger.error('[CRON] Failed to post weekly digest:', error);
        }
    }, {
        timezone: "Europe/Paris",
        scheduled: true
    });

    logger.info('[CRON] Scheduler initialized - Daily post at 13:00, server tag at 05:00, weekly digest Sunday 12:00 Paris time');

    return { techDiscussionTask, serverTagTask, weeklyDigestTask };
}

async function postScheduledDiscussion(client) {
    try {
        const guild = client.guilds.cache.get(SERVER_ID);
        if (!guild) {
            logger.error('[CRON] Server not found');
            return;
        }

        const category = guild.channels.cache.get(CATEGORY_ID);
        if (!category || category.type !== 4) {
            logger.error('[CRON] Category not found');
            return;
        }

        // Get all text channels in category
        const textChannels = category.children.cache.filter(
            channel => channel.type === 0 &&
            channel.permissionsFor(guild.members.me).has(['SendMessages', 'ViewChannel'])
        );

        if (textChannels.size === 0) {
            logger.error('[CRON] No accessible channels in category');
            return;
        }

        // Choose a random channel
        const channelArray = Array.from(textChannels.values());
        const randomChannel = channelArray[Math.floor(Math.random() * channelArray.length)];

        logger.info(`[CRON] Selected channel: ${randomChannel.name}`);

        // Get question history from Discord
        const discordHistory = await fetchExistingBotMessages(
            client,
            SERVER_ID,
            CATEGORY_ID,
            50
        );

        // Generate question tailored to this channel - only use history from this channel
        const channelHistory = filterQuestionsByChannel(discordHistory, randomChannel.name);
        const question = await generateTechQuestion(
            randomChannel.name,
            randomChannel.topic,
            channelHistory
        );

        logger.info(`[CRON] Generated question: ${question.substring(0, 50)}...`);

        // Create embed
        const embed = new EmbedBuilder()
            .setTitle('☁️ Discussion DevOps/Cloud du Jour')
            .setDescription(question)
            .setColor(config.colors.primary)
            .addFields({
                name: '\u200B',
                value: '⬆️ Question pertinente\n⬇️ Pas pertinent',
                inline: false
            })
            .setFooter({
                text: '💬 Question automatique quotidienne à 13h00',
                iconURL: client.user.displayAvatarURL()
            })
            .setTimestamp();

        // Send the message
        const sentMessage = await randomChannel.send({ embeds: [embed] });

        // Add upvote/downvote reactions
        await sentMessage.react('⬆️').catch(() => {});
        await sentMessage.react('⬇️').catch(() => {});

        logger.info(`[CRON] Successfully posted scheduled discussion in ${randomChannel.name}`);

    } catch (error) {
        logger.error('[CRON] Error in scheduled post:', error);
    }
}

async function postServerTagReminder(client) {
    try {
        const guild = client.guilds.cache.get(SERVER_ID);
        if (!guild) {
            logger.error('[CRON] Server not found for server tag reminder');
            return;
        }

        // Find a general or announcements channel to post in
        const targetChannel = guild.channels.cache.find(
            channel =>
                (channel.name.includes('général') ||
                 channel.name.includes('general') ||
                 channel.name.includes('annonces') ||
                 channel.name.includes('announcements')) &&
                channel.type === 0 &&
                channel.permissionsFor(guild.members.me).has(['SendMessages', 'ViewChannel'])
        );

        if (!targetChannel) {
            logger.error('[CRON] No suitable channel found for server tag reminder');
            return;
        }

        logger.info(`[CRON] Posting server tag reminder in ${targetChannel.name}`);

        // Create embed
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
                text: '☕ Rappel automatique quotidien à 05h00',
                iconURL: client.user.displayAvatarURL()
            })
            .setTimestamp();

        // Attach the tutorial image
        const imagePath = path.join(__dirname, '../../assets/images/server-tag-tutorial.png');
        const attachment = new AttachmentBuilder(imagePath, { name: 'server-tag-tutorial.png' });

        await targetChannel.send({
            embeds: [embed],
            files: [attachment]
        });

        logger.info(`[CRON] Successfully posted server tag reminder in ${targetChannel.name}`);

    } catch (error) {
        logger.error('[CRON] Error in server tag reminder post:', error);
    }
}

// Exporté pour utilisation par la commande /weekly-digest
export async function postWeeklyDigest(client) {
    try {
        const guild = client.guilds.cache.get(SERVER_ID);
        if (!guild) {
            logger.error('[DIGEST] Server not found');
            return { success: false, error: 'Server not found' };
        }

        const digestChannel = guild.channels.cache.get(DIGEST_CHANNEL_ID);
        if (!digestChannel) {
            logger.error('[DIGEST] Digest channel not found');
            return { success: false, error: 'Digest channel not found' };
        }

        logger.info('[DIGEST] Collecting weekly messages...');

        // Collecter les données de la semaine
        const messages = await collectWeeklyMessages(client, SERVER_ID, CATEGORY_ID, 7);
        const questions = await collectWeeklyQuestions(client, SERVER_ID, CATEGORY_ID, 7);

        if (messages.length === 0 && questions.length === 0) {
            logger.info('[DIGEST] No activity this week, skipping digest');
            return { success: false, error: 'No activity this week' };
        }

        logger.info(`[DIGEST] Found ${messages.length} messages and ${questions.length} questions`);

        // Générer le digest
        const digestContent = await generateWeeklyDigest(messages, questions);

        if (!digestContent) {
            logger.error('[DIGEST] Failed to generate digest content');
            return { success: false, error: 'Failed to generate digest' };
        }

        // Créer l'embed
        const embed = new EmbedBuilder()
            .setTitle('📊 Weekly Digest - Le Café Cloud')
            .setDescription(digestContent)
            .setColor(config.colors.primary)
            .setFooter({
                text: `Semaine du ${new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toLocaleDateString('fr-FR')} au ${new Date().toLocaleDateString('fr-FR')}`,
                iconURL: client.user.displayAvatarURL()
            })
            .setTimestamp();

        // Poster le digest
        await digestChannel.send({ embeds: [embed] });

        logger.info(`[DIGEST] Successfully posted weekly digest in ${digestChannel.name}`);
        return { success: true };

    } catch (error) {
        logger.error('[DIGEST] Error posting weekly digest:', error);
        return { success: false, error: error.message };
    }
}