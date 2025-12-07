import logger from './logger.js';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Collecte les messages techniques de la semaine
export async function collectWeeklyMessages(client, guildId, categoryId, days = 7) {
    try {
        const guild = client.guilds.cache.get(guildId);
        if (!guild) return [];

        const category = guild.channels.cache.get(categoryId);
        if (!category || category.type !== 4) return [];

        const oneWeekAgo = Date.now() - (days * 24 * 60 * 60 * 1000);
        const messages = [];
        const textChannels = category.children.cache.filter(ch => ch.type === 0);

        for (const [, channel] of textChannels) {
            try {
                const channelMessages = await channel.messages.fetch({ limit: 100 });

                for (const [, message] of channelMessages) {
                    // Skip bot messages and old messages
                    if (message.author.bot) continue;
                    if (message.createdTimestamp < oneWeekAgo) continue;

                    // Only include messages with some content
                    if (message.content.length < 20) continue;

                    // Count reactions as engagement indicator
                    const reactionCount = message.reactions.cache.reduce((acc, r) => acc + r.count, 0);

                    messages.push({
                        content: message.content.substring(0, 500),
                        author: message.author.displayName || message.author.username,
                        channel: channel.name,
                        reactions: reactionCount,
                        replies: message.reference ? 1 : 0,
                        timestamp: message.createdTimestamp
                    });
                }
            } catch (error) {
                logger.error(`Error fetching messages from ${channel.name}:`, error);
            }
        }

        // Sort by engagement (reactions)
        messages.sort((a, b) => b.reactions - a.reactions);

        logger.info(`Collected ${messages.length} messages from the last ${days} days`);
        return messages;
    } catch (error) {
        logger.error('Error collecting weekly messages:', error);
        return [];
    }
}

// Collecte les questions du bot avec leurs scores
export async function collectWeeklyQuestions(client, guildId, categoryId, days = 7) {
    try {
        const guild = client.guilds.cache.get(guildId);
        if (!guild) return [];

        const category = guild.channels.cache.get(categoryId);
        if (!category || category.type !== 4) return [];

        const oneWeekAgo = Date.now() - (days * 24 * 60 * 60 * 1000);
        const questions = [];
        const textChannels = category.children.cache.filter(ch => ch.type === 0);

        for (const [, channel] of textChannels) {
            try {
                const messages = await channel.messages.fetch({ limit: 50 });

                for (const [, message] of messages) {
                    if (message.author.id !== client.user.id) continue;
                    if (message.createdTimestamp < oneWeekAgo) continue;
                    if (!message.embeds.length) continue;
                    if (!message.embeds[0].title?.includes('Discussion DevOps/Cloud du Jour')) continue;

                    const upvotes = message.reactions.cache.get('⬆️')?.count || 0;
                    const downvotes = message.reactions.cache.get('⬇️')?.count || 0;
                    const score = (upvotes > 0 ? upvotes - 1 : 0) - (downvotes > 0 ? downvotes - 1 : 0);

                    questions.push({
                        question: message.embeds[0].description,
                        channel: channel.name,
                        score: score,
                        timestamp: message.createdTimestamp
                    });
                }
            } catch (error) {
                logger.error(`Error fetching questions from ${channel.name}:`, error);
            }
        }

        // Sort by score
        questions.sort((a, b) => b.score - a.score);

        logger.info(`Collected ${questions.length} bot questions from the last ${days} days`);
        return questions;
    } catch (error) {
        logger.error('Error collecting weekly questions:', error);
        return [];
    }
}

// Génère le digest via AI
export async function generateWeeklyDigest(messages, questions) {
    if (messages.length === 0 && questions.length === 0) {
        return null;
    }

    // Préparer le contexte pour l'AI - focus sur le contenu technique
    const topMessages = messages.slice(0, 20).map(m =>
        `[${m.channel}] "${m.content}"`
    ).join('\n');

    const topQuestions = questions.slice(0, 5).map(q =>
        `"${q.question}" (score: ${q.score > 0 ? '+' : ''}${q.score})`
    ).join('\n');

    const systemPrompt = `Weekly digest technique pour Discord. Sois CONCIS et LISIBLE.

FORMAT EXACT:
☕ **Points clés de la semaine**

• **[Techno/Outil]** → conseil ou insight en 1 ligne
• **[Techno/Outil]** → conseil ou insight en 1 ligne
• **[Techno/Outil]** → conseil ou insight en 1 ligne

🏆 Question populaire: *"[question]"*

Merci à **[pseudo1]**, **[pseudo2]**, **[pseudo3]**!

RÈGLES:
- MAX 400 caractères
- Mets en **gras** les technos/outils importants
- 3 bullet points MAX
- Pas de blabla, que du concret
- Extrais la valeur technique, pas "X a dit"`;

    // Extraire les contributeurs uniques
    const contributors = [...new Set(messages.map(m => m.author))].slice(0, 5);

    const userPrompt = `Discussions techniques de la semaine:
${topMessages || 'Aucune activité'}

Questions les plus populaires:
${topQuestions || 'Aucune question'}

Contributeurs à remercier: ${contributors.join(', ') || 'Aucun'}

Génère un digest INSTRUCTIF qui synthétise les apprentissages clés.`;

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        const response = await fetch(OPENROUTER_API_URL, {
            signal: controller.signal,
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://github.com/cafe-bot',
                'X-Title': 'Cafe Bot Discord'
            },
            body: JSON.stringify({
                model: 'openai/gpt-4-turbo-preview',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                temperature: 0.7,
                max_tokens: 300
            })
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`OpenRouter API error: ${response.status}`);
        }

        const data = await response.json();
        const digest = data.choices[0].message.content.trim();

        logger.info('Weekly digest generated successfully');
        return digest;
    } catch (error) {
        logger.error('Failed to generate weekly digest:', error);
        throw error;
    }
}
