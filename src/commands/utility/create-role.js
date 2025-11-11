import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import config from '../../config/config.js';
import logger from '../../utils/logger.js';
import { addRoleReaction } from '../../utils/roleReactions.js';

export default {
    data: new SlashCommandBuilder()
        .setName('create-role')
        .setDescription('Crée un rôle et ajoute une réaction au message précédent pour l\'attribution automatique')
        .addStringOption(option =>
            option.setName('rolename')
                .setDescription('Le nom du rôle à créer')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('emoji')
                .setDescription('L\'emoji à utiliser pour la réaction (par défaut: ✅)')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .setDMPermission(false),

    category: 'utility',
    cooldown: 5,

    async execute(interaction) {
        const roleName = interaction.options.getString('rolename');
        const emoji = interaction.options.getString('emoji') || '✅';

        // Format role name as "emoji︱rolename"
        const formattedRoleName = `${emoji}︱${roleName}`;

        await interaction.deferReply({ ephemeral: true });

        try {
            // 1. Check if role already exists
            let role = interaction.guild.roles.cache.find(r => r.name === formattedRoleName);
            let roleWasCreated = false;

            if (role) {
                logger.info(`Role already exists: ${formattedRoleName} (${role.id})`);
            } else {
                // Create the role
                logger.info(`Creating role: ${formattedRoleName}`);
                role = await interaction.guild.roles.create({
                    name: formattedRoleName,
                    reason: `Created by ${interaction.user.tag} via /create-role command`
                });
                logger.info(`Role created: ${role.name} (${role.id})`);
                roleWasCreated = true;
            }

            // 2. Get the last message in the channel (before the command)
            const messages = await interaction.channel.messages.fetch({ limit: 10 });

            // Filter out the command interaction and find the last real message
            const lastMessage = messages
                .filter(msg => !msg.interaction && msg.author.id !== interaction.client.user.id)
                .first();

            if (!lastMessage) {
                await interaction.editReply({
                    content: `${config.emojis.error} Aucun message trouvé dans ce canal pour ajouter une réaction.`
                });
                return;
            }

            // 3. Add reaction to the message
            await lastMessage.react(emoji);
            logger.info(`Added reaction ${emoji} to message ${lastMessage.id}`);

            // 4. Store the mapping
            await addRoleReaction(
                interaction.guild.id,
                lastMessage.channel.id,
                lastMessage.id,
                emoji,
                role.id
            );

            const statusMessage = roleWasCreated
                ? `${config.emojis.success} Rôle **${role.name}** créé!\n`
                : `${config.emojis.success} Rôle **${role.name}** trouvé (déjà existant)!\n`;

            await interaction.editReply({
                content: statusMessage +
                    `Réaction ${emoji} ajoutée au [message précédent](${lastMessage.url}).\n` +
                    `Les utilisateurs qui réagiront avec ${emoji} obtiendront automatiquement ce rôle.`
            });

            logger.info(`Role reaction system set up for role ${role.name} on message ${lastMessage.id}`);

        } catch (error) {
            logger.error('Error in create-role command:', error);

            let errorMessage = `${config.emojis.error} Erreur lors de la création du rôle.`;

            if (error.code === 50013) {
                errorMessage += '\n**Permissions insuffisantes** - Vérifiez que le bot a la permission de gérer les rôles.';
            } else if (error.message.includes('Unknown Emoji')) {
                errorMessage += '\n**Emoji invalide** - Utilisez un emoji standard ou un emoji de ce serveur.';
            }

            await interaction.editReply({ content: errorMessage });
        }
    }
};
