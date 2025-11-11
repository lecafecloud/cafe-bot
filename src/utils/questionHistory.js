import logger from './logger.js';

// Stateless - no file operations needed
export function getQuestionHistory() {
    // Always return empty array - we'll fetch from Discord instead
    return [];
}

export function addQuestionToHistory(question, channel) {
    // No-op - we don't save to file, Discord is our source of truth
    logger.info(`Question posted to Discord (${channel}): ${question.substring(0, 50)}...`);
}

export async function fetchExistingBotMessages(client, guildId, categoryId, limit = 50) {
    try {
        logger.info('Fetching existing bot messages from Discord...');
        const guild = client.guilds.cache.get(guildId);
        if (!guild) return [];

        const category = guild.channels.cache.get(categoryId);
        if (!category || category.type !== 4) return [];

        const questions = [];
        const textChannels = category.children.cache.filter(ch => ch.type === 0);

        for (const [, channel] of textChannels) {
            try {
                const messages = await channel.messages.fetch({ limit: limit });

                for (const [, message] of messages) {
                    // Check if message is from bot and contains the tech discussion embed
                    if (message.author.id === client.user.id &&
                        message.embeds.length > 0 &&
                        message.embeds[0].title?.includes('Discussion DevOps/Cloud du Jour')) {

                        // Extract just the question from the description
                        let question = message.embeds[0].description;
                        if (question) {
                            // Clean the question - remove emojis at the start if present
                            question = question.trim();

                            // Common patterns to clean:
                            // Remove leading emojis like 📦, 🔐, ☁️, etc.
                            question = question.replace(/^[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]+\s*/gu, '');

                            // Store the clean question
                            questions.push({
                                question: question,
                                channel: channel.name,
                                timestamp: message.createdAt.toISOString()
                            });

                            logger.info(`Found question: ${question.substring(0, 60)}...`);
                        }
                    }
                }
            } catch (error) {
                logger.error(`Error fetching messages from ${channel.name}:`, error);
            }
        }

        logger.info(`Found ${questions.length} existing discussion questions from Discord`);
        return questions;
    } catch (error) {
        logger.error('Error fetching bot messages:', error);
        return [];
    }
}

export function mergeHistories(fileHistory, discordHistory) {
    // Combine and deduplicate based on question text
    const allQuestions = [...fileHistory, ...discordHistory];
    const uniqueMap = new Map();

    for (const item of allQuestions) {
        // Use question text as key for deduplication
        uniqueMap.set(item.question, item);
    }

    return Array.from(uniqueMap.values());
}