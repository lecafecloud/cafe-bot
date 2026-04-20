import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, AttachmentBuilder } from 'discord.js';
import config from '../../config/config.js';
import logger from '../../utils/logger.js';

/**
 * Archive messages to moderation log channel and/or as attachment
 * @param {Interaction} interaction
 * @param {Array} messages - All fetched messages
 * @param {Array} toDelete - Messages flagged for deletion
 * @param {number} hours - Hours analyzed
 * @returns {Promise<string|null>} - URL of the archive message or null
 */
async function archiveMessages(interaction, messages, toDelete, hours) {
    const archive = {
        meta: {
            channel: interaction.channel.name,
            channelId: interaction.channel.id,
            guild: interaction.guild.name,
            guildId: interaction.guild.id,
            executedBy: interaction.user.tag,
            executedById: interaction.user.id,
            timestamp: new Date().toISOString(),
            hoursAnalyzed: hours,
            totalMessages: messages.length,
            deletedCount: toDelete.length
        },
        deletedMessages: toDelete.map(m => ({
            id: m.id,
            author: m.author,
            content: m.content,
            reason: m.reason,
            timestamp: new Date(messages.find(msg => msg.id === m.id)?.timestamp || Date.now()).toISOString()
        }))
    };

    const jsonContent = JSON.stringify(archive, null, 2);
    const buffer = Buffer.from(jsonContent, 'utf-8');
    const filename = `nuke-archive-${interaction.channel.name}-${Date.now()}.json`;

    const attachment = new AttachmentBuilder(buffer, { name: filename });

    // Try to send to moderation log channel
    let archiveUrl = null;
    if (config.moderationLogChannelId) {
        try {
            const modChannel = await interaction.guild.channels.fetch(config.moderationLogChannelId);
            if (modChannel) {
                const archiveEmbed = new EmbedBuilder()
                    .setTitle('📦 Archive Nuke')
                    .setColor(config.colors.info)
                    .setDescription(`Archive des messages supprimés par \`/nuke\``)
                    .addFields(
                        { name: 'Canal', value: `${interaction.channel}`, inline: true },
                        { name: 'Exécuté par', value: `${interaction.user}`, inline: true },
                        { name: 'Période', value: `${hours}h`, inline: true },
                        { name: 'Messages supprimés', value: `${toDelete.length}`, inline: true },
                        { name: 'Total analysé', value: `${messages.length}`, inline: true }
                    )
                    .setTimestamp();

                const archiveMsg = await modChannel.send({
                    embeds: [archiveEmbed],
                    files: [attachment]
                });
                archiveUrl = archiveMsg.url;
                logger.info(`[NUKE] Archive sent to moderation log: ${archiveUrl}`);
            }
        } catch (error) {
            logger.error('[NUKE] Failed to send archive to mod channel:', error);
        }
    }

    return { attachment, archiveUrl };
}

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * Analyze messages in batch to detect conflict/dispute messages
 * @param {Array} messages - Array of message objects { id, content, author, timestamp }
 * @returns {Promise<Array>} - Array of { id, shouldDelete, reason }
 */
