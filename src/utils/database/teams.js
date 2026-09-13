import { pgDb } from '../postgresDatabase.js';
import { pgConfig } from '../../config/database/postgres.js';
import { logger } from '../logger.js';

const t = pgConfig.tables;

const POSITION_LIMITS = Object.freeze({
    captain: 2,
    main: 4,
    sub: 3,
});

const VALID_POSITIONS = new Set([
    'captain',
    'main',
    'sub',
]);

const VALID_INVITE_STATUSES = new Set([
    'pending',
    'accepted',
    'declined',
    'expired',
    'cancelled',
]);

function ensureDatabaseAvailable() {
    if (!pgDb?.pool || !pgDb.isAvailable()) {
        throw new Error('PostgreSQL database is not available');
    }
}

function normalizePosition(position) {
    const normalized = String(position || '').trim().toLowerCase();

    if (!VALID_POSITIONS.has(normalized)) {
        throw new Error(`Invalid team position: ${position}`);
    }

    return normalized;
}

function normalizeInviteStatus(status) {
    const normalized = String(status || '').trim().toLowerCase();

    if (!VALID_INVITE_STATUSES.has(normalized)) {
        throw new Error(`Invalid team invite status: ${status}`);
    }

    return normalized;
}

/**
 * Creates a new HCD team.
 */
