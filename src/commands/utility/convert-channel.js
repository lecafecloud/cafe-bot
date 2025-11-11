import { SlashCommandBuilder, ChannelType, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import config from '../../config/config.js';
import logger from '../../utils/logger.js';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

export default {
    data: new SlashCommandBuilder()
        .setName('convert-channel')
        .setDescription('Convertit un canal texte en forum avec l\'aide de GPT-5')
        .addIntegerOption(option =>
            option.setName('messages')
                .setDescription('Nombre de messages à analyser (max 500)')
                .setRequired(false)
                .setMinValue(50)
                .setMaxValue(500))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
        .setDMPermission(false),

    category: 'utility',
    cooldown: 30,

    async execute(interaction) {
        // Check if user is owner
        const ownerIds = process.env.OWNER_IDS?.split(',') || [];
        if (!ownerIds.includes(interaction.user.id)) {
            return interaction.reply({
                content: `${config.emojis.error} Cette commande est réservée aux administrateurs du bot.`,
                ephemeral: true
            });
        }

        // Check if we're in a text channel
        if (interaction.channel.type !== ChannelType.GuildText) {
            return interaction.reply({
                content: `${config.emojis.error} Cette commande ne fonctionne que dans les canaux texte.`,
                ephemeral: true
            });
        }

        const messageCount = interaction.options.getInteger('messages') || 500;  // Default to 500 for presentations

        await interaction.reply({
            content: `${config.emojis.loading} Analyse de ${messageCount} messages et création du forum...`,
            ephemeral: true
        });

        try {
            logger.info(`[CONVERT] Starting channel conversion for #${interaction.channel.name}`);

            // Fetch messages from the channel
            const messages = await fetchAllMessages(interaction.channel, messageCount);
            logger.info(`[CONVERT] Fetched ${messages.length} messages`);

            // Group messages into conversations using AI
            const conversations = await analyzeAndGroupMessages(messages, interaction.channel.name, interaction.channel.topic);
            logger.info(`[CONVERT] AI identified ${conversations.length} conversation threads`);

            // Create the forum channel with same name and description
            const forumChannel = await interaction.guild.channels.create({
                name: interaction.channel.name,  // Exact same name
                type: ChannelType.GuildForum,
                parent: interaction.channel.parent,
                permissionOverwrites: interaction.channel.permissionOverwrites.cache,
                topic: interaction.channel.topic,  // Inherit exact description
                reason: `Conversion du canal par ${interaction.user.tag}`,
                defaultAutoArchiveDuration: 1440, // 1 day
                defaultReactionEmoji: { name: '💬' }
            });

            logger.info(`[CONVERT] Created forum channel: #${forumChannel.name}`);

            // Check if we have valid conversations
            if (!conversations || conversations.length === 0) {
                logger.error('[CONVERT] No valid conversations identified');
                await interaction.followUp({
                    content: `${config.emojis.error} Aucune conversation valide identifiée. Vérifiez que le canal contient des messages appropriés pour la conversion.`,
                    ephemeral: true
                });

                // Delete the empty forum channel
                await forumChannel.delete('No conversations to convert');
                return;
            }

            // Create posts from conversations
            let postsCreated = 0;
            const errors = [];

            for (const conversation of conversations) {
                try {
                    if (conversation.messages.length === 0) continue;

                    // Format the initial message for the post
                    const firstMessage = formatFirstMessage(conversation);

                    // Create the forum post/thread
                    const thread = await forumChannel.threads.create({
                        name: conversation.title.substring(0, 100), // Discord limit
                        message: {
                            content: firstMessage
                        },
                        autoArchiveDuration: 1440
                    });

                    // Add subsequent messages as replies in the thread
                    for (let i = 1; i < conversation.messages.length; i++) {
                        const msg = conversation.messages[i];
                        const replyContent = formatReplyMessage(msg);

                        if (replyContent && replyContent.trim().length > 0) {
                            await thread.send({
                                content: replyContent.substring(0, 2000)
                            });

                            // Small delay between messages
                            await new Promise(resolve => setTimeout(resolve, 500));
                        }
                    }

                    postsCreated++;
                    logger.info(`[CONVERT] Created post: ${conversation.title} with ${conversation.messages.length} messages`);

                    // Add a delay to avoid rate limits
                    await new Promise(resolve => setTimeout(resolve, 1000));

                } catch (error) {
                    logger.error(`[CONVERT] Failed to create post: ${error.message}`);
                    errors.push(`Post "${conversation.title}": ${error.message}`);
                }
            }

            // Send summary
            const summaryEmbed = new EmbedBuilder()
                .setTitle('✅ Conversion terminée')
                .setDescription(`Canal converti avec succès en forum`)
                .addFields(
                    { name: 'Canal source', value: `<#${interaction.channel.id}>`, inline: true },
                    { name: 'Forum créé', value: `<#${forumChannel.id}>`, inline: true },
                    { name: 'Messages analysés', value: `${messages.length}`, inline: true },
                    { name: 'Posts créés', value: `${postsCreated}/${conversations.length}`, inline: true }
                )
                .setColor(config.colors.success)
                .setTimestamp();

            if (errors.length > 0) {
                summaryEmbed.addFields({
                    name: '⚠️ Erreurs',
                    value: errors.slice(0, 5).join('\n').substring(0, 1000)
                });
            }

            await interaction.followUp({
                embeds: [summaryEmbed],
                ephemeral: true
            });

        } catch (error) {
            logger.error('[CONVERT] Conversion failed:', error);
            await interaction.followUp({
                content: `${config.emojis.error} Erreur lors de la conversion: ${error.message}`,
                ephemeral: true
            });
        }
    }
};

async function fetchAllMessages(channel, limit = 100) {
    const messages = [];
    let lastId;

    while (messages.length < limit) {
        const options = { limit: Math.min(100, limit - messages.length) };
        if (lastId) options.before = lastId;

        const batch = await channel.messages.fetch(options);
        if (batch.size === 0) break;

        messages.push(...batch.values());
        lastId = batch.last().id;
    }

    return messages.reverse(); // Return in chronological order
}

async function analyzeAndGroupMessages(messages, channelName, channelDescription) {
    // Format messages for AI analysis
    const messageData = messages.map((msg, index) => ({
        id: index,
        author: msg.author.username,
        content: msg.content || '[Embed/Media]',
        timestamp: msg.createdAt.toISOString(),
        isBot: msg.author.bot,
        replyTo: msg.reference ? messages.findIndex(m => m.id === msg.reference.messageId) : null
    }));

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout

    try {
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
                model: 'openai/gpt-4-turbo-preview', // Using GPT-4 for reliability
                messages: [
                    {
                        role: 'system',
                        content: `CANAL PRÉSENTATION = CHAQUE MESSAGE EST UNE PRÉSENTATION POTENTIELLE

RÈGLE ABSOLUE: CRÉE UN POST POUR CHAQUE PERSONNE UNIQUE

CRITÈRES (UN SEUL SUFFIT):
- Quelqu'un dit son prénom/pseudo
- Quelqu'un parle de lui-même
- "Salut", "Bonjour", "Hello" + infos personnelles
- Pseudo Discord seul (si c'est sa première apparition)
- MêME INCOMPLÈTE = CRÉE UN POST
- MêME SANS NOM RÉEL = CRÉE UN POST
- MêME TRÈS COURTE = CRÉE UN POST

TITRES:
- Si prénom connu: "Présentation [Prénom]"
- Si pseudo seulement: "Présentation [Pseudo Discord]"
- Si anonyme: "Présentation Membre [numéro]"

EXEMPLES DE PRÉSENTATIONS VALIDES:
- "Salut je suis dev" = Post "Présentation [Pseudo]"
- "Dev python depuis 5 ans" = Post "Présentation [Pseudo]"
- "Je suis dans l'IT" = Post "Présentation [Pseudo]"
- "Bonjour Fred 48 ans" = Post "Présentation Fred"
- Message avec infos personnelles = Post

RÈGLE D'OR: EN CAS DE DOUTE, CRÉE UN POST.
100+ POSTS EST NORMAL DANS UN CANAL PRÉSENTATION.

JSON:
{
  "conversations": [
    {
      "title": "Présentation [Nom/Pseudo]",
      "messageIds": [indices],
      "summary": "prés",
      "importance": "high",
      "shouldConvert": true
    }
  ]
}

CRÉE UN POST PAR PERSONNE UNIQUE. AUCUNE EXCEPTION.
JSON UNIQUEMENT.`
                    },
                    {
                        role: 'user',
                        content: `Canal: "${channelName}"\nDescription: "${channelDescription || 'Aucune'}"\n\nANALYSE TOUS LES ${messages.length} MESSAGES:\n\n${JSON.stringify(messageData, null, 2)}\n\nCHAQUE PERSONNE UNIQUE = 1 POST OBLIGATOIRE.\nMÊME LES PRÉSENTATIONS INCOMPLÈTES.\nRETOURNE LE JSON AVEC TOUS LES POSTS.`
                    }
                ],
                temperature: 0.1,  // Lower temperature for more consistent JSON
                max_tokens: 16000  // Maximum tokens for handling many presentations
            })
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }

        const data = await response.json();
        const aiResponse = data.choices[0].message.content;

        logger.info('[CONVERT] AI analysis complete');

        // Parse AI response
        let analysis;
        try {
            // Clean the response before parsing
            let cleanedResponse = aiResponse.trim();

            // Remove any markdown code blocks
            cleanedResponse = cleanedResponse.replace(/```json\n?/gi, '').replace(/```\n?/gi, '');

            // Remove any text before the first {
            const jsonStart = cleanedResponse.indexOf('{');
            if (jsonStart > 0) {
                cleanedResponse = cleanedResponse.substring(jsonStart);
            }

            // Remove any text after the last }
            const jsonEnd = cleanedResponse.lastIndexOf('}');
            if (jsonEnd > -1 && jsonEnd < cleanedResponse.length - 1) {
                cleanedResponse = cleanedResponse.substring(0, jsonEnd + 1);
            }

            analysis = JSON.parse(cleanedResponse);
        } catch (parseError) {
            logger.error('[CONVERT] Failed to parse AI response:', parseError);
            logger.error('[CONVERT] Raw response was:', aiResponse?.substring(0, 500));

            // Try to extract any valid JSON from the response
            const jsonRegex = /{[\s\S]*"conversations"[\s\S]*}/;
            const match = aiResponse?.match(jsonRegex);

            if (match) {
                try {
                    analysis = JSON.parse(match[0]);
                    logger.info('[CONVERT] Recovered JSON from response');
                } catch (e) {
                    throw new Error('Unable to parse AI response as JSON');
                }
            } else {
                throw new Error('No valid JSON structure found in AI response');
            }
        }

        // Build conversation objects with actual messages
        const conversations = [];
        for (const conv of analysis.conversations || []) {
            if (!conv.shouldConvert) continue;

            const conversationMessages = conv.messageIds
                .filter(id => id < messages.length)
                .map(id => messages[id])
                .filter(msg => msg); // Remove undefined

            if (conversationMessages.length > 0) {
                conversations.push({
                    title: conv.title || 'Discussion sans titre',
                    summary: conv.summary,
                    importance: conv.importance,
                    messages: conversationMessages
                });
            }
        }

        logger.info(`[CONVERT] Built ${conversations.length} conversation objects from ${analysis.conversations?.length || 0} AI results`);

        return conversations;

    } catch (error) {
        logger.error('[CONVERT] AI analysis failed:', error);
        // Don't create any fallback - just throw the error
        throw new Error(`Impossible d'analyser les messages: ${error.message}`);
    }
}

