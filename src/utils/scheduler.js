import cron from 'node-cron';
import logger from './logger.js';
import { generateTechQuestion } from './openrouter.js';
import { fetchExistingBotMessages } from './questionHistory.js';
import { EmbedBuilder, AttachmentBuilder } from 'discord.js';
import config from '../config/config.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CATEGORY_ID = '1387175784862716115';
const SERVER_ID = '1387172171872211045';

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

    logger.info('[CRON] Scheduler initialized - Daily post at 13:00 and server tag reminder at 05:00 Paris time');

    return { techDiscussionTask, serverTagTask };
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

        // Generate question tailored to this channel
        const question = await generateTechQuestion(
            randomChannel.name,
            randomChannel.topic,
            discordHistory.map(h => h.question)
        );

        logger.info(`[CRON] Generated question: ${question.substring(0, 50)}...`);

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
                text: '💬 Question automatique quotidienne à 13h00',
                iconURL: client.user.displayAvatarURL()
            })
            .setTimestamp();

        // Send the message
        const sentMessage = await randomChannel.send({ embeds: [embed] });

        // Add reactions
        const reactions = ['👍', '🤔'];
        for (const reaction of reactions) {
            await sentMessage.react(reaction).catch(() => {});
        }

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