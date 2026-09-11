import { logger } from '../utils/logger.js';
import { createError, ErrorTypes } from '../utils/errorHandler.js';
import {
    createTeam,
    getTeamById,
    getTeamByName,
    getActiveTeams,
    updateTeam,
    getTeamRoster,
    getPlayerMembership,
    getTeamMember,
    getPendingTeamInvite,
    createTeamInvite,
    getTeamInviteById,
    acceptTeamInvite,
    declineTeamInvite,
    removeTeamMember,
    moveTeamMember,
    expireTeamInvites,
} from '../utils/database/teams.js';

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
     * Creates a new HCD team.
     */
    static async create(data) {
        try {
            this.validateTeamData(data);

            const existingTeam = await getTeamByName(
                data.guildId,
                data.name,
            );

            if (existingTeam) {
                throw createError(
                    'Team already exists',
                    ErrorTypes.VALIDATION,
                    'A team with this name already exists.',
                    {
                        guildId: data.guildId,
                        name: data.name,
                    },
                );
            }

            const team = await createTeam({
                guildId: data.guildId,
                name: String(data.name).trim(),
                tag: data.tag
                    ? String(data.tag).trim()
                    : null,
                managerId: data.managerId,
                roleId: data.roleId || null,
                discordUrl: data.discordUrl || null,
                logoUrl: data.logoUrl || null,
            });

            logger.info('HCD team created', {
                guildId: data.guildId,
                teamId: team?.id,
                name: team?.name,
                managerId: data.managerId,
            });

            return team;
        } catch (error) {
            return this.handleError(
                'create team',
                error,
                {
                    guildId: data?.guildId,
                    name: data?.name,
                },
            );
        }
    }

    /**
     * Returns an HCD team.
     */
    /**
 * Updates an existing HCD team.
 */
static async update({
    guildId,
    teamId,
    name = undefined,
    tag = undefined,
    managerId = undefined,
    roleId = undefined,
    discordUrl = undefined,
    logoUrl = undefined,
}) {
    try {
        const team = await this.get(
            guildId,
            teamId,
        );

        const updates = {};

        if (name !== undefined) {
            const cleanName = String(name).trim();

            if (
                cleanName.length < 2 ||
                cleanName.length > 100
            ) {
                throw createError(
                    'Invalid team name length',
                    ErrorTypes.VALIDATION,
                    'Team name must contain between 2 and 100 characters.',
                );
            }

            const existingTeam =
                await getTeamByName(
                    guildId,
                    cleanName,
                );

            if (
                existingTeam &&
                Number(existingTeam.id) !== Number(team.id)
            ) {
                throw createError(
                    'Team name already exists',
                    ErrorTypes.VALIDATION,
                    'Another HCD team already uses this name.',
                );
            }

            updates.name = cleanName;
        }

        if (tag !== undefined) {
            const cleanTag =
                tag === null
                    ? null
                    : String(tag).trim();

            if (
                cleanTag &&
                cleanTag.length > 20
            ) {
                throw createError(
                    'Invalid team tag length',
                    ErrorTypes.VALIDATION,
                    'Team tag cannot contain more than 20 characters.',
                );
            }

            updates.tag = cleanTag || null;
        }

        if (managerId !== undefined) {
            updates.managerId = managerId;
        }

        if (roleId !== undefined) {
            updates.roleId = roleId;
        }

        if (discordUrl !== undefined) {
            updates.discordUrl =
                discordUrl || null;
        }

        if (logoUrl !== undefined) {
            updates.logoUrl =
                logoUrl || null;
        }

        if (!Object.keys(updates).length) {
            throw createError(
                'No team updates provided',
                ErrorTypes.VALIDATION,
                'You must provide at least one field to update.',
            );
        }

        const updatedTeam =
            await updateTeam(
                guildId,
                teamId,
                updates,
            );

        if (!updatedTeam) {
            throw createError(
                'Team update failed',
                ErrorTypes.VALIDATION,
                'The team could not be updated.',
            );
        }

        logger.info('HCD team updated', {
            guildId,
            teamId,
            updatedFields:
                Object.keys(updates),
        });

        return updatedTeam;
    } catch (error) {
        return this.handleError(
            'update team',
            error,
            {
                guildId,
                teamId,
            },
        );
    }
}
    static async get(guildId, teamId) {
        try {
            const team = await getTeamById(
                guildId,
                teamId,
            );

            if (!team) {
                throw createError(
                    'Team not found',
                    ErrorTypes.VALIDATION,
                    'This team does not exist.',
                    {
                        guildId,
                        teamId,
                    },
                );
            }

            return team;
        } catch (error) {
            return this.handleError(
                'get team',
                error,
                {
                    guildId,
                    teamId,
                },
            );
        }
    }

    /**
     * Returns all active HCD teams.
     */
    static async getTeams(guildId) {
        try {
            return await getActiveTeams(guildId);
        } catch (error) {
            return this.handleError(
                'get teams',
                error,
                { guildId },
            );
        }
    }

    /**
     * Returns a team's complete roster.
     */
    static async getRoster(guildId, teamId) {
        try {
            const team = await this.get(
                guildId,
                teamId,
            );

            const members = await getTeamRoster(
                guildId,
                teamId,
            );

            return {
                team,
                members,
                ...this.buildRosterSummary(members),
            };
        } catch (error) {
            return this.handleError(
                'get roster',
                error,
                {
                    guildId,
                    teamId,
                },
            );
        }
    }

    /**
     * Creates a 24-hour invitation for a player.
     */
    static async invitePlayer({
        guildId,
        teamId,
        userId,
        invitedBy,
        position,
        isStaff = false,
    }) {
        try {
            this.validateInviteData({
                guildId,
                teamId,
                userId,
                invitedBy,
                position,
            });

            const team = await this.get(
                guildId,
                teamId,
            );

            if (!team.active) {
                throw createError(
                    'Team is inactive',
                    ErrorTypes.VALIDATION,
                    'This team is currently inactive.',
                    {
                        guildId,
                        teamId,
                    },
                );
            }

            const executorMembership =
                await getTeamMember(
                    guildId,
                    teamId,
                    invitedBy,
                );

            this.assertManagementPermission({
                executorId: invitedBy,
                team,
                executorMembership,
                targetPosition: position,
                isStaff,
            });

            const existingMembership =
                await getPlayerMembership(
                    guildId,
                    userId,
                );

            if (existingMembership) {
                throw createError(
                    'Player already belongs to a team',
                    ErrorTypes.VALIDATION,
                    'This player already belongs to an HCD team.',
                    {
                        guildId,
                        userId,
                        teamId:
                            existingMembership.team_id,
                    },
                );
            }

            await expireTeamInvites(guildId);

            const pendingInvite =
                await getPendingTeamInvite(
                    guildId,
                    teamId,
                    userId,
                );

            if (pendingInvite) {
                throw createError(
                    'Player already has pending invitation',
                    ErrorTypes.VALIDATION,
                    'This player already has a pending invitation from this team.',
                    {
                        guildId,
                        teamId,
                        userId,
                        inviteId:
                            pendingInvite.id,
                    },
                );
            }

            const roster = await getTeamRoster(
                guildId,
                teamId,
            );

            this.assertAvailableSlot(
                roster,
                position,
            );

            const invite = await createTeamInvite({
                guildId,
                teamId,
                userId,
                invitedBy,
                position,
                expiresAt:
                    this.createInviteExpiration(),
            });

            logger.info('HCD team invitation created', {
                guildId,
                teamId,
                userId,
                invitedBy,
                position,
                inviteId: invite?.id,
            });

            return {
                team,
                invite,
            };
        } catch (error) {
            return this.handleError(
                'invite player',
                error,
                {
                    guildId,
                    teamId,
                    userId,
                    invitedBy,
                    position,
                },
            );
        }
    }

    /**
     * Accepts a pending invitation.
     */
    static async acceptInvite(
        guildId,
        inviteId,
        userId,
    ) {
        try {
            const invite =
                await getTeamInviteById(
                    guildId,
                    inviteId,
                );

            this.validatePendingInvite(
                invite,
                userId,
            );

            const result =
                await acceptTeamInvite(
                    guildId,
                    inviteId,
                    userId,
                );

            if (!result.accepted) {
                const messages = {
                    expired:
                        'This team invitation has expired.',
                    already_in_team:
                        'You already belong to an HCD team.',
                    slot_full:
                        'The requested roster position is no longer available.',
                };

                throw createError(
                    `Team invitation could not be accepted: ${result.reason}`,
                    ErrorTypes.VALIDATION,
                    messages[result.reason] ||
                        'This team invitation can no longer be accepted.',
                    {
                        guildId,
                        inviteId,
                        userId,
                        reason: result.reason,
                    },
                );
            }

            logger.info('HCD team invitation accepted', {
                guildId,
                inviteId,
                userId,
                teamId: result.team?.id,
                position:
                    result.member?.position,
            });

            return result;
        } catch (error) {
            return this.handleError(
                'accept invitation',
                error,
                {
                    guildId,
                    inviteId,
                    userId,
                },
            );
        }
    }

    /**
     * Declines a pending invitation.
     */
    static async declineInvite(
        guildId,
        inviteId,
        userId,
    ) {
        try {
            const invite =
                await getTeamInviteById(
                    guildId,
                    inviteId,
                );

            this.validatePendingInvite(
                invite,
                userId,
            );

            const declined =
                await declineTeamInvite(
                    guildId,
                    inviteId,
                    userId,
                );

            if (!declined) {
                throw createError(
                    'Unable to decline team invitation',
                    ErrorTypes.VALIDATION,
                    'This team invitation can no longer be declined.',
                    {
                        guildId,
                        inviteId,
                        userId,
                    },
                );
            }

            logger.info('HCD team invitation declined', {
                guildId,
                inviteId,
                userId,
                teamId: declined.team_id,
            });

            return declined;
        } catch (error) {
            return this.handleError(
                'decline invitation',
                error,
                {
                    guildId,
                    inviteId,
                    userId,
                },
            );
        }
    }

    /**
     * Removes a player from a team.
     */
    static async removePlayer({
        guildId,
        teamId,
        userId,
        removedBy,
        isStaff = false,
    }) {
        try {
            const team = await this.get(
                guildId,
                teamId,
            );

            const targetMembership =
                await getTeamMember(
                    guildId,
                    teamId,
                    userId,
                );

            if (!targetMembership) {
                throw createError(
                    'Player is not in team',
                    ErrorTypes.VALIDATION,
                    'This player is not part of this team.',
                    {
                        guildId,
                        teamId,
                        userId,
                    },
                );
            }

            const executorMembership =
                await getTeamMember(
                    guildId,
                    teamId,
                    removedBy,
                );

            this.assertManagementPermission({
                executorId: removedBy,
                team,
                executorMembership,
                targetPosition:
                    targetMembership.position,
                isStaff,
            });

            const removed =
                await removeTeamMember(
                    guildId,
                    teamId,
                    userId,
                );

            logger.info('HCD team member removed', {
                guildId,
                teamId,
                userId,
                removedBy,
                position:
                    targetMembership.position,
            });

            return removed;
        } catch (error) {
            return this.handleError(
                'remove player',
                error,
                {
                    guildId,
                    teamId,
                    userId,
                    removedBy,
                },
            );
        }
    }

    /**
     * Moves a player between roster positions.
     */
    static async movePlayer({
        guildId,
        teamId,
        userId,
        newPosition,
        movedBy,
        isStaff = false,
    }) {
        try {
            this.validatePosition(newPosition);

            const team = await this.get(
                guildId,
                teamId,
            );

            const targetMembership =
                await getTeamMember(
                    guildId,
                    teamId,
                    userId,
                );

            if (!targetMembership) {
                throw createError(
                    'Player is not in team',
                    ErrorTypes.VALIDATION,
                    'This player is not part of this team.',
                    {
                        guildId,
                        teamId,
                        userId,
                    },
                );
            }

            const executorMembership =
                await getTeamMember(
                    guildId,
                    teamId,
                    movedBy,
                );

            const captainChange =
                targetMembership.position ===
                    'captain' ||
                newPosition === 'captain';

            this.assertManagementPermission({
                executorId: movedBy,
                team,
                executorMembership,
                targetPosition:
                    captainChange
                        ? 'captain'
                        : newPosition,
                isStaff,
            });

            const result =
                await moveTeamMember(
                    guildId,
                    teamId,
                    userId,
                    newPosition,
                );

            if (!result.moved) {
                throw createError(
                    'Destination roster position is full',
                    ErrorTypes.VALIDATION,
                    `There are no available ${newPosition} slots in this team.`,
                    {
                        guildId,
                        teamId,
                        userId,
                        newPosition,
                    },
                );
            }

            logger.info('HCD team member moved', {
                guildId,
                teamId,
                userId,
                movedBy,
                oldPosition:
                    targetMembership.position,
                newPosition,
            });

            return result;
        } catch (error) {
            return this.handleError(
                'move player',
                error,
                {
                    guildId,
                    teamId,
                    userId,
                    movedBy,
                    newPosition,
                },
            );
        }
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
