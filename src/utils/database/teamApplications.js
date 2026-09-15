import { pgDb } from '../postgresDatabase.js';
import { pgConfig } from '../../config/database/postgres.js';

const t = pgConfig.tables;

const VALID_APPLICATION_STATUSES = new Set([
    'pending',
    'approved',
    'rejected',
    'cancelled',
]);

function ensureDatabaseAvailable() {
    if (!pgDb?.pool || !pgDb.isAvailable()) {
        throw new Error('PostgreSQL database is not available');
    }
}

function normalizeApplicationStatus(status) {
    const normalized = String(status || '').trim().toLowerCase();

    if (!VALID_APPLICATION_STATUSES.has(normalized)) {
        throw new Error(`Invalid team application status: ${status}`);
    }

    return normalized;
}

function normalizeCaptainIds(captainIds = []) {
    if (!Array.isArray(captainIds)) {
        throw new Error('Captain IDs must be an array');
    }

    const normalized = [
        ...new Set(
            captainIds
                .map(id => String(id || '').trim())
                .filter(Boolean),
        ),
    ];

    if (normalized.length > 2) {
        throw new Error('A team application can contain at most 2 captains');
    }

    return normalized;
}

/**
 * Creates a new pending HCD team application.
 */
export async function createTeamApplication({
    guildId,
    applicantId,
    name,
    tag = null,
    managerId = null,
    captainIds = [],
    discordUrl = null,
    logoUrl = null,
}) {
    ensureDatabaseAvailable();

    const normalizedCaptainIds = normalizeCaptainIds(captainIds);

    const result = await pgDb.pool.query(
        `INSERT INTO ${t.hcd_team_applications}
            (
                guild_id,
                applicant_id,
                name,
                tag,
                manager_id,
                captain_ids,
                discord_url,
                logo_url,
                status
            )
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, 'pending')
         RETURNING *`,
        [
            guildId,
            applicantId,
            name.trim(),
            tag?.trim() || null,
            managerId || null,
            JSON.stringify(normalizedCaptainIds),
            discordUrl?.trim() || null,
            logoUrl?.trim() || null,
        ],
    );

    return result.rows[0] || null;
}

/**
 * Returns an application by its internal database ID.
 */
export async function getTeamApplicationById(guildId, applicationId) {
    ensureDatabaseAvailable();

    const result = await pgDb.pool.query(
        `SELECT *
         FROM ${t.hcd_team_applications}
         WHERE guild_id = $1
           AND id = $2
         LIMIT 1`,
        [guildId, applicationId],
    );

    return result.rows[0] || null;
}

/**
 * Returns all pending team applications in a guild.
 */
export async function getPendingTeamApplications(guildId) {
    ensureDatabaseAvailable();

    const result = await pgDb.pool.query(
        `SELECT *
         FROM ${t.hcd_team_applications}
         WHERE guild_id = $1
           AND status = 'pending'
         ORDER BY created_at ASC`,
        [guildId],
    );

    return result.rows || [];
}

/**
 * Returns team applications submitted by one user.
 */
export async function getTeamApplicationsByApplicant(
    guildId,
    applicantId,
    { status = null } = {},
) {
    ensureDatabaseAvailable();

    const values = [guildId, applicantId];

    let query = `
        SELECT *
        FROM ${t.hcd_team_applications}
        WHERE guild_id = $1
          AND applicant_id = $2
    `;

    if (status) {
        const normalizedStatus = normalizeApplicationStatus(status);
        values.push(normalizedStatus);
        query += ` AND status = $${values.length}`;
    }

    query += ' ORDER BY created_at DESC';

    const result = await pgDb.pool.query(query, values);

    return result.rows || [];
}

/**
 * Returns an applicant's currently pending application, if one exists.
 *
 * This does not enforce a database-level uniqueness rule. It gives the
 * service layer a clean way to prevent accidental duplicate submissions
 * while still preserving application history.
 */
export async function getPendingTeamApplicationForApplicant(
    guildId,
    applicantId,
) {
    ensureDatabaseAvailable();

    const result = await pgDb.pool.query(
        `SELECT *
         FROM ${t.hcd_team_applications}
         WHERE guild_id = $1
           AND applicant_id = $2
           AND status = 'pending'
         ORDER BY created_at DESC
         LIMIT 1`,
        [guildId, applicantId],
    );

    return result.rows[0] || null;
}

