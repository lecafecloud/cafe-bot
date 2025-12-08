import logger from './logger.js';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const USERS_PER_MESSAGE = 5; // 5 users * ~220 chars + header ≈ 1120 chars < 2000 Discord limit
const MAX_MEMO_LENGTH = 200;

// Cache en mémoire
let userMemos = new Map(); // userId -> memo string
let channelMemos = new Map(); // channelId -> memo string
let botMemo = ''; // memo about the bot itself
let channel = null;
let client = null;
let messageIds = { users: [], channels: [], bot: null }; // Track message IDs for updates
let saveTimeout = null; // Debounce timer for saves
let isSaving = false; // Lock to prevent concurrent saves

/**
 * Initialize the memory system
 */
export async function initMemory(discordClient, keystoreChannelId) {
    client = discordClient;

    try {
        channel = await client.channels.fetch(keystoreChannelId);
        if (!channel) {
            logger.error('Bot Memory: Channel not found');
            return;
        }

        await loadMemoriesFromChannel();
        logger.info(`Bot Memory: Loaded ${userMemos.size} user memos, ${channelMemos.size} channel memos, bot memo: ${botMemo ? 'yes' : 'no'}`);
    } catch (error) {
        logger.error('Bot Memory: Failed to initialize', error);
    }
}

/**
 * Load memories from Discord channel
 */
async function loadMemoriesFromChannel() {
    if (!channel) return;

    try {
        const messages = await channel.messages.fetch({ limit: 100 });

        // Collect all memo messages for cleanup
        const allMemoMessages = { users: [], channels: [], bot: [] };

        for (const [msgId, message] of messages) {
            if (message.author.id !== client.user.id) continue;
            if (!message.content.startsWith('📝 MEMO_')) continue;

            try {
                const lines = message.content.split('\n');
                const header = lines[0];

                if (header.startsWith('📝 MEMO_USERS_')) {
                    allMemoMessages.users.push({ msgId, message, timestamp: message.createdTimestamp });
                    for (let i = 1; i < lines.length; i++) {
                        const match = lines[i].match(/^(\d+): (.+)$/);
                        if (match) {
                            userMemos.set(match[1], match[2]);
                        }
                    }
                } else if (header.startsWith('📝 MEMO_CHANNELS_')) {
                    allMemoMessages.channels.push({ msgId, message, timestamp: message.createdTimestamp });
                    for (let i = 1; i < lines.length; i++) {
                        const match = lines[i].match(/^(\d+): (.+)$/);
                        if (match) {
                            channelMemos.set(match[1], match[2]);
                        }
                    }
                } else if (header === '📝 MEMO_BOT') {
                    allMemoMessages.bot.push({ msgId, message, timestamp: message.createdTimestamp });
                    botMemo = lines.slice(1).join('\n').trim();
                }
            } catch (error) {
                logger.warn(`Bot Memory: Failed to parse message ${msgId}`);
            }
        }

        // Self-healing: keep only the newest memo of each type, delete duplicates
        await cleanupDuplicateMemos(allMemoMessages);

    } catch (error) {
        logger.error('Bot Memory: Failed to load from channel', error);
    }
}

/**
 * Self-healing: delete duplicate memo messages, keep only newest
 */