function formatFirstMessage(conversation) {
    // Use the first message as the main post content
    const firstMsg = conversation.messages[0];
    if (!firstMsg) return 'Discussion';

    const timestamp = firstMsg.createdAt.toLocaleString('fr-FR');
    let content = firstMsg.content || '[Embed/Media]';

    // Escape mentions to prevent pings
    content = escapeMentions(content);

    // Just the original message, no AI summary
    const formattedContent = `**${firstMsg.author.username}** • ${timestamp}\n\n${content}`;

    return formattedContent.substring(0, 2000);
}

function formatReplyMessage(msg) {
    const timestamp = msg.createdAt.toLocaleString('fr-FR');
    let content = msg.content || '[Embed/Media]';

    // Escape mentions to prevent pings
    content = escapeMentions(content);

    return `**${msg.author.username}** • ${timestamp}\n${content}`;
}

function escapeMentions(content) {
    if (!content) return content;

    // Escape user mentions @username -> @\u200busername
    content = content.replace(/<@!?(\d+)>/g, (match, userId) => {
        return `@\u200buser`; // Zero-width space after @
    });

    // Escape role mentions
    content = content.replace(/<@&(\d+)>/g, '@\u200brole');

    // Escape @everyone and @here
    content = content.replace(/@(everyone|here)/gi, '@\u200b$1');

    // Escape channel mentions (keep them clickable but no notification)
    // Channel mentions don't ping so we can keep them as is

    return content;
}