import { logger } from '../utils/logger.js';
import { createError, ErrorTypes } from '../utils/errorHandler.js';

const TEAM_LIMITS = Object.freeze({
    captain: 2,
    main: 4,
    sub: 3,
});

const TEAM_POSITIONS = Object.freeze([
    'captain',
    'main',
    'sub',
]);

const TEAM_MAX_MEMBERS = 9;
const TEAM_INVITE_EXPIRATION_MS = 24 * 60 * 60 * 1000;

class TeamService {
    /**
     * Returns the maximum number of players allowed in a position.
     */
    static getPositionLimit(position) {
        this.validatePosition(position);
        return TEAM_LIMITS[position];
    }

    /**
     * Validates a competitive roster position.
     */
    static validatePosition(position) {
        if (!TEAM_POSITIONS.includes(position)) {
            throw createError(
                'Invalid team position',
                ErrorTypes.VALIDATION,
                'Position must be captain, main, or sub.',
                { position },
            );
        }

        return true;
    }

    /**
     * Validates the basic information required to create a team.
     */
    static validateTeamData(data) {
        if (!data || typeof data !== 'object') {
            throw createError(
                'Missing team data',
                ErrorTypes.VALIDATION,
                'Invalid team data.',
            );
        }

        const {
            guildId,
            name,
            managerId,
        } = data;

        if (!guildId || !name || !managerId) {
            throw createError(
                'Missing required team fields',
                ErrorTypes.VALIDATION,
                'Guild, team name, and Team Manager are required.',
                {
                    guildId,
                    name,
                    managerId,
                },
            );
        }

        const cleanName = String(name).trim();

        if (cleanName.length < 2 || cleanName.length > 100) {
            throw createError(
                'Invalid team name length',
                ErrorTypes.VALIDATION,
                'Team name must contain between 2 and 100 characters.',
                { nameLength: cleanName.length },
            );
        }

        if (data.tag) {
            const cleanTag = String(data.tag).trim();

            if (cleanTag.length > 20) {
                throw createError(
                    'Invalid team tag length',
                    ErrorTypes.VALIDATION,
                    'Team tag cannot contain more than 20 characters.',
                    { tagLength: cleanTag.length },
                );
            }
        }

        return true;
    }

    /**
     * Validates the data required to invite a player.
     */
    static validateInviteData(data) {
        if (!data || typeof data !== 'object') {
            throw createError(
                'Missing team invite data',
                ErrorTypes.VALIDATION,
                'Invalid team invitation data.',
            );
        }

        const {
            guildId,
            teamId,
            userId,
            invitedBy,
            position,
        } = data;

        if (!guildId || !teamId || !userId || !invitedBy || !position) {
            throw createError(
                'Missing required team invite fields',
                ErrorTypes.VALIDATION,
                'The team invitation is missing required information.',
                {
                    guildId,
                    teamId,
                    userId,
                    invitedBy,
                    position,
                },
            );
        }

        this.validatePosition(position);

        if (userId === invitedBy) {
            throw createError(
                'User attempted to invite themselves',
                ErrorTypes.VALIDATION,
                'You cannot invite yourself to a team.',
                {
                    userId,
                    teamId,
                },
            );
        }

        return true;
    }

    /**
     * Counts the occupied slots in a roster.
     */
    static getRosterCounts(members = []) {
        const counts = {
            captain: 0,
            main: 0,
            sub: 0,
            total: 0,
        };

        for (const member of members) {
            if (!member || !TEAM_POSITIONS.includes(member.position)) {
                continue;
            }

            counts[member.position] += 1;
            counts.total += 1;
        }

        return counts;
    }

    /**
     * Checks whether a roster position still has space.
     */
    static hasAvailableSlot(members = [], position) {
        this.validatePosition(position);

        const counts = this.getRosterCounts(members);

        return (
            counts[position] < TEAM_LIMITS[position] &&
            counts.total < TEAM_MAX_MEMBERS
        );
    }

    /**
     * Throws an error if the requested position is already full.
     */
    static assertAvailableSlot(members = [], position) {
        this.validatePosition(position);

        const counts = this.getRosterCounts(members);
        const positionLimit = TEAM_LIMITS[position];

        if (counts[position] >= positionLimit) {
            throw createError(
                'Team position is full',
                ErrorTypes.VALIDATION,
                `There are no available ${position} slots in this team.`,
                {
                    position,
                    current: counts[position],
                    limit: positionLimit,
                },
            );
        }

        if (counts.total >= TEAM_MAX_MEMBERS) {
            throw createError(
                'Team roster is full',
                ErrorTypes.VALIDATION,
                'This team already has 9 competitive players.',
                {
                    current: counts.total,
                    limit: TEAM_MAX_MEMBERS,
                },
            );
        }

        return true;
    }