async function cleanupDuplicateMemos(allMemoMessages) {
    let deletedCount = 0;

    // For users: keep only 1 message (newest)
    if (allMemoMessages.users.length > 1) {
        allMemoMessages.users.sort((a, b) => b.timestamp - a.timestamp);
        messageIds.users = [allMemoMessages.users[0].msgId];
        for (let i = 1; i < allMemoMessages.users.length; i++) {
            try {
                await allMemoMessages.users[i].message.delete();
                deletedCount++;
            } catch (e) { /* ignore */ }
        }
    } else if (allMemoMessages.users.length === 1) {
        messageIds.users = [allMemoMessages.users[0].msgId];
    }

    // For channels: keep only 1 message (newest)
    if (allMemoMessages.channels.length > 1) {
        allMemoMessages.channels.sort((a, b) => b.timestamp - a.timestamp);
        messageIds.channels = [allMemoMessages.channels[0].msgId];
        for (let i = 1; i < allMemoMessages.channels.length; i++) {
            try {
                await allMemoMessages.channels[i].message.delete();
                deletedCount++;
            } catch (e) { /* ignore */ }
        }
    } else if (allMemoMessages.channels.length === 1) {
        messageIds.channels = [allMemoMessages.channels[0].msgId];
    }

    // For bot: keep only 1 message (newest)
    if (allMemoMessages.bot.length > 1) {
        allMemoMessages.bot.sort((a, b) => b.timestamp - a.timestamp);
        messageIds.bot = allMemoMessages.bot[0].msgId;
        for (let i = 1; i < allMemoMessages.bot.length; i++) {
            try {
                await allMemoMessages.bot[i].message.delete();
                deletedCount++;
            } catch (e) { /* ignore */ }
        }
    } else if (allMemoMessages.bot.length === 1) {
        messageIds.bot = allMemoMessages.bot[0].msgId;
    }

    if (deletedCount > 0) {
        logger.info(`Bot Memory: Self-healing cleaned up ${deletedCount} duplicate memo(s)`);
    }
}

/**
 * Schedule a debounced save (waits 2s for all updates to finish)
 */
function scheduleSave() {
    if (saveTimeout) {
        clearTimeout(saveTimeout);
    }
    saveTimeout = setTimeout(() => {
        saveMemoriesNow();
    }, 2000);
}

/**
 * Save all memories to Discord (actual save)
 */
async function saveMemoriesNow() {
    if (!channel || isSaving) return;
    isSaving = true;

    try {
        // Delete old memo messages
        const allMsgIds = [...messageIds.users, ...messageIds.channels];
        if (messageIds.bot) allMsgIds.push(messageIds.bot);

        for (const msgId of allMsgIds) {
            try {
                const msg = await channel.messages.fetch(msgId);
                await msg.delete();
            } catch (e) { /* ignore */ }
        }
        messageIds = { users: [], channels: [], bot: null };

        // Save user memos (paginated)
        const userEntries = Array.from(userMemos.entries());
        for (let i = 0; i < userEntries.length; i += USERS_PER_MESSAGE) {
            const batch = userEntries.slice(i, i + USERS_PER_MESSAGE);
            const partNum = Math.floor(i / USERS_PER_MESSAGE) + 1;
            const content = `📝 MEMO_USERS_${partNum}\n` +
                batch.map(([id, memo]) => `${id}: ${memo}`).join('\n');

            const msg = await channel.send(content);
            messageIds.users.push(msg.id);
        }

        // Save channel memos (paginated)
        const channelEntries = Array.from(channelMemos.entries());
        for (let i = 0; i < channelEntries.length; i += USERS_PER_MESSAGE) {
            const batch = channelEntries.slice(i, i + USERS_PER_MESSAGE);
            const partNum = Math.floor(i / USERS_PER_MESSAGE) + 1;
            const content = `📝 MEMO_CHANNELS_${partNum}\n` +
                batch.map(([id, memo]) => `${id}: ${memo}`).join('\n');

            const msg = await channel.send(content);
            messageIds.channels.push(msg.id);
        }

        // Save bot self-memo
        if (botMemo) {
            const msg = await channel.send(`📝 MEMO_BOT\n${botMemo}`);
            messageIds.bot = msg.id;
        }

        logger.debug(`Bot Memory: Saved ${userMemos.size} user memos, ${channelMemos.size} channel memos, bot memo: ${botMemo ? 'yes' : 'no'}`);
    } catch (error) {
        logger.error('Bot Memory: Failed to save', error);
    } finally {
        isSaving = false;
    }
}

/**
 * Get memo for a user
 */
export function getUserMemo(userId) {
    return userMemos.get(userId) || null;
}

/**
 * Get memo for a channel
 */
