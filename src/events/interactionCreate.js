import { Collection, EmbedBuilder } from 'discord.js';
import config from '../config/config.js';
import logger from '../utils/logger.js';

export default {
    name: 'interactionCreate',

    async execute(interaction, client) {
        if (interaction.isCommand()) {
            const command = client.commands.get(interaction.commandName);

            if (!command) {
                logger.warn(`Command ${interaction.commandName} not found`);
                return;
            }

            const { cooldowns } = client;
            if (!cooldowns.has(command.data.name)) {
                cooldowns.set(command.data.name, new Collection());
            }

            const now = Date.now();
            const timestamps = cooldowns.get(command.data.name);
            const cooldownAmount = (command.cooldown || config.defaultCooldown) * 1000;

            if (timestamps.has(interaction.user.id)) {
                const expirationTime = timestamps.get(interaction.user.id) + cooldownAmount;

                if (now < expirationTime) {
                    const timeLeft = (expirationTime - now) / 1000;
                    return interaction.reply({
                        content: `${config.emojis.warning} Please wait ${timeLeft.toFixed(1)} seconds before using \`${command.data.name}\` again.`,
                        ephemeral: true
                    });
                }
            }

            timestamps.set(interaction.user.id, now);
            setTimeout(() => timestamps.delete(interaction.user.id), cooldownAmount);

            try {
                await command.execute(interaction, client);
                logger.info(`Command ${command.data.name} executed by ${interaction.user.tag}`);
            } catch (error) {
                logger.error(`Error executing command ${command.data.name}:`, error);

                const errorEmbed = new EmbedBuilder()
                    .setTitle('Command Error')
                    .setDescription('There was an error executing this command.')
                    .setColor(config.colors.error)
                    .setTimestamp();

                const errorMessage = { embeds: [errorEmbed], ephemeral: true };

                if (interaction.deferred || interaction.replied) {
                    await interaction.followUp(errorMessage);
                } else {
                    await interaction.reply(errorMessage);
                }
            }
        }

        if (interaction.isStringSelectMenu()) {
            if (interaction.customId === 'help_category') {
                const category = interaction.values[0];
                const commands = client.commands.filter(cmd => cmd.category === category);

                const embed = new EmbedBuilder()
                    .setTitle(`${category.charAt(0).toUpperCase() + category.slice(1)} Commands`)
                    .setDescription(commands.map(cmd => `**/${cmd.data.name}** - ${cmd.data.description}`).join('\n'))
                    .setColor(config.colors.info)
                    .setFooter({ text: 'Use /help <command> for more details' });

                await interaction.update({ embeds: [embed] });
            }
        }

        if (interaction.isAutocomplete()) {
            const command = client.commands.get(interaction.commandName);

            if (!command || !command.autocomplete) {
                return;
            }

            try {
                await command.autocomplete(interaction, client);
            } catch (error) {
                logger.error(`Error in autocomplete for ${interaction.commandName}:`, error);
            }
        }
    }
};