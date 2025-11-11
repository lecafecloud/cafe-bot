/**
 * Sanitize message content to prevent @everyone and @here mentions
 * Replaces them with zero-width space to make them harmless
 */
export function sanitizeMentions(content) {
    if (!content || typeof content !== 'string') {
        return content;
    }

    // Replace @everyone and @here with zero-width space to disable mentions
    // Using \u200B (zero-width space) between @ and the word
    return content
        .replace(/@everyone/gi, '@\u200Beveryone')
        .replace(/@here/gi, '@\u200Bhere');
}

/**
 * Sanitize embed content to prevent mentions
 */
export function sanitizeEmbed(embed) {
    if (!embed) return embed;

    // Sanitize common embed fields
    if (embed.title) embed.title = sanitizeMentions(embed.title);
    if (embed.description) embed.description = sanitizeMentions(embed.description);

    if (embed.fields && Array.isArray(embed.fields)) {
        embed.fields = embed.fields.map(field => ({
            ...field,
            name: sanitizeMentions(field.name),
            value: sanitizeMentions(field.value)
        }));
    }

    if (embed.footer?.text) {
        embed.footer.text = sanitizeMentions(embed.footer.text);
    }

    if (embed.author?.name) {
        embed.author.name = sanitizeMentions(embed.author.name);
    }

    return embed;
}
