import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import config from '../../config/config.js';
import logger from '../../utils/logger.js';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MAX_MEMO_LENGTH = 200;

// Direct access to memo storage (we'll call the LLM directly here)
import { updateUserMemo, updateChannelMemo } from '../../utils/botMemory.js';

export default {
    data: new SlashCommandBuilder()
        .setName('init-mem')
        .setDescription('Initialise la mémoire du bot sur les channels et users (Admin)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .setDMPermission(false),

    category: 'utility',
    cooldown: 300,

    async execute(interaction) {
        // Check if user is owner
        const ownerIds = process.env.OWNER_IDS?.split(',') || [];
        if (!ownerIds.includes(interaction.user.id)) {
            return interaction.reply({
                content: `${config.emojis.error} Cette commande est réservée aux administrateurs du bot.`,
                ephemeral: true
            });
        }

        await interaction.deferReply({ ephemeral: true });

        logger.info(`[INIT-MEM] Started by ${interaction.user.tag}`);

        try {
            const guild = interaction.guild;
            const textChannels = guild.channels.cache.filter(
                ch => ch.type === ChannelType.GuildText && ch.viewable
            );

            let channelCount = 0;
            let userCount = 0;
            const processedUsers = new Set();

            await interaction.editReply({
                content: `⏳ Initialisation en cours... 0/${textChannels.size} channels`
            });

            for (const [channelId, channel] of textChannels) {
                try {
                    // Fetch recent messages
                    const messages = await channel.messages.fetch({ limit: 50 });

                    if (messages.size === 0) continue;

                    // Build context for channel memo
                    const channelContext = [];
                    const userMessages = new Map(); // userId -> messages[]

                    for (const [, msg] of messages) {
                        if (msg.author.bot) continue;

                        const content = msg.content.substring(0, 200);
                        if (content.length < 10) continue;

                        channelContext.push(`${msg.author.username}: ${content}`);

                        // Collect user messages
                        if (!userMessages.has(msg.author.id)) {
                            userMessages.set(msg.author.id, {
                                username: msg.author.username,
                                messages: []
                            });
                        }
                        userMessages.get(msg.author.id).messages.push(content);
                    }

                    // Generate channel memo
                    if (channelContext.length > 0) {
                        const channelMemo = await generateMemo(
                            'channel',
                            channelContext.slice(0, 20).join('\n'),
                            channel.name
                        );
                        if (channelMemo) {
                            await updateChannelMemo(channelId, channel.name, channelContext.slice(0, 10).join('\n'));
                            channelCount++;
                        }
                    }

                    // Generate user memos (only for users not yet processed)
                    for (const [userId, userData] of userMessages) {
                        if (processedUsers.has(userId)) continue;
                        if (userData.messages.length < 3) continue; // Need at least 3 messages

                        const userMemo = await generateMemo(
                            'user',
                            userData.messages.slice(0, 10).join('\n'),
                            userData.username
                        );
                        if (userMemo) {
                            await updateUserMemo(
                                userId,
                                userData.username,
                                userData.messages.join(' '),
                                'init'
                            );
                            processedUsers.add(userId);
                            userCount++;
                        }
                    }

                    // Update progress
                    await interaction.editReply({
                        content: `⏳ Initialisation en cours... ${channelCount}/${textChannels.size} channels, ${userCount} users`
                    });

                } catch (error) {
                    logger.debug(`[INIT-MEM] Error processing channel ${channel.name}:`, error.message);
                }
            }

            logger.info(`[INIT-MEM] Completed: ${channelCount} channels, ${userCount} users`);

            await interaction.editReply({
                content: `✅ Mémoire initialisée!\n- ${channelCount} channels analysés\n- ${userCount} users profilés`
            });

        } catch (error) {
            logger.error('[INIT-MEM] Error:', error);
            await interaction.editReply({
                content: `${config.emojis.error} Erreur: ${error.message}`
            });
        }
    }
};

/**
 * Generate a memo using LLM
 */
async function generateMemo(type, context, name) {
    if (!process.env.OPENROUTER_API_KEY) return null;

    const prompts = {
        channel: {
            system: `Génère un mémo court (max ${MAX_MEMO_LENGTH} chars) résumant le thème/contexte d'un channel Discord.
Format: "Débat K8s vs Swarm, questions Terraform"
Pas de phrases, que des mots-clés.`,
            user: `Channel #${name}, messages récents:\n${context}\n\nMémo:`
        },
        user: {
            system: `Génère un mémo court (max ${MAX_MEMO_LENGTH} chars) sur un utilisateur Discord basé sur ses messages.
Identifie: job, technos, centres d'intérêt, personnalité.
Format: "SRE chez OVH, fan de Terraform, aime les débats"
Pas de phrases, que des infos clés.`,
            user: `Messages de ${name}:\n${context}\n\nMémo:`
        }
    };

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

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
                model: 'openai/gpt-4o-mini',
                messages: [
                    { role: 'system', content: prompts[type].system },
                    { role: 'user', content: prompts[type].user }
                ],
                temperature: 0.3,
                max_tokens: 100
            })
        });

        clearTimeout(timeoutId);

        if (!response.ok) return null;

        const data = await response.json();
        const memo = data.choices?.[0]?.message?.content?.trim();

        return memo && memo.length <= MAX_MEMO_LENGTH ? memo : null;

    } catch (error) {
        return null;
    }
}
