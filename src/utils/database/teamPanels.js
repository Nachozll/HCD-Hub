import { pgDb } from '../postgresDatabase.js';
import { pgConfig } from '../../config/database/postgres.js';
import { logger } from '../logger.js';

const t = pgConfig.tables;

function ensureDatabaseAvailable() {
    if (!pgDb?.pool || !pgDb.isAvailable()) {
        throw new Error('PostgreSQL database is not available');
    }
}

/**
 * Returns the saved public HCD teams panel for a guild.
 */
export async function getTeamPanel(guildId) {
    ensureDatabaseAvailable();

    const result = await pgDb.pool.query(
        `SELECT *
         FROM ${t.hcd_team_panels}
         WHERE guild_id = $1
         LIMIT 1`,
        [guildId],
    );

    return result.rows[0] || null;
}

/**
 * Creates or replaces the saved public HCD teams panel.
 *
 * One guild can only have one official teams panel.
 */
export async function saveTeamPanel({
    guildId,
    channelId,
    messageId,
}) {
    ensureDatabaseAvailable();

    const result = await pgDb.pool.query(
        `INSERT INTO ${t.hcd_team_panels}
            (
                guild_id,
                channel_id,
                message_id
            )
         VALUES ($1, $2, $3)
         ON CONFLICT (guild_id)
         DO UPDATE SET
            channel_id = EXCLUDED.channel_id,
            message_id = EXCLUDED.message_id,
            updated_at = NOW()
         RETURNING *`,
        [
            guildId,
            channelId,
            messageId,
        ],
    );

    logger.info('HCD teams panel saved', {
        guildId,
        channelId,
        messageId,
    });

    return result.rows[0] || null;
}

/**
 * Removes the saved teams panel reference for a guild.
 *
 * This does not delete the Discord message itself.
 */
export async function deleteTeamPanel(guildId) {
    ensureDatabaseAvailable();

    const result = await pgDb.pool.query(
        `DELETE FROM ${t.hcd_team_panels}
         WHERE guild_id = $1
         RETURNING *`,
        [guildId],
    );

    const deleted = result.rows[0] || null;

    if (deleted) {
        logger.info('HCD teams panel reference deleted', {
            guildId,
            channelId: deleted.channel_id,
            messageId: deleted.message_id,
        });
    }

    return deleted;
}