async function analyzeMessagesForConflict(messages) {
    if (!process.env.OPENROUTER_API_KEY) {
        logger.warn('[NUKE] No OpenRouter API key, cannot analyze messages');
        return messages.map(m => ({ id: m.id, shouldDelete: false, reason: 'Pas d\'API IA disponible' }));
    }

    // Format messages for analysis
    const messagesText = messages.map((m, i) =>
        `[${i}] ${m.author}: ${m.content.substring(0, 200)}${m.content.length > 200 ? '...' : ''}`
    ).join('\n');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 second timeout for batch

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
                model: 'openai/gpt-5.2',
                messages: [
                    {
                        role: 'system',
                        content: `Tu es un modérateur Discord. Analyse ces messages et identifie TOUS les messages qui font partie d'une dispute/embrouille ou qui y font référence.

CRITÈRES DE SUPPRESSION - Supprimer si:
- Insultes directes ou indirectes
- Attaques personnelles
- Messages agressifs ou provocateurs
- Messages qui RÉPONDENT à une dispute (même si neutres, ils font partie du conflit)
- Messages qui ALIMENTENT la dispute (même sans insulte directe)
- Messages de provocation ou de troll
- Messages qui prennent parti dans le conflit
- Moqueries méchantes
- Messages toxiques ou dénigrants
- Harcèlement
- Messages "calme-toi", "arrêtez" etc. qui font partie du fil de dispute
- Messages qui MENTIONNENT l'embrouille après coup ("vous avez vu la dispute", "ils se sont embrouillés", "c'était chaud", "ça a clashé", etc.)
- Messages qui commentent le conflit ("lol la bagarre", "wtf il s'est passé quoi", "j'ai raté quoi")
- Messages qui relancent le sujet de la dispute
- Screenshots ou références à la dispute

IMPORTANT: Si tu détectes une embrouille, supprime TOUT le fil de discussion lié + toutes les mentions/références à cette embrouille. L'objectif est de nettoyer complètement comme si rien ne s'était passé.

À GARDER (ne pas flaguer):
- Débats techniques même vifs mais respectueux (pas de tensions personnelles)
- Désaccords constructifs sans animosité
- Blagues amicales entre membres
- Questions/réponses normales SANS LIEN avec une dispute
- Messages informatifs

Réponds UNIQUEMENT avec un JSON array des indices à supprimer:
{"delete": [0, 3, 5], "reasons": {"0": "insulte", "3": "réponse au conflit", "5": "mentionne la dispute"}}

Si aucun message à supprimer: {"delete": [], "reasons": {}}`
                    },
                    {
                        role: 'user',
                        content: `Messages à analyser:\n\n${messagesText}`
                    }
                ],
                temperature: 0.2,
                max_tokens: 500
            })
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content?.trim();

        if (!content) {
            throw new Error('Empty response from API');
        }

        // Parse JSON response
        let result;
        try {
            // Extract JSON from response (might have extra text)
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                result = JSON.parse(jsonMatch[0]);
            } else {
                throw new Error('No JSON found in response');
            }
        } catch (parseError) {
            logger.error('[NUKE] Failed to parse AI response:', content);
            return messages.map(m => ({ id: m.id, shouldDelete: false, reason: 'Erreur parsing' }));
        }

        // Map results back to messages
        return messages.map((m, i) => ({
            id: m.id,
            content: m.content,
            author: m.author,
            shouldDelete: result.delete?.includes(i) || false,
            reason: result.reasons?.[i.toString()] || null
        }));

    } catch (error) {
        clearTimeout(timeoutId);
        logger.error('[NUKE] Error analyzing messages:', error);
        return messages.map(m => ({ id: m.id, shouldDelete: false, reason: 'Erreur analyse' }));
    }
}

/**
 * Fetch all messages from the last X hours
 */
async function fetchMessagesFromLastHours(channel, hours) {
    const messages = [];
    const cutoffTime = Date.now() - (hours * 60 * 60 * 1000);
    let lastMessageId = null;
    let iterations = 0;
    const maxIterations = 50; // Safety limit

    while (iterations < maxIterations) {
        iterations++;
        const options = { limit: 100 };
        if (lastMessageId) {
            options.before = lastMessageId;
        }

        const fetchedMessages = await channel.messages.fetch(options);

        if (fetchedMessages.size === 0) break;

        for (const msg of fetchedMessages.values()) {
            if (msg.createdTimestamp < cutoffTime) {
                // Reached messages older than cutoff
                return messages;
            }
            if (!msg.author.bot) { // Skip bot messages
                messages.push({
                    id: msg.id,
                    content: msg.content,
                    author: msg.author.username,
                    authorId: msg.author.id,
                    timestamp: msg.createdTimestamp
                });
            }
            lastMessageId = msg.id;
        }

        // If we got less than 100, we've reached the beginning
        if (fetchedMessages.size < 100) break;
    }

    return messages;
}