export async function createTeam({
    guildId,
    name,
    tag = null,
    managerId,
    roleId = null,
    discordUrl = null,
    logoUrl = null,
    buttonEmoji = null,
}) {
    ensureDatabaseAvailable();

    const result = await pgDb.pool.query(
        `INSERT INTO ${t.hcd_teams}
            (
                guild_id,
                name,
                tag,
                manager_id,
                role_id,
                discord_url,
                logo_url,
                button_emoji
            )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
            guildId,
            name.trim(),
            tag?.trim() || null,
            managerId,
            roleId,
            discordUrl,
            logoUrl,
            buttonEmoji,
        ],
    );

    return result.rows[0] || null;
}

/**
 * Returns a team by its internal database ID.
 */
export async function getTeamById(guildId, teamId) {
    ensureDatabaseAvailable();

    const result = await pgDb.pool.query(
        `SELECT *
         FROM ${t.hcd_teams}
         WHERE guild_id = $1
           AND id = $2
         LIMIT 1`,
        [guildId, teamId],
    );

    return result.rows[0] || null;
}

/**
 * Returns a team by its name.
 * Matching is case-insensitive.
 */
export async function getTeamByName(guildId, name) {
    ensureDatabaseAvailable();

    const result = await pgDb.pool.query(
        `SELECT *
         FROM ${t.hcd_teams}
         WHERE guild_id = $1
           AND LOWER(name) = LOWER($2)
         LIMIT 1`,
        [guildId, name.trim()],
    );

    return result.rows[0] || null;
}

/**
 * Returns all active teams in a guild.
 */
export async function getActiveTeams(guildId) {
    ensureDatabaseAvailable();

    const result = await pgDb.pool.query(
        `SELECT *
         FROM ${t.hcd_teams}
         WHERE guild_id = $1
           AND active = TRUE
         ORDER BY name ASC`,
        [guildId],
    );

    return result.rows || [];
}

/**
 * Updates editable information for a team.
 */
export async function updateTeam(guildId, teamId, updates = {}) {
    ensureDatabaseAvailable();

    const allowedFields = {
        name: 'name',
        tag: 'tag',
        managerId: 'manager_id',
        roleId: 'role_id',
        discordUrl: 'discord_url',
        logoUrl: 'logo_url',
        buttonEmoji: 'button_emoji',
        active: 'active',
    };

    const assignments = [];
    const values = [];

    for (const [key, column] of Object.entries(allowedFields)) {
        if (updates[key] === undefined) {
            continue;
        }

        values.push(updates[key]);
        assignments.push(`${column} = $${values.length}`);
    }

    if (assignments.length === 0) {
        return getTeamById(guildId, teamId);
    }

    values.push(guildId);
    const guildIndex = values.length;

    values.push(teamId);
    const teamIndex = values.length;

    const result = await pgDb.pool.query(
        `UPDATE ${t.hcd_teams}
         SET ${assignments.join(', ')}
         WHERE guild_id = $${guildIndex}
           AND id = $${teamIndex}
         RETURNING *`,
        values,
    );

    return result.rows[0] || null;
}

/**
 * Soft-disables a team instead of deleting its history.
 */
export async function deactivateTeam(guildId, teamId) {
    return updateTeam(guildId, teamId, {
        active: false,
    });
}

/**
 * Returns the complete competitive roster for a team.
 */
export async function getTeamRoster(guildId, teamId) {
    ensureDatabaseAvailable();

    const result = await pgDb.pool.query(
        `SELECT *
         FROM ${t.hcd_team_members}
         WHERE guild_id = $1
           AND team_id = $2
         ORDER BY
            CASE position
                WHEN 'captain' THEN 1
                WHEN 'main' THEN 2
                WHEN 'sub' THEN 3
                ELSE 4
            END,
            joined_at ASC`,
        [guildId, teamId],
    );

    return result.rows || [];
}

/**
 * Returns a player's team membership.
 *
 * UNIQUE(guild_id, user_id) means a player can only belong
 * to one competitive HCD roster at a time.
 */
export async function getPlayerMembership(guildId, userId) {
    ensureDatabaseAvailable();

    const result = await pgDb.pool.query(
        `SELECT
            m.*,
            t.name AS team_name,
            t.tag AS team_tag,
            t.manager_id AS team_manager_id,
            t.role_id AS team_role_id,
            t.active AS team_active
         FROM ${t.hcd_team_members} m
         JOIN ${t.hcd_teams} t
           ON t.id = m.team_id
          AND t.guild_id = m.guild_id
         WHERE m.guild_id = $1
           AND m.user_id = $2
         LIMIT 1`,
        [guildId, userId],
    );

    return result.rows[0] || null;
}

/**
 * Returns a specific membership inside a team.
 */
export async function getTeamMember(guildId, teamId, userId) {
    ensureDatabaseAvailable();

    const result = await pgDb.pool.query(
        `SELECT *
         FROM ${t.hcd_team_members}
         WHERE guild_id = $1
           AND team_id = $2
           AND user_id = $3
         LIMIT 1`,
        [guildId, teamId, userId],
    );

    return result.rows[0] || null;
}

/**
 * Returns how many players currently occupy each position.
 */
export async function getRosterCounts(guildId, teamId, queryable = pgDb.pool) {
    const result = await queryable.query(
        `SELECT
            COUNT(*) FILTER (WHERE position = 'captain')::int AS captain,
            COUNT(*) FILTER (WHERE position = 'main')::int AS main,
            COUNT(*) FILTER (WHERE position = 'sub')::int AS sub,
            COUNT(*)::int AS total
         FROM ${t.hcd_team_members}
         WHERE guild_id = $1
           AND team_id = $2`,
        [guildId, teamId],
    );

    return result.rows[0] || {
        captain: 0,
        main: 0,
        sub: 0,
        total: 0,
    };
}

/**
 * Creates a pending team invitation.
 */
export async function createTeamInvite({
    guildId,
    teamId,
    userId,
    invitedBy,
    position,
    expiresAt,
}) {
    ensureDatabaseAvailable();

    const normalizedPosition = normalizePosition(position);

    const result = await pgDb.pool.query(
        `INSERT INTO ${t.hcd_team_invites}
            (
                guild_id,
                team_id,
                user_id,
                invited_by,
                position,
                status,
                expires_at
            )
         VALUES ($1, $2, $3, $4, $5, 'pending', $6)
         RETURNING *`,
        [
            guildId,
            teamId,
            userId,
            invitedBy,
            normalizedPosition,
            expiresAt,
        ],
    );

    return result.rows[0] || null;
}

/**
 * Returns an invitation by ID.
 */
export async function getTeamInviteById(guildId, inviteId) {
    ensureDatabaseAvailable();

    const result = await pgDb.pool.query(
        `SELECT
            i.*,
            t.name AS team_name,
            t.tag AS team_tag,
            t.role_id AS team_role_id,
            t.manager_id AS team_manager_id
         FROM ${t.hcd_team_invites} i
         JOIN ${t.hcd_teams} t
           ON t.id = i.team_id
          AND t.guild_id = i.guild_id
         WHERE i.guild_id = $1
           AND i.id = $2
         LIMIT 1`,
        [guildId, inviteId],
    );

    return result.rows[0] || null;
}

/**
 * Returns pending invitations for a player.
 */
export async function getPendingInvitesForUser(guildId, userId) {
    ensureDatabaseAvailable();

    const result = await pgDb.pool.query(
        `SELECT
            i.*,
            t.name AS team_name,
            t.tag AS team_tag,
            t.role_id AS team_role_id
         FROM ${t.hcd_team_invites} i
         JOIN ${t.hcd_teams} t
           ON t.id = i.team_id
          AND t.guild_id = i.guild_id
         WHERE i.guild_id = $1
           AND i.user_id = $2
           AND i.status = 'pending'
           AND i.expires_at > NOW()
         ORDER BY i.created_at DESC`,
        [guildId, userId],
    );

    return result.rows || [];
}

/**
 * Returns an existing active pending invite for the same
 * player/team combination.
 */
export async function getPendingTeamInvite(guildId, teamId, userId) {
    ensureDatabaseAvailable();

    const result = await pgDb.pool.query(
        `SELECT *
         FROM ${t.hcd_team_invites}
         WHERE guild_id = $1
           AND team_id = $2
           AND user_id = $3
           AND status = 'pending'
           AND expires_at > NOW()
         ORDER BY created_at DESC
         LIMIT 1`,
        [guildId, teamId, userId],
    );

    return result.rows[0] || null;
}

/**
 * Changes an invitation status.
 */
export async function updateTeamInviteStatus(
    guildId,
    inviteId,
    status,
) {
    ensureDatabaseAvailable();

    const normalizedStatus = normalizeInviteStatus(status);

    const result = await pgDb.pool.query(
        `UPDATE ${t.hcd_team_invites}
         SET status = $1
         WHERE guild_id = $2
           AND id = $3
         RETURNING *`,
        [
            normalizedStatus,
            guildId,
            inviteId,
        ],
    );

    return result.rows[0] || null;
}

/**
 * Marks all expired pending invitations as expired.
 */
export async function expireTeamInvites(guildId = null) {
    ensureDatabaseAvailable();

    if (guildId) {
        const result = await pgDb.pool.query(
            `UPDATE ${t.hcd_team_invites}
             SET status = 'expired'
             WHERE guild_id = $1
               AND status = 'pending'
               AND expires_at <= NOW()
             RETURNING id`,
            [guildId],
        );

        return result.rowCount || 0;
    }

    const result = await pgDb.pool.query(
        `UPDATE ${t.hcd_team_invites}
         SET status = 'expired'
         WHERE status = 'pending'
           AND expires_at <= NOW()
         RETURNING id`,
    );

    return result.rowCount || 0;
}

/**
 * Declines a pending invitation.
 */
export async function declineTeamInvite(guildId, inviteId, userId) {
    ensureDatabaseAvailable();

    const result = await pgDb.pool.query(
        `UPDATE ${t.hcd_team_invites}
         SET status = 'declined'
         WHERE guild_id = $1
           AND id = $2
           AND user_id = $3
           AND status = 'pending'
           AND expires_at > NOW()
         RETURNING *`,
        [
            guildId,
            inviteId,
            userId,
        ],
    );

    return result.rows[0] || null;
}

/**
 * Accepts an invitation using a PostgreSQL transaction.
 *
 * The team row is locked while the invitation is processed.
 * This prevents two users from taking the same final slot
 * simultaneously.
 */
export async function acceptTeamInvite(guildId, inviteId, userId) {
    ensureDatabaseAvailable();

    const connection = await pgDb.pool.connect();

    try {
        await connection.query('BEGIN');

        const inviteResult = await connection.query(
            `SELECT *
             FROM ${t.hcd_team_invites}
             WHERE guild_id = $1
               AND id = $2
               AND user_id = $3
             FOR UPDATE`,
            [
                guildId,
                inviteId,
                userId,
            ],
        );

        const invite = inviteResult.rows[0];

        if (!invite) {
            throw new Error('Team invitation not found');
        }

        if (invite.status !== 'pending') {
            throw new Error('Team invitation is no longer pending');
        }

        if (new Date(invite.expires_at).getTime() <= Date.now()) {
            await connection.query(
                `UPDATE ${t.hcd_team_invites}
                 SET status = 'expired'
                 WHERE id = $1`,
                [invite.id],
            );

            await connection.query('COMMIT');

            return {
                accepted: false,
                reason: 'expired',
                invite: {
                    ...invite,
                    status: 'expired',
                },
            };
        }

        const position = normalizePosition(invite.position);

        const teamResult = await connection.query(
            `SELECT *
             FROM ${t.hcd_teams}
             WHERE guild_id = $1
               AND id = $2
               AND active = TRUE
             FOR UPDATE`,
            [
                guildId,
                invite.team_id,
            ],
        );

        const team = teamResult.rows[0];

        if (!team) {
            throw new Error('Team not found or inactive');
        }

        const existingMembershipResult = await connection.query(
            `SELECT *
             FROM ${t.hcd_team_members}
             WHERE guild_id = $1
               AND user_id = $2
             LIMIT 1`,
            [
                guildId,
                userId,
            ],
        );

        if (existingMembershipResult.rows[0]) {
            await connection.query('ROLLBACK');

            return {
                accepted: false,
                reason: 'already_in_team',
                membership: existingMembershipResult.rows[0],
            };
        }

        const counts = await getRosterCounts(
            guildId,
            team.id,
            connection,
        );

        const positionLimit = POSITION_LIMITS[position];

        if (
            counts[position] >= positionLimit ||
            counts.total >= 9
        ) {
            await connection.query(
                `UPDATE ${t.hcd_team_invites}
                 SET status = 'cancelled'
                 WHERE id = $1`,
                [invite.id],
            );

            await connection.query('COMMIT');

            return {
                accepted: false,
                reason: 'slot_full',
                position,
                counts,
            };
        }

        const memberResult = await connection.query(
            `INSERT INTO ${t.hcd_team_members}
                (
                    guild_id,
                    team_id,
                    user_id,
                    position
                )
             VALUES ($1, $2, $3, $4)
             RETURNING *`,
            [
                guildId,
                team.id,
                userId,
                position,
            ],
        );

        await connection.query(
            `UPDATE ${t.hcd_team_invites}
             SET status = 'accepted'
             WHERE id = $1`,
            [invite.id],
        );

        await connection.query(
            `UPDATE ${t.hcd_team_invites}
             SET status = 'cancelled'
             WHERE guild_id = $1
               AND user_id = $2
               AND id <> $3
               AND status = 'pending'`,
            [
                guildId,
                userId,
                invite.id,
            ],
        );

        await connection.query('COMMIT');

        return {
            accepted: true,
            team,
            member: memberResult.rows[0],
            invite: {
                ...invite,
                status: 'accepted',
            },
        };
    } catch (error) {
        try {
            await connection.query('ROLLBACK');
        } catch (rollbackError) {
            logger.error('Failed to rollback team invite transaction', {
                error: rollbackError.message,
            });
        }

        logger.error('Failed to accept HCD team invitation', {
            guildId,
            inviteId,
            userId,
            error: error.message,
        });

        throw error;
    } finally {
        connection.release();
    }
}

/**
 * Removes a player from a competitive roster.
 */
export async function removeTeamMember(guildId, teamId, userId) {
    ensureDatabaseAvailable();

    const result = await pgDb.pool.query(
        `DELETE FROM ${t.hcd_team_members}
         WHERE guild_id = $1
           AND team_id = $2
           AND user_id = $3
         RETURNING *`,
        [
            guildId,
            teamId,
            userId,
        ],
    );

    return result.rows[0] || null;
}

/**
 * Moves a roster member to another competitive position.
 *
 * Uses a transaction and locks the team row before checking
 * the destination slot.
 */
export async function moveTeamMember(
    guildId,
    teamId,
    userId,
    newPosition,
) {
    ensureDatabaseAvailable();

    const position = normalizePosition(newPosition);
    const connection = await pgDb.pool.connect();

    try {
        await connection.query('BEGIN');

        const teamResult = await connection.query(
            `SELECT *
             FROM ${t.hcd_teams}
             WHERE guild_id = $1
               AND id = $2
               AND active = TRUE
             FOR UPDATE`,
            [
                guildId,
                teamId,
            ],
        );

        if (!teamResult.rows[0]) {
            throw new Error('Team not found or inactive');
        }

        const memberResult = await connection.query(
            `SELECT *
             FROM ${t.hcd_team_members}
             WHERE guild_id = $1
               AND team_id = $2
               AND user_id = $3
             FOR UPDATE`,
            [
                guildId,
                teamId,
                userId,
            ],
        );

        const member = memberResult.rows[0];

        if (!member) {
            throw new Error('Team member not found');
        }

        if (member.position === position) {
            await connection.query('COMMIT');

            return {
                moved: true,
                unchanged: true,
                member,
            };
        }

        const counts = await getRosterCounts(
            guildId,
            teamId,
            connection,
        );

        if (counts[position] >= POSITION_LIMITS[position]) {
            await connection.query('ROLLBACK');

            return {
                moved: false,
                reason: 'slot_full',
                position,
                counts,
            };
        }

        const updateResult = await connection.query(
            `UPDATE ${t.hcd_team_members}
             SET position = $1
             WHERE guild_id = $2
               AND team_id = $3
               AND user_id = $4
             RETURNING *`,
            [
                position,
                guildId,
                teamId,
                userId,
            ],
        );

        await connection.query('COMMIT');

        return {
            moved: true,
            unchanged: false,
            member: updateResult.rows[0],
        };
    } catch (error) {
        try {
            await connection.query('ROLLBACK');
        } catch (rollbackError) {
            logger.error('Failed to rollback team move transaction', {
                error: rollbackError.message,
            });
        }

        logger.error('Failed to move HCD team member', {
            guildId,
            teamId,
            userId,
            newPosition: position,
            error: error.message,
        });

        throw error;
    } finally {
        connection.release();
    }
}

/**
 * Cancels every pending invitation belonging to a team.
 */
export async function cancelPendingTeamInvites(guildId, teamId) {
    ensureDatabaseAvailable();

    const result = await pgDb.pool.query(
        `UPDATE ${t.hcd_team_invites}
         SET status = 'cancelled'
         WHERE guild_id = $1
           AND team_id = $2
           AND status = 'pending'
         RETURNING id`,
        [
            guildId,
            teamId,
        ],
    );

    return result.rowCount || 0;
}
