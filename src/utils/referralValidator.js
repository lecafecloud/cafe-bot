import logger from './logger.js';
import { validatePendingReferrals } from './referralSystem.js';

/**
 * Start the referral validation job
 * Runs periodically to check and validate pending referrals
 */
export function startReferralValidationJob(client, intervalMinutes = 60) {
    logger.info(`Starting referral validation job (runs every ${intervalMinutes} minutes)`);

    // Run immediately on startup
    runValidation(client);

    // Then run periodically
    const intervalMs = intervalMinutes * 60 * 1000;
    const interval = setInterval(() => {
        runValidation(client);
    }, intervalMs);

    return interval;
}

/**
 * Stop the referral validation job
 */
export function stopReferralValidationJob(interval) {
    if (interval) {
        clearInterval(interval);
        logger.info('Referral validation job stopped');
    }
}

/**
 * Run validation for all guilds
 */
async function runValidation(client) {
    try {
        logger.debug('Running referral validation job...');

        for (const guild of client.guilds.cache.values()) {
            try {
                const validated = await validatePendingReferrals(guild);

                if (validated.length > 0) {
                    logger.info(`🎉 Validated ${validated.length} referral(s) in ${guild.name}`);

                    // Notify referrers
                    for (const { referrerId, referredTag } of validated) {
                        try {
                            const referrer = await guild.members.fetch(referrerId);
                            await referrer.send(
                                `🎉 **Filleul validé !**\n\n` +
                                `${referredTag} a rempli toutes les conditions et est maintenant validé comme ton filleul.\n\n` +
                                `Utilise \`/filleuls\` pour voir tes filleuls et récompenses !`
                            );
                        } catch (error) {
                            logger.warn(`Could not DM referrer ${referrerId}:`, error.message);
                        }
                    }
                }
            } catch (error) {
                logger.error(`Error validating referrals for guild ${guild.name}:`, error);
            }
        }

        logger.debug('Referral validation job completed');
    } catch (error) {
        logger.error('Error in referral validation job:', error);
    }
}
