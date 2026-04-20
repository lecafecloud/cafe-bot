import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import logger from '../../utils/logger.js';

export default {
    data: new SlashCommandBuilder()
        .setName('keystore-stats')
        .setDescription('Affiche les statistiques du système de stockage Discord')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .setDMPermission(false),

    category: 'utility',
    cooldown: 10,

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            // Get keystore from client (it's stored globally)
            const keystoreChannelId = process.env.KEYSTORE_CHANNEL_ID;

            if (!keystoreChannelId) {
                await interaction.editReply({
                    content: '❌ Le système de stockage Discord n\'est pas configuré.\nDéfinissez `KEYSTORE_CHANNEL_ID` dans le fichier .env'
                });
                return;
            }

            // Fetch the keystore channel
            const keystoreChannel = await interaction.client.channels.fetch(keystoreChannelId);

            if (!keystoreChannel) {
                await interaction.editReply({
                    content: `❌ Impossible de trouver le salon de stockage (ID: ${keystoreChannelId})`
                });
                return;
            }

            // Fetch messages from the keystore channel
            const messages = await keystoreChannel.messages.fetch({ limit: 100 });
            const botMessages = messages.filter(m => m.author.id === interaction.client.user.id);

            let totalStores = 0;
            let totalDataSize = 0;
            const storeDetails = [];

            for (const [messageId, message] of botMessages) {
                try {
                    const parsed = JSON.parse(message.content);
                    if (parsed.__storeName && parsed.__data) {
                        totalStores++;
                        const dataSize = JSON.stringify(parsed.__data).length;
                        totalDataSize += dataSize;

                        storeDetails.push({
                            name: parsed.__storeName,
                            size: dataSize,
                            lastSync: parsed.__lastSync,
                            messageId: messageId
                        });
                    }
                } catch (error) {
                    // Ignore non-JSON messages
                }
            }

            // Sort by size
            storeDetails.sort((a, b) => b.size - a.size);

            // Create embed
            const embed = new EmbedBuilder()
                .setTitle('📊 Statistiques du Keystore Discord')
                .setDescription(`Salon: ${keystoreChannel.name} (<#${keystoreChannel.id}>)`)
                .setColor(0x5865f2)
                .setTimestamp();

            // Add summary
            embed.addFields({
                name: '📈 Résumé',
                value: `**Stores actifs:** ${totalStores}\n` +
                    `**Taille totale:** ${totalDataSize.toLocaleString()} caractères\n` +
                    `**Limite par message:** 2000 caractères\n` +
                    `**Sync automatique:** Toutes les 5 minutes`,
                inline: false
            });

            // Add store details
            if (storeDetails.length > 0) {
                let storesText = '';
                for (const store of storeDetails.slice(0, 5)) {
                    const percentage = ((store.size / 2000) * 100).toFixed(1);
                    const bar = createProgressBar(store.size / 2000, 10);

                    storesText += `**${store.name}**\n`;
                    storesText += `${bar} ${percentage}% (${store.size} chars)\n`;
                    if (store.lastSync) {
                        const syncDate = new Date(store.lastSync);
                        storesText += `Dernier sync: <t:${Math.floor(syncDate.getTime() / 1000)}:R>\n`;
                    }
                    storesText += `\n`;
                }

                if (storeDetails.length > 5) {
                    storesText += `*... et ${storeDetails.length - 5} autres stores*`;
                }

                embed.addFields({
                    name: '💾 Stores',
                    value: storesText || 'Aucun store',
                    inline: false
                });
            }

            // Add health status
            const healthStatus = totalStores === 0
                ? '⚠️ Aucune donnée stockée'
                : storeDetails.some(s => s.size > 1900)
                    ? '⚠️ Certains stores approchent la limite'
                    : '✅ Tous les stores sont sains';

            embed.addFields({
                name: '🏥 État',
                value: healthStatus,
                inline: false
            });

            // Add tips
            embed.setFooter({
                text: 'Le keystore utilise Discord comme base de données - Sync toutes les 5min'
            });

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            logger.error('Error in keystore-stats command:', error);
            await interaction.editReply({
                content: '❌ Erreur lors de la récupération des statistiques du keystore.'
            });
        }
    }
};

/**
 * Create a text-based progress bar
 */
function createProgressBar(percentage, length = 10) {
    const filled = Math.round(percentage * length);
    const empty = length - filled;

    const filledBar = '█'.repeat(Math.max(0, filled));
    const emptyBar = '░'.repeat(Math.max(0, empty));

    return `[${filledBar}${emptyBar}]`;
}