export default {
    data: new SlashCommandBuilder()
        .setName('nuke')
        .setDescription('🔥 Analyse et supprime les messages de dispute/embrouille')
        .addIntegerOption(option =>
            option.setName('heures')
                .setDescription('Nombre d\'heures à analyser (défaut: 12)')
                .setMinValue(1)
                .setMaxValue(72)
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    category: 'utility',
    cooldown: 60, // 1 minute cooldown

    async execute(interaction, client) {
        const hours = interaction.options.getInteger('heures') || 12;

        // Check permissions
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
            return interaction.reply({
                content: '❌ Tu n\'as pas la permission de gérer les messages.',
                ephemeral: true
            });
        }

        // Check bot permissions
        const botMember = interaction.guild.members.cache.get(client.user.id);
        if (!botMember.permissions.has(PermissionFlagsBits.ManageMessages)) {
            return interaction.reply({
                content: '❌ Je n\'ai pas la permission de supprimer les messages.',
                ephemeral: true
            });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            // Fetch messages from last X hours
            await interaction.editReply({
                content: `🔍 Récupération des messages des ${hours} dernières heures...`
            });

            const messages = await fetchMessagesFromLastHours(interaction.channel, hours);

            if (messages.length === 0) {
                return interaction.editReply({
                    content: `✅ Aucun message trouvé dans les ${hours} dernières heures.`
                });
            }

            await interaction.editReply({
                content: `🤖 Analyse de ${messages.length} messages avec l'IA...`
            });

            // Analyze messages in batches of 30
            const batchSize = 30;
            const allResults = [];

            for (let i = 0; i < messages.length; i += batchSize) {
                const batch = messages.slice(i, i + batchSize);
                const results = await analyzeMessagesForConflict(batch);
                allResults.push(...results);

                // Update progress
                const progress = Math.min(i + batchSize, messages.length);
                await interaction.editReply({
                    content: `🤖 Analyse en cours... ${progress}/${messages.length} messages`
                });
            }

            // Filter messages to delete
            const toDelete = allResults.filter(r => r.shouldDelete);

            if (toDelete.length === 0) {
                return interaction.editReply({
                    content: `✅ Aucun message de dispute/embrouille détecté dans les ${hours} dernières heures (${messages.length} messages analysés).`
                });
            }

            // Build confirmation embed
            const embed = new EmbedBuilder()
                .setTitle('🔥 Nuke - Confirmation')
                .setColor(config.colors.warning || 0xFFA500)
                .setDescription(`**${toDelete.length}** messages de dispute/embrouille détectés sur ${messages.length} analysés.\n\n📎 **Voir le fichier joint pour la liste complète.**`)
                .addFields(
                    {
                        name: '📊 Résumé',
                        value: `• Canal: ${interaction.channel}\n• Période: ${hours}h\n• À supprimer: ${toDelete.length}`,
                        inline: false
                    }
                )
                .setFooter({ text: 'Cette action est irréversible ! Vérifie le fichier avant de confirmer.' })
                .setTimestamp();

            // Create a text file with ALL messages to delete
            const previewContent = toDelete.map((m, i) => {
                const msgData = messages.find(msg => msg.id === m.id);
                const time = msgData ? new Date(msgData.timestamp).toLocaleString('fr-FR') : 'N/A';
                return `[${i + 1}] ${time}\n👤 ${m.author}\n💬 ${m.content}\n🏷️ Raison: ${m.reason}\n${'─'.repeat(50)}`;
            }).join('\n\n');

            const previewBuffer = Buffer.from(previewContent, 'utf-8');
            const previewAttachment = new AttachmentBuilder(previewBuffer, {
                name: `nuke-preview-${toDelete.length}-messages.txt`
            });

            // Create buttons
            const confirmId = `nuke_confirm_${interaction.id}`;
            const cancelId = `nuke_cancel_${interaction.id}`;

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(confirmId)
                        .setLabel(`🔥 Supprimer ${toDelete.length} messages`)
                        .setStyle(ButtonStyle.Danger),
                    new ButtonBuilder()
                        .setCustomId(cancelId)
                        .setLabel('❌ Annuler')
                        .setStyle(ButtonStyle.Secondary)
                );

            const response = await interaction.editReply({
                content: null,
                embeds: [embed],
                components: [row],
                files: [previewAttachment]
            });

            // Store message IDs for deletion
            const messageIdsToDelete = toDelete.map(m => m.id);

            // Wait for button interaction
            try {
                const buttonInteraction = await response.awaitMessageComponent({
                    filter: i => i.user.id === interaction.user.id &&
                                (i.customId === confirmId || i.customId === cancelId),
                    time: 60000 // 1 minute timeout
                });

                if (buttonInteraction.customId === cancelId) {
                    await buttonInteraction.update({
                        content: '❌ Nuke annulé.',
                        embeds: [],
                        components: []
                    });
                    return;
                }

                // Confirm button pressed
                await buttonInteraction.update({
                    content: `📦 Archivage des messages...`,
                    embeds: [],
                    components: []
                });

                // Archive messages before deletion
                const { attachment, archiveUrl } = await archiveMessages(interaction, messages, toDelete, hours);

                await interaction.editReply({
                    content: `🔥 Suppression de ${messageIdsToDelete.length} messages en cours...`
                });

                // Delete messages
                let deleted = 0;
                let failed = 0;

                // Discord bulk delete only works for messages < 14 days old
                const twoWeeksAgo = Date.now() - (14 * 24 * 60 * 60 * 1000);
                const recentIds = [];
                const oldIds = [];

                for (const msgId of messageIdsToDelete) {
                    const msg = toDelete.find(m => m.id === msgId);
                    const msgData = messages.find(m => m.id === msgId);
                    if (msgData && msgData.timestamp > twoWeeksAgo) {
                        recentIds.push(msgId);
                    } else {
                        oldIds.push(msgId);
                    }
                }

                // Bulk delete recent messages (in chunks of 100)
                for (let i = 0; i < recentIds.length; i += 100) {
                    const chunk = recentIds.slice(i, i + 100);
                    try {
                        if (chunk.length === 1) {
                            await interaction.channel.messages.delete(chunk[0]);
                        } else {
                            await interaction.channel.bulkDelete(chunk, true);
                        }
                        deleted += chunk.length;
                    } catch (error) {
                        logger.error('[NUKE] Bulk delete error:', error);
                        failed += chunk.length;
                    }
                }

                // Delete old messages one by one
                for (const msgId of oldIds) {
                    try {
                        await interaction.channel.messages.delete(msgId);
                        deleted++;
                    } catch (error) {
                        logger.error(`[NUKE] Failed to delete message ${msgId}:`, error);
                        failed++;
                    }
                }

                // Final result
                const resultEmbed = new EmbedBuilder()
                    .setTitle('🔥 Nuke terminé')
                    .setColor(config.colors.success || 0x00FF00)
                    .setDescription(`**${deleted}** messages supprimés avec succès.`)
                    .addFields(
                        { name: '✅ Supprimés', value: `${deleted}`, inline: true },
                        { name: '❌ Échecs', value: `${failed}`, inline: true },
                        { name: '📊 Total analysé', value: `${messages.length}`, inline: true }
                    )
                    .setTimestamp();

                if (archiveUrl) {
                    resultEmbed.addFields({
                        name: '📦 Archive',
                        value: `[Voir l'archive](${archiveUrl})`,
                        inline: false
                    });
                }

                await interaction.editReply({
                    content: null,
                    embeds: [resultEmbed],
                    components: []
                });

                logger.info(`[NUKE] ${interaction.user.tag} deleted ${deleted} conflict messages in #${interaction.channel.name}`);

            } catch (error) {
                if (error.code === 'InteractionCollectorError') {
                    await interaction.editReply({
                        content: '⏱️ Temps écoulé. Nuke annulé.',
                        embeds: [],
                        components: []
                    });
                } else {
                    throw error;
                }
            }

        } catch (error) {
            logger.error('[NUKE] Error:', error);
            await interaction.editReply({
                content: `❌ Erreur: ${error.message}`,
                embeds: [],
                components: []
            });
        }
    }
};
