import logger from './logger.js';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

export async function generateTechQuestion(channelName = '', channelTopic = '', previousQuestions = []) {
    logger.info(`[DEBUG] generateTechQuestion called for channel: ${channelName}`);
    logger.info(`[DEBUG] Previous questions count: ${previousQuestions.length}`);
    // Build a very specific prompt based on the channel
    const channelInfo = `Canal: "${channelName}"${channelTopic ? `, Description: "${channelTopic}"` : ''}`;

    // Add previous questions info to the prompt - use more history
    const historyInfo = previousQuestions.length > 0
        ? `\n\n⚠️ QUESTIONS DÉJÀ POSÉES (NE JAMAIS RÉPÉTER CES QUESTIONS OU LEURS VARIANTES):\n${previousQuestions.slice(-20).map((q, i) => `${i+1}. ${q}`).join('\n')}`
        : '';

    const prompts = [
        `${channelInfo}\n\nGénère une question COURTE et DIRECTE (maximum 15 mots) pour stimuler la discussion.\n\nExemples de bonnes questions courtes:\n- "Quelle stack de monitoring utilisez-vous et pourquoi?"\n- "Votre pire incident en prod cette année?"\n- "Comment gérez-vous les secrets en production?"\n- "Team Terraform ou Pulumi?"\n- "Votre meilleur hack DevOps récent?"\n\nLa question doit être PERTINENTE pour le canal et FACILE à répondre rapidement.${historyInfo}`,
        `${channelInfo}\n\nGénère une question de RETOUR D'EXPÉRIENCE très COURTE (max 12 mots).\n\nExemples:\n- "Votre plus grosse galère récente?"\n- "Un outil qui a changé votre workflow?"\n- "Votre migration la plus complexe?"\n\nDOIT être en rapport avec le canal. Sois DIRECT et CONCIS.${historyInfo}`
    ];

    const selectedPrompt = prompts[Math.floor(Math.random() * prompts.length)];

    // Get current date for context
    const currentYear = new Date().getFullYear();

    // Build the complete system message
    const systemMessage = `Tu es un animateur Discord DevOps. Génère des questions COURTES et ENGAGEANTES.

Note: Nous sommes en ${currentYear}.

Règles CRITIQUES:
1. MAXIMUM 15 mots par question
2. Style direct et casual (pas trop formel)
3. Questions qui appellent au partage d'expérience
4. DOIT correspondre au thème du canal
5. ⚠️ IMPÉRATIF: Ne JAMAIS poser une question similaire ou variante d'une question déjà posée

Par canal:
- "network/réseau" → VPC, DNS, load balancing, CDN
- "monitoring" → Prometheus, Grafana, logs, alerting
- "containers" → Docker, Kubernetes, Helm
- "cloud" → AWS, Azure, GCP
- "pipeline/CI-CD" → Jenkins, GitLab CI, GitHub Actions
- "sécurité" → IAM, secrets, RBAC, scanning

Exemples de bonnes questions:
- "Votre fail Kubernetes préféré?"
- "Team Docker ou Podman?"
- "Comment surveillez-vous vos coûts cloud?"` + (previousQuestions && previousQuestions.length > 0 ? `\n\n⚠️⚠️⚠️ QUESTIONS INTERDITES (NE JAMAIS POSER CES QUESTIONS OU DES VARIANTES SIMILAIRES) ⚠️⚠️⚠️:\n${previousQuestions.slice(-20).map((q, i) => `${i+1}. ${q}`).join('\n')}\n\n>>> Tu DOIS générer une question COMPLÈTEMENT DIFFÉRENTE de toutes celles ci-dessus <<<` : '');

    logger.info('[DEBUG] ========== RAW PROMPT TO AI ==========');
    logger.info(`[DEBUG] System Message: ${systemMessage.substring(0, 500)}...`);
    logger.info(`[DEBUG] User Prompt: ${selectedPrompt}`);
    logger.info('[DEBUG] ========================================');

    try {
        logger.info('[DEBUG] Calling OpenRouter API...');
        logger.info(`[DEBUG] API Key exists: ${!!process.env.OPENROUTER_API_KEY}`);

        // Add timeout using AbortController
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout - increased from 10

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
                        content: systemMessage
                    },
                    {
                        role: 'user',
                        content: selectedPrompt
                    }
                ],
                temperature: 1.0,  // Maximum creativity to avoid repetition
                max_tokens: 60,    // Allow slightly longer responses
                top_p: 0.95,       // Nucleus sampling for diversity
                presence_penalty: 0.6,  // Penalize repeating topics
                frequency_penalty: 0.6  // Penalize repeating phrases
            })
        });

        clearTimeout(timeoutId);
        logger.info(`[DEBUG] OpenRouter response status: ${response.status}`);

        if (!response.ok) {
            throw new Error(`OpenRouter API error: ${response.status}`);
        }

        let data;
        try {
            const responseText = await response.text();
            logger.info(`[DEBUG] Raw response: ${responseText.substring(0, 200)}...`);
            data = JSON.parse(responseText);
        } catch (parseError) {
            logger.error('[DEBUG] Failed to parse response:', parseError);
            throw parseError;
        }

        logger.info('[DEBUG] OpenRouter response received successfully');

        if (!data.choices || !data.choices[0] || !data.choices[0].message) {
            logger.error('[DEBUG] Invalid response structure:', JSON.stringify(data));
            throw new Error('Invalid API response structure');
        }

        const content = data.choices[0].message.content.trim();
        logger.info(`[DEBUG] Generated question: ${content.substring(0, 100)}...`);
        return content;
    } catch (error) {
        logger.error('[DEBUG] Failed to generate tech question:', error);
        logger.error('[DEBUG] Error details:', error.message);
        logger.error('[DEBUG] Stack trace:', error.stack);
        // Throw the error to be handled by the calling function
        throw new Error(`API Error: ${error.message}`);
    }
}

// Remove old fallback questions
/*
const fallbackQuestions = [
            "☁️ **AWS vs Azure vs GCP**: Quel cloud provider offre le meilleur rapport qualité/prix pour un cluster Kubernetes en production?",
            "🚀 **Jenkins vs GitLab CI vs GitHub Actions**: Quelle plateforme CI/CD utilisez-vous et pourquoi?",
            "🐳 **Docker Swarm vs Kubernetes**: Pour quelle taille de projet Kubernetes devient-il vraiment nécessaire?",
            "📦 **Helm vs Kustomize**: Comment gérez-vous vos déploiements Kubernetes en production?",
            "🔧 **Terraform vs Pulumi vs CDK**: Quel outil IaC préférez-vous pour gérer une infrastructure multi-cloud?",
            "🔍 **Prometheus + Grafana vs DataDog vs New Relic**: Quelle stack de monitoring pour un budget serré?",
            "🔐 **ArgoCD vs Flux vs Tekton**: Quelle solution GitOps avez-vous adoptée et pourquoi?",
            "⚡ **EKS vs GKE vs AKS**: Quel service Kubernetes managé offre la meilleure expérience développeur?",
            "💰 **Retour d'expérience**: Comment avez-vous optimisé vos coûts cloud? Quelles économies avez-vous réalisées?",
            "🚨 **Retour d'expérience**: Quel a été votre pire incident en production et qu'avez-vous appris?",
            "🛠️ **Retour d'expérience**: Comment gérez-vous les secrets dans votre pipeline CI/CD?",
            "📊 **Retour d'expérience**: Quelle stratégie de backup/disaster recovery pour Kubernetes?"
        ];

*/