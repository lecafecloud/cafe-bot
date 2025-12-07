import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import config from '../../config/config.js';
import logger from '../../utils/logger.js';
import { clearAllMemos, setUserMemo, setChannelMemo, forceSave } from '../../utils/botMemory.js';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MAX_MEMO_LENGTH = 200;

export default {
    data: new SlashCommandBuilder()
        .setName('init-mem')
        .setDescription('Réinitialise et génère la mémoire du bot (Admin)')
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
            // Step 1: Clear all existing memos
            await interaction.editReply({ content: `🗑️ Suppression des anciens mémos...` });
            await clearAllMemos();

            const guild = interaction.guild;
            const textChannels = guild.channels.cache.filter(
                ch => ch.type === ChannelType.GuildText && ch.viewable
            );

            let channelCount = 0;
            let userCount = 0;
            const userProfiles = new Map(); // userId -> { username, messages: [] }

            // Step 2: Collect all messages from all channels
            await interaction.editReply({ content: `📥 Collecte des messages... 0/${textChannels.size} channels` });

            let channelIndex = 0;
            for (const [channelId, channel] of textChannels) {
                channelIndex++;
                try {
                    const messages = await channel.messages.fetch({ limit: 100 });

                    const channelMessages = [];

                    for (const [, msg] of messages) {
                        if (msg.author.bot) continue;
                        const content = msg.content.substring(0, 300);
                        if (content.length < 15) continue;

                        channelMessages.push(`${msg.author.username}: ${content}`);

                        // Collect user messages
                        if (!userProfiles.has(msg.author.id)) {
                            userProfiles.set(msg.author.id, {
                                username: msg.author.username,
                                messages: []
                            });
                        }
                        userProfiles.get(msg.author.id).messages.push(content);
                    }

                    // Generate channel memo if enough content
                    if (channelMessages.length >= 5) {
                        const memo = await generateChannelMemo(channel.name, channelMessages.slice(0, 30));
                        if (memo) {
                            setChannelMemo(channelId, memo);
                            channelCount++;
                            logger.info(`[INIT-MEM] Channel #${channel.name}: ${memo.substring(0, 50)}...`);
                        }
                    }

                    if (channelIndex % 5 === 0) {
                        await interaction.editReply({
                            content: `📥 Collecte... ${channelIndex}/${textChannels.size} channels, ${userProfiles.size} users trouvés`
                        });
                    }

                } catch (error) {
                    logger.debug(`[INIT-MEM] Skip channel ${channel.name}: ${error.message}`);
                }
            }

            // Step 3: Generate user memos
            await interaction.editReply({
                content: `👤 Génération des profils users... 0/${userProfiles.size}`
            });

            let userIndex = 0;
            for (const [userId, profile] of userProfiles) {
                userIndex++;

                // Need at least 5 messages to profile
                if (profile.messages.length < 5) continue;

                try {
                    const memo = await generateUserMemo(profile.username, profile.messages.slice(0, 20));
                    if (memo) {
                        setUserMemo(userId, memo);
                        userCount++;
                        logger.info(`[INIT-MEM] User ${profile.username}: ${memo.substring(0, 50)}...`);
                    }
                } catch (error) {
                    logger.debug(`[INIT-MEM] Skip user ${profile.username}: ${error.message}`);
                }

                if (userIndex % 10 === 0) {
                    await interaction.editReply({
                        content: `👤 Génération des profils... ${userIndex}/${userProfiles.size} (${userCount} créés)`
                    });
                }
            }

            // Step 4: Save to Discord
            await interaction.editReply({ content: `💾 Sauvegarde...` });
            await forceSave();

            logger.info(`[INIT-MEM] Completed: ${channelCount} channels, ${userCount} users`);

            await interaction.editReply({
                content: `✅ Mémoire réinitialisée!\n\n📊 **Résultats:**\n- ${channelCount} channels analysés\n- ${userCount} users profilés\n- ${userProfiles.size - userCount} users ignorés (< 5 messages)`
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
 * Generate channel memo from messages
 */
async function generateChannelMemo(channelName, messages) {
    if (!process.env.OPENROUTER_API_KEY) return null;

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

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
                    {
                        role: 'system',
                        content: `Analyse ces messages Discord et génère un mémo COURT (max ${MAX_MEMO_LENGTH} chars) décrivant le thème/sujet du channel.

Format attendu: "discussions K8s et Docker, questions débutants, débats infra"
- Pas de phrases complètes
- Que des mots-clés et thèmes
- Sois spécifique au contenu réel`
                    },
                    {
                        role: 'user',
                        content: `Channel: #${channelName}\n\nMessages:\n${messages.join('\n')}\n\nMémo du channel:`
                    }
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

/**
 * Generate user memo from their messages
 */
async function generateUserMemo(username, messages) {
    if (!process.env.OPENROUTER_API_KEY) return null;

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

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
                    {
                        role: 'system',
                        content: `Analyse ces messages d'un utilisateur Discord et génère un mémo COURT (max ${MAX_MEMO_LENGTH} chars) le décrivant.

Format attendu: "dev backend Python, bosse chez Datadog, intéressé par K8s"
- Identifie: métier, technos, entreprise, centres d'intérêt
- Si pas d'info claire sur un aspect, ne l'invente pas
- Pas de phrases, que des infos factuelles
- Base-toi UNIQUEMENT sur ce qu'il dit, pas de suppositions`
                    },
                    {
                        role: 'user',
                        content: `Messages de ${username}:\n${messages.join('\n')}\n\nMémo sur cet utilisateur:`
                    }
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