/**
 * Updates editable application data while the application is pending.
 */
export async function updatePendingTeamApplication(
    guildId,
    applicationId,
    updates = {},
) {
    ensureDatabaseAvailable();

    const allowedFields = {
        name: 'name',
        tag: 'tag',
        managerId: 'manager_id',
        captainIds: 'captain_ids',
        discordUrl: 'discord_url',
        logoUrl: 'logo_url',
    };

    const assignments = [];
    const values = [];

    for (const [key, column] of Object.entries(allowedFields)) {
        if (updates[key] === undefined) {
            continue;
        }

        let value = updates[key];

        if (key === 'captainIds') {
            value = JSON.stringify(
                normalizeCaptainIds(value),
            );
            values.push(value);
            assignments.push(
                `${column} = $${values.length}::jsonb`,
            );
            continue;
        }

        if (key === 'name') {
            value = String(value || '').trim();
        }

        if (key === 'tag') {
            value = value?.trim() || null;
        }

        if (key === 'managerId') {
            value = value || null;
        }

        if (key === 'discordUrl' || key === 'logoUrl') {
            value = value?.trim() || null;
        }

        values.push(value);
        assignments.push(`${column} = $${values.length}`);
    }

    if (assignments.length === 0) {
        return getTeamApplicationById(
            guildId,
            applicationId,
        );
    }

    values.push(guildId);
    const guildIndex = values.length;

    values.push(applicationId);
    const applicationIndex = values.length;

    const result = await pgDb.pool.query(
        `UPDATE ${t.hcd_team_applications}
         SET ${assignments.join(', ')}
         WHERE guild_id = $${guildIndex}
           AND id = $${applicationIndex}
           AND status = 'pending'
         RETURNING *`,
        values,
    );

    return result.rows[0] || null;
}

/**
 * Marks a pending application as approved and links it to the
 * official HCD team created from it.
 */
export async function approveTeamApplication({
    guildId,
    applicationId,
    reviewedBy,
    teamId,
    reviewReason = null,
}) {
    ensureDatabaseAvailable();

    const result = await pgDb.pool.query(
        `UPDATE ${t.hcd_team_applications}
         SET status = 'approved',
             reviewed_by = $1,
             review_reason = $2,
             reviewed_at = CURRENT_TIMESTAMP,
             team_id = $3
         WHERE guild_id = $4
           AND id = $5
           AND status = 'pending'
         RETURNING *`,
        [
            reviewedBy,
            reviewReason?.trim() || null,
            teamId,
            guildId,
            applicationId,
        ],
    );

    return result.rows[0] || null;
}

/**
 * Rejects a pending application.
 */
export async function rejectTeamApplication({
    guildId,
    applicationId,
    reviewedBy,
    reviewReason = null,
}) {
    ensureDatabaseAvailable();

    const result = await pgDb.pool.query(
        `UPDATE ${t.hcd_team_applications}
         SET status = 'rejected',
             reviewed_by = $1,
             review_reason = $2,
             reviewed_at = CURRENT_TIMESTAMP
         WHERE guild_id = $3
           AND id = $4
           AND status = 'pending'
         RETURNING *`,
        [
            reviewedBy,
            reviewReason?.trim() || null,
            guildId,
            applicationId,
        ],
    );

    return result.rows[0] || null;
}

/**
 * Cancels a pending application.
 *
 * applicantId is required so a normal member can only cancel
 * their own application.
 */
export async function cancelTeamApplication(
    guildId,
    applicationId,
    applicantId,
) {
    ensureDatabaseAvailable();

    const result = await pgDb.pool.query(
        `UPDATE ${t.hcd_team_applications}
         SET status = 'cancelled'
         WHERE guild_id = $1
           AND id = $2
           AND applicant_id = $3
           AND status = 'pending'
         RETURNING *`,
        [
            guildId,
            applicationId,
            applicantId,
        ],
    );

    return result.rows[0] || null;
}