export function getChannelMemo(channelId) {
    return channelMemos.get(channelId) || null;
}

/**
 * Set user memo directly (for init)
 */
export function setUserMemo(userId, memo) {
    if (memo && memo.length <= MAX_MEMO_LENGTH) {
        userMemos.set(userId, memo);
    }
}

/**
 * Set channel memo directly (for init)
 */
export function setChannelMemo(channelId, memo) {
    if (memo && memo.length <= MAX_MEMO_LENGTH) {
        channelMemos.set(channelId, memo);
    }
}

/**
 * Clear all memos (for reinit)
 */
export async function clearAllMemos() {
    userMemos.clear();
    channelMemos.clear();
    botMemo = '';

    // Delete all memo messages from Discord
    const allMsgIds = [...messageIds.users, ...messageIds.channels];
    if (messageIds.bot) allMsgIds.push(messageIds.bot);

    for (const msgId of allMsgIds) {
        try {
            const msg = await channel.messages.fetch(msgId);
            await msg.delete();
        } catch (e) { /* ignore */ }
    }
    messageIds = { users: [], channels: [], bot: null };

    logger.info('Bot Memory: All memos cleared');
}

/**
 * Force save now (for init)
 */
export async function forceSave() {
    await saveMemoriesNow();
}

/**
 * Get context for AI prompt (channel memo + participating users memos)
 */
export function getMemoryContext(channelId, participantIds = []) {
    let context = '';

    // Channel memo
    const chanMemo = channelMemos.get(channelId);
    if (chanMemo) {
        context += `[canal] ${chanMemo}\n`;
    }

    // User memos for participants
    for (const userId of participantIds) {
        const userMemo = userMemos.get(userId);
        if (userMemo) {
            context += `[user] ${userMemo}\n`;
        }
    }

    return context.trim();
}

/**
 * Build memory context from message history
 */
export function buildMemoryContext(channelId, messageHistory) {
    // Extract user IDs from history (format: "[HH:MM:SS] username: message")
    const participantIds = new Set();

    // We need user IDs, not usernames - this will be passed from the caller
    // For now, return just channel memo
    const chanMemo = channelMemos.get(channelId);

    let context = '';
    if (chanMemo) {
        context = `mémo du canal: ${chanMemo}`;
    }

    return context;
}

/**
 * Get bot self-memo
 */
export function getBotMemo() {
    return botMemo;
}

/**
 * Get formatted memory for prompt
 */
export function getMemoryForPrompt(channelId, userIds = []) {
    const parts = [];

    // Bot self-memo
    if (botMemo) {
        parts.push(`moi: ${botMemo}`);
    }

    // Channel memo
    const chanMemo = channelMemos.get(channelId);
    if (chanMemo) {
        parts.push(`canal: ${chanMemo}`);
    }

    // User memos
    for (const userId of userIds) {
        const memo = userMemos.get(userId);
        if (memo) {
            parts.push(`user ${userId}: ${memo}`);
        }
    }

    return parts.length > 0 ? parts.join('\n') : '';
}

/**
 * Update user memo via LLM after interaction
 */
export async function updateUserMemo(userId, username, userMessage, botResponse) {
    if (!process.env.OPENROUTER_API_KEY) return;

    const currentMemo = userMemos.get(userId) || '';

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
                    {
                        role: 'system',
                        content: `Tu gères le mémo d'un utilisateur Discord. Max ${MAX_MEMO_LENGTH} caractères.

Mémo actuel: "${currentMemo || 'vide'}"

Tâche: Fusionne intelligemment l'ancien mémo avec les nouvelles infos.
- Garde les infos importantes de l'ancien mémo
- Ajoute les nouvelles infos pertinentes (job, technos, projets, préférences)
- Résume/condense si besoin pour respecter la limite
- Si rien de nouveau, retourne l'ancien mémo tel quel
- N'invente rien`
                    },
                    {
                        role: 'user',
                        content: `User "${username}" a dit: "${userMessage}"
Bot a répondu: "${botResponse}"

Nouveau mémo:`
                    }
                ],
                temperature: 0.3,
                max_tokens: 100
            })
        });

        clearTimeout(timeoutId);

        if (!response.ok) return;

        const data = await response.json();
        const newMemo = data.choices?.[0]?.message?.content?.trim();

        if (newMemo && newMemo.length <= MAX_MEMO_LENGTH) {
            userMemos.set(userId, newMemo);
            scheduleSave();
            logger.info(`Bot Memory: Updated memo for ${username}: ${newMemo.substring(0, 50)}...`);
        }
    } catch (error) {
        logger.debug('Bot Memory: Failed to update user memo', error.message);
    }
}

/**
 * Update channel memo via LLM
 */
export async function updateChannelMemo(channelId, channelName, recentContext) {
    if (!process.env.OPENROUTER_API_KEY) return;

    const currentMemo = channelMemos.get(channelId) || '';

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
                    {
                        role: 'system',
                        content: `Tu gères le mémo d'un canal Discord. Max ${MAX_MEMO_LENGTH} caractères.

Mémo actuel: "${currentMemo || 'vide'}"

Règles:
- Résume le contexte et les sujets des discussions récentes
- Écris des phrases complètes décrivant l'ambiance et les thèmes
- N'INVENTE RIEN, base-toi uniquement sur le contenu
- Si rien de nouveau, retourne le mémo actuel tel quel`
                    },
                    {
                        role: 'user',
                        content: `Canal #${channelName}, discussions récentes:\n${recentContext}\n\nNouveau mémo:`
                    }
                ],
                temperature: 0.3,
                max_tokens: 100
            })
        });

        clearTimeout(timeoutId);

        if (!response.ok) return;

        const data = await response.json();
        const newMemo = data.choices?.[0]?.message?.content?.trim();

        if (newMemo && newMemo.length <= MAX_MEMO_LENGTH) {
            channelMemos.set(channelId, newMemo);
            scheduleSave();
            logger.info(`Bot Memory: Updated memo for #${channelName}: ${newMemo.substring(0, 50)}...`);
        }
    } catch (error) {
        logger.debug('Bot Memory: Failed to update channel memo', error.message);
    }
}

/**
 * Update bot self-memo via LLM
 */
export async function updateBotMemo(userMessage, botResponse, username) {
    if (!process.env.OPENROUTER_API_KEY) return;

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
                    {
                        role: 'system',
                        content: `Tu gères le mémo personnel d'un bot Discord. Max ${MAX_MEMO_LENGTH} caractères.

Mémo actuel: "${botMemo || 'vide'}"

Tâche: Fusionne intelligemment l'ancien mémo avec les nouvelles infos.
- Garde les infos importantes de l'ancien mémo
- Ajoute les nouvelles infos sur le bot (nom, rôle, préférences, feedbacks)
- Résume/condense si besoin pour respecter la limite
- Si rien de nouveau sur le bot, retourne l'ancien mémo tel quel
- N'invente rien`
                    },
                    {
                        role: 'user',
                        content: `${username} a dit: "${userMessage}"
Bot a répondu: "${botResponse}"

Nouveau mémo:`
                    }
                ],
                temperature: 0.3,
                max_tokens: 100
            })
        });

        clearTimeout(timeoutId);

        if (!response.ok) return;

        const data = await response.json();
        const newMemo = data.choices?.[0]?.message?.content?.trim();

        if (newMemo && newMemo.length <= MAX_MEMO_LENGTH) {
            botMemo = newMemo;
            scheduleSave();
            logger.info(`Bot Memory: Updated bot memo: ${newMemo.substring(0, 50)}...`);
        }
    } catch (error) {
        logger.debug('Bot Memory: Failed to update bot memo', error.message);
    }
}

// Legacy exports for compatibility
export function setKeystore() {} // No-op, we use initMemory instead
export async function loadMemories() {} // No-op, handled by initMemory
export function getMemories() { return []; }
export function getMemoriesForPrompt() { return ''; }
