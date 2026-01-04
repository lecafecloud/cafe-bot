import { Events } from 'discord.js';
import logger from '../utils/logger.js';

const PRESENTATION_CHANNEL_ID = '1424034750397415567';
const MEMBER_ROLE_NAME = '🍪︱Membre';
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

export default {
    name: Events.MessageCreate,
    async execute(message) {
        // Debug logging - check channel type and ID
        logger.info(`[WELCOME] MessageCreate event triggered - Channel: ${message.channel.name} (${message.channel.id}), Type: ${message.channel.type}, Author: ${message.author.username}`);

        // Ignore bot messages
        if (message.author.bot) {
            logger.info('[WELCOME] Ignoring bot message');
            return;
        }

        // Check if it's in the presentation channel (handle both text channel and forum posts)
        const isPresentation = message.channel.id === PRESENTATION_CHANNEL_ID ||
                              message.channel.parent?.id === PRESENTATION_CHANNEL_ID;

        if (!isPresentation) {
            logger.info(`[WELCOME] Not presentation channel. Expected: ${PRESENTATION_CHANNEL_ID}, Got: ${message.channel.id}, Parent: ${message.channel.parent?.id}`);
            return;
        }

        // For forum channels, only process the starter message (the presentation itself)
        // Ignore replies in the thread
        if (message.channel.parent?.id === PRESENTATION_CHANNEL_ID) {
            // In forum threads, the starter message ID equals the thread/channel ID
            if (message.id !== message.channel.id) {
                logger.info(`[WELCOME] Ignoring reply in presentation thread. Message ID: ${message.id}, Thread ID: ${message.channel.id}`);
                return;
            }
        }

        logger.info(`[WELCOME] Processing presentation from ${message.author.username}`);

        try {
            // Find the member role
            const memberRole = message.guild.roles.cache.find(role => role.name === MEMBER_ROLE_NAME);
            if (!memberRole) {
                logger.error('[WELCOME] Member role not found: ' + MEMBER_ROLE_NAME);
                return;
            }

            // Check if user already has the role
            if (message.member.roles.cache.has(memberRole.id)) {
                logger.info(`[WELCOME] User ${message.author.username} already has member role`);
                return;
            }

            // Check if bot can manage this role (role hierarchy)
            const botMember = message.guild.members.me;
            if (botMember.roles.highest.position <= memberRole.position) {
                logger.error(`[WELCOME] Bot's highest role is not above the member role. Bot highest: ${botMember.roles.highest.position}, Member role: ${memberRole.position}`);
                await message.reply({
                    content: `Bienvenue ! Je ne peux pas t'assigner le rôle ${MEMBER_ROLE_NAME} car il est au-dessus de mon rôle dans la hiérarchie. Contacte un admin pour le recevoir.`,
                    allowedMentions: { repliedUser: true }
                });
                return;
            }

            // Assign the role
            try {
                await message.member.roles.add(memberRole);
                logger.info(`[WELCOME] Assigned member role to ${message.author.username}`);
            } catch (roleError) {
                logger.error(`[WELCOME] Failed to add role: ${roleError.message}`);
                // Continue with welcome message even if role fails
            }

            // Generate personalized welcome message
            const welcomeMessage = await generateWelcomeMessage(
                message.author.id,
                message.author.username,
                message.content,
                message.guild.channels.cache,
                memberRole
            );

            // React to the presentation
            try {
                await message.react('👋');
            } catch (reactError) {
                logger.error('[WELCOME] Failed to react:', reactError);
            }

            // Send welcome message
            if (welcomeMessage) {
                await message.reply({
                    content: welcomeMessage,
                    allowedMentions: { repliedUser: true }
                });
            }

        } catch (error) {
            logger.error('[WELCOME] Error processing presentation:', error);
        }
    }
};