    /**
     * Checks whether a user is allowed to manage a team.
     *
     * Team Manager:
     * - Full roster control.
     *
     * Captain:
     * - Can manage Main and Substitute players.
     * - Cannot manage another Captain.
     *
     * Staff:
     * - Full override.
     */
    static assertManagementPermission({
        executorId,
        team,
        executorMembership = null,
        targetPosition = null,
        isStaff = false,
    }) {
        if (!executorId || !team) {
            throw createError(
                'Missing team permission context',
                ErrorTypes.VALIDATION,
                'Unable to verify team management permissions.',
            );
        }

        if (isStaff || executorId === team.manager_id) {
            return true;
        }

        const isCaptain =
            executorMembership?.user_id === executorId &&
            executorMembership?.position === 'captain';

        if (!isCaptain) {
            throw createError(
                'User cannot manage team',
                ErrorTypes.PERMISSION,
                'You do not have permission to manage this team.',
                {
                    executorId,
                    teamId: team.id,
                },
            );
        }

        if (targetPosition === 'captain') {
            throw createError(
                'Captain attempted to manage another captain',
                ErrorTypes.PERMISSION,
                'Only the Team Manager or HCD Staff can manage Captain slots.',
                {
                    executorId,
                    teamId: team.id,
                },
            );
        }

        return true;
    }

    /**
     * Returns the expiration date for a new invitation.
     */
    static createInviteExpiration() {
        return new Date(Date.now() + TEAM_INVITE_EXPIRATION_MS);
    }

    /**
     * Checks whether an invitation has expired.
     */
    static isInviteExpired(invite) {
        if (!invite?.expires_at) {
            return true;
        }

        return new Date(invite.expires_at).getTime() <= Date.now();
    }

    /**
     * Validates that an invitation can still be processed.
     */
    static validatePendingInvite(invite, userId = null) {
        if (!invite) {
            throw createError(
                'Team invitation not found',
                ErrorTypes.VALIDATION,
                'This team invitation does not exist.',
            );
        }

        if (userId && invite.user_id !== userId) {
            throw createError(
                'Team invitation belongs to another user',
                ErrorTypes.PERMISSION,
                'This team invitation does not belong to you.',
                {
                    userId,
                    inviteUserId: invite.user_id,
                },
            );
        }

        if (invite.status !== 'pending') {
            throw createError(
                'Team invitation is no longer pending',
                ErrorTypes.VALIDATION,
                'This team invitation has already been processed.',
                {
                    inviteId: invite.id,
                    status: invite.status,
                },
            );
        }

        if (this.isInviteExpired(invite)) {
            throw createError(
                'Team invitation expired',
                ErrorTypes.VALIDATION,
                'This team invitation has expired.',
                {
                    inviteId: invite.id,
                },
            );
        }

        this.validatePosition(invite.position);

        return true;
    }

    /**
     * Formats roster information for commands and embeds.
     */
    static buildRosterSummary(members = []) {
        const captains = members.filter(
            (member) => member.position === 'captain',
        );

        const mains = members.filter(
            (member) => member.position === 'main',
        );

        const substitutes = members.filter(
            (member) => member.position === 'sub',
        );

        return {
            captains,
            mains,
            substitutes,
            counts: {
                captain: captains.length,
                main: mains.length,
                sub: substitutes.length,
                total:
                    captains.length +
                    mains.length +
                    substitutes.length,
            },
            limits: {
                ...TEAM_LIMITS,
                total: TEAM_MAX_MEMBERS,
            },
        };
    }

    /**
     * Logs a team-related service error and rethrows it.
     */
    static handleError(action, error, metadata = {}) {
        logger.error(`Team service error: ${action}`, {
            error: error.message,
            stack: error.stack,
            ...metadata,
        });

        throw error;
    }
}

export {
    TEAM_LIMITS,
    TEAM_POSITIONS,
    TEAM_MAX_MEMBERS,
    TEAM_INVITE_EXPIRATION_MS,
};

export default TeamService;
