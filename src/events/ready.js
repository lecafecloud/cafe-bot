import { ActivityType } from 'discord.js';
import logger from '../utils/logger.js';
import chalk from 'chalk';
import { initializeScheduler } from '../utils/scheduler.js';

export default {
    name: 'clientReady',
    once: true,

    async execute(client) {
        logger.info(`${chalk.green('✓')} Logged in as ${chalk.blue(client.user.tag)}`);
        logger.info(`${chalk.yellow('→')} Serving ${chalk.cyan(client.guilds.cache.size)} guilds`);
        logger.info(`${chalk.yellow('→')} Loaded ${chalk.cyan(client.commands.size)} commands`);

        // Initialize the cron scheduler for daily posts
        initializeScheduler(client);
        logger.info(`${chalk.yellow('→')} Scheduled daily post at 13:00 Paris time`);

        client.user.setPresence({
            activities: [{
                name: `${client.guilds.cache.size} servers`,
                type: ActivityType.Watching
            }],
            status: 'online'
        });

        setInterval(() => {
            const activities = [
                { name: `${client.guilds.cache.size} servers`, type: ActivityType.Watching },
                { name: '/help', type: ActivityType.Listening },
                { name: 'with Discord.js', type: ActivityType.Playing }
            ];

            const randomActivity = activities[Math.floor(Math.random() * activities.length)];
            client.user.setActivity(randomActivity.name, { type: randomActivity.type });
        }, 300000);
    }
};