async function generateWelcomeMessage(userId, username, presentationContent, guildChannels, memberRole) {
    try {
        // Get list of main channels that the member can actually access
        const channels = Array.from(guildChannels.values())
            .filter(ch => {
                if (ch.type !== 0 || ch.name.startsWith('🔒')) return false;

                // Check if a member with the basic role can view this channel
                const permissions = ch.permissionsFor(memberRole);
                return permissions && permissions.has('ViewChannel');
            })
            .map(ch => ({
                id: ch.id,
                name: ch.name,
                topic: ch.topic || ''
            }))
            .slice(0, 20); // Limit to 20 channels for context

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
                model: 'openai/gpt-5-mini',
                messages: [
                    {
                        role: 'system',
                        content: `Tu es un bot d'accueil chaleureux sur un serveur Discord tech français.

MISSION: Accueillir un nouveau membre qui vient de se présenter et lui suggérer 2-3 canaux pertinents selon ses intérêts.

STYLE:
- Chaleureux et accueillant
- Informel et décontracté
- TRÈS COURT (2-3 lignes max)
- En français
- Tutoiement obligatoire
- Pas de formules génériques

STRUCTURE:
1. Accueil personnalisé selon la présentation
2. Suggestion de 2-3 canaux PERTINENTS avec <#ID> pour les rendre cliquables
3. Petite question ouverte pour lancer la conversation (liée à ce que la personne a mentionné)

GUIDE DE CORRESPONDANCE PROFIL/CANAUX:
- Développeur (dev, full stack, frontend, backend) → canaux dev, langages, frameworks
- DevOps/SRE → canaux pipelines, conteneurs, orchestration, cloud
- Sysadmin/Ops → canaux infra, network, sécurité, monitoring
- Débutant/étudiant → canaux d'entraide, ressources, learning
- Cloud (AWS, GCP, Azure) → canaux cloud, infra-as-code
- Sécurité → canaux sécurité, monitoring

FORMAT DES CANAUX:
- Utilise TOUJOURS le format <#ID> pour mentionner un canal
- Exemple: <#123456789> au lieu de #general
- NE JAMAIS écrire juste #nom-du-canal
- CRITIQUE: Ne JAMAIS répéter le nom du canal après le tag <#ID> car Discord l'affiche déjà automatiquement
- ❌ MAUVAIS: "je te recommande <#123> pour les conteneurs" (redondant si le canal s'appelle "conteneurs")
- ✅ BON: "je te recommande <#123>, <#456> et <#789>" (simple et direct)

IMPORTANT:
- NE JAMAIS mentionner "IA" ou "généré"
- NE PAS faire de liste à puces
- Message naturel et fluide
- Choisir les canaux ADAPTÉS AU PROFIL mentionné (dev → dev, devops → devops, etc.)
- TOUJOURS utiliser <#ID> pour les canaux
- CRUCIAL: Tu ne peux suggérer QUE des canaux présents dans la liste fournie ci-dessous
- N'invente JAMAIS de canaux qui n'existent pas dans la liste
- Si aucun canal ne correspond parfaitement, suggère les plus proches
- Les tags <#ID> affichent déjà le nom complet du canal, ne le répète JAMAIS`
                    },
                    {
                        role: 'user',
                        content: `Nouveau membre: <@${userId}> (username: ${username})
Présentation: "${presentationContent}"

Canaux disponibles (UTILISE LE FORMAT <#ID> POUR LES MENTIONNER):
${channels.map(ch => `<#${ch.id}> (${ch.name})${ch.topic ? ' - ' + ch.topic : ''}`).join('\n')}

Génère un message d'accueil court et naturel avec 2-3 suggestions de canaux pertinents.
RAPPEL: Utilise <#${channels[0]?.id}> et non pas #${channels[0]?.name} pour les liens cliquables.
IMPORTANT: Utilise <@${userId}> pour mentionner l'utilisateur, PAS @${username}.`
                    }
                ],
                temperature: 0.8,
                max_tokens: 200
            })
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }

        const data = await response.json();
        const welcomeMessage = data.choices[0]?.message?.content;

        if (!welcomeMessage || welcomeMessage.trim().length === 0) {
            // Fallback message if AI fails
            return `Bienvenue <@${userId}> ! 🎉 Ravi de t'avoir parmi nous ! N'hésite pas à explorer les différents canaux et à participer aux discussions. À bientôt ! ☕`;
        }

        return welcomeMessage.trim();

    } catch (error) {
        logger.error('[WELCOME] Failed to generate welcome message:', error);
        // Fallback message
        return `Bienvenue <@${userId}> ! 🎉 Ravi de t'avoir parmi nous ! N'hésite pas à explorer les différents canaux et à participer aux discussions. À bientôt ! ☕`;
    }
}