import logger from './logger.js';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Filtre les questions par canal et garde les scores pour le feedback
export function filterQuestionsByChannel(questions, channelName) {
    return questions
        .filter(q => q.channel === channelName)
        .map(q => ({ question: q.question, score: q.score || 0 }));
}

export async function generateTechQuestion(channelName = '', channelTopic = '', previousQuestions = []) {
    logger.info(`[DEBUG] generateTechQuestion called for channel: ${channelName}`);
    logger.info(`[DEBUG] Previous questions count: ${previousQuestions.length}`);

    const currentYear = new Date().getFullYear();
    const channelInfo = `Canal: "${channelName}"${channelTopic ? ` - ${channelTopic}` : ''}`;

    // Historique du canal avec scores (format: question [score: +X/-X])
    const formatHistory = (questions) => {
        if (questions.length === 0) return '';
        const sorted = [...questions].sort((a, b) => b.score - a.score); // Best scores first
        const formatted = sorted.slice(-50).map((q, i) => {
            const scoreStr = q.score > 0 ? `+${q.score}` : q.score.toString();
            return `${i+1}. [${scoreStr}] ${q.question}`;
        }).join('\n');
        return `\n\nHistorique (score = upvotes - downvotes, inspire-toi des scores positifs):\n${formatted}`;
    };

    const historySection = formatHistory(previousQuestions);

    const systemMessage = `Tu es un animateur Discord DevOps/Cloud. Année: ${currentYear}.

Génère UNE question courte (max 15 mots), originale et engageante pour le canal "${channelName}".

Règles:
- Pertinent pour le canal
- Appelle au partage d'expérience
- Inspire-toi du STYLE des questions avec scores positifs
- Évite le style des questions avec scores négatifs
- Pas de question déjà posée${historySection}`;

    const userPrompt = `${channelInfo}\n\nGénère une question de discussion unique et engageante.`;

    logger.info('[DEBUG] ========== RAW PROMPT TO AI ==========');
    logger.info(`[DEBUG] System Message: ${systemMessage}`);
    logger.info(`[DEBUG] User Prompt: ${userPrompt}`);
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
                model: 'openai/gpt-5.2',
                messages: [
                    {
                        role: 'system',
                        content: systemMessage
                    },
                    {
                        role: 'user',
                        content: userPrompt
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