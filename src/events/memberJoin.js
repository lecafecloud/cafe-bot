import { Events, EmbedBuilder } from 'discord.js';
import logger from '../utils/logger.js';
import { findReferrer } from '../utils/referralSystem.js';

const WELCOME_CHANNEL_ID = '1392401326872334407';
const PRESENTATION_CHANNEL_ID = '1424034750397415567';
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

export default {
    name: Events.GuildMemberAdd,
    async execute(member) {
        try {
            logger.info(`[MEMBER_JOIN] New member joined: ${member.user.username} (${member.id})`);

            // Get the welcome channel
            const welcomeChannel = member.guild.channels.cache.get(WELCOME_CHANNEL_ID);

            if (!welcomeChannel) {
                logger.error(`[MEMBER_JOIN] Welcome channel not found: ${WELCOME_CHANNEL_ID}`);
                return;
            }

            // Wait for Discord to fully process the join on client side
            // This ensures the user sees the ping and system join message appears first
            await new Promise(resolve => setTimeout(resolve, 8000));

            // Check if member was referred
            let referrerMember = null;
            try {
                const referrerId = await findReferrer(member.id);
                if (referrerId) {
                    referrerMember = await member.guild.members.fetch(referrerId);
                    logger.info(`[MEMBER_JOIN] ${member.user.username} was referred by ${referrerMember.user.username}`);
                }
            } catch (error) {
                logger.warn('[MEMBER_JOIN] Error checking referrer:', error);
            }

            // Generate personalized welcome message
            const welcomeText = await generateWelcomeMessage(member.displayName, member.guild.memberCount, referrerMember);

            // Create welcome embed
            const welcomeEmbed = new EmbedBuilder()
                .setColor('#FF6B6B')
                .setTitle('🎉 Bienvenue sur le serveur !')
                .setDescription(welcomeText)
                .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
                .setFooter({ text: `Membre #${member.guild.memberCount}` })
                .setTimestamp();

            // Send welcome message
            await welcomeChannel.send({
                content: `${member}`,
                embeds: [welcomeEmbed]
            });

            logger.info(`[MEMBER_JOIN] Welcome message sent to ${member.user.username}`);

        } catch (error) {
            logger.error('[MEMBER_JOIN] Error sending welcome message:', error);
        }
    }
};

async function generateWelcomeMessage(username, memberCount, referrerMember = null) {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        // Build referrer instruction if present
        let referrerInstruction = '';
        let referrerUserPrompt = '';
        if (referrerMember) {
            referrerInstruction = `\n\nIMPORTANT - PARRAINAGE:
- Ce membre a été parrainé par ${referrerMember.displayName}
- OBLIGATOIRE: Ajouter UNE SEULE phrase courte à la fin (avant l'encouragement) mentionnant le parrain
- Format: "Tu as été parrainé par ${referrerMember} - n'hésite pas à lui poser tes questions !"
- Utiliser EXACTEMENT le format ${referrerMember} (avec @) pour mentionner le parrain`;

            referrerUserPrompt = `\nParrain: ${referrerMember.displayName} (ID: <@${referrerMember.id}>)`;
        }

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
                    {
                        role: 'system',
                        content: `Tu es un bot d'accueil du Café Cloud, un Discord francophone Cloud & DevOps.

MISSION: Créer un message d'accueil concis et engageant pour un nouveau membre.

À PROPOS DU SERVEUR (à mentionner subtilement):
- Communauté Cloud & DevOps francophone (AWS, Kubernetes, Terraform, Docker, CI/CD)
- Entraide, partage de projets, opportunités pro
- Ambiance bienveillante

STYLE:
- Chaleureux et direct
- Informel (tutoiement obligatoire)
- Concis - environ 6-7 lignes maximum

STRUCTURE:
1. Salutation courte avec le prénom ${username} (SANS @, juste le nom)
2. SAUT DE LIGNE
3. Une phrase courte mentionnant l'esprit du serveur (entraide/communauté Cloud-DevOps)
4. Invitation directe à se présenter dans <#${PRESENTATION_CHANNEL_ID}>
5. 3 suggestions pour la présentation (bullet points avec •)
6. SAUT DE LIGNE${referrerMember ? '\n7. Phrase mentionnant le parrain (voir instructions PARRAINAGE)\n8. Phrase d\'encouragement courte' : '\n7. Phrase d\'encouragement courte'}

FORMAT: Utilise des sauts de ligne pour aérer le message, mais reste concis

IMPORTANT:
- Concis mais chaleureux
- OBLIGATOIRE: utiliser EXACTEMENT <#${PRESENTATION_CHANNEL_ID}> pour le lien (PAS le nom du canal, UNIQUEMENT le format <#ID>)
- 1-2 emojis maximum
- NE JAMAIS mentionner "IA", "bot" ou "généré"
- Mentionner subtilement le Café Cloud sans faire de la pub
- Varier les formulations${referrerInstruction}`
                    },
                    {
                        role: 'user',
                        content: `Nouveau membre: ${username}
Nombre de membres: ${memberCount}${referrerUserPrompt}

Génère un message d'accueil concis et chaleureux. Utilise juste le prénom "${username}" sans @.`
                    }
                ],
                temperature: 0.9,
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
            throw new Error('Empty response from API');
        }

        return welcomeMessage.trim();

    } catch (error) {
        logger.error('[MEMBER_JOIN] Failed to generate welcome message:', error);
        // Fallback message
        let fallbackMessage = `Salut ${username} ! 👋

On t'invite à te présenter dans <#${PRESENTATION_CHANNEL_ID}> pour qu'on te connaisse mieux !

**Quelques idées :**
• Ton rôle dans le monde de la tech
• Tes technologies préférées
• Ce que tu espères découvrir ici`;

        if (referrerMember) {
            fallbackMessage += `\n\nTu as été parrainé par ${referrerMember} - n'hésite pas à lui poser tes questions !`;
        }

        fallbackMessage += `\n\nBienvenue parmi nous ! 🚀`;

        return fallbackMessage;
    }
}
