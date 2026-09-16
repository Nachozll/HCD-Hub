import {
    PermissionsBitField,
} from 'discord.js';

import {
    TitanBotError,
    ErrorTypes,
} from '../utils/errorHandler.js';

import { logger } from '../utils/logger.js';

/**
 * Returns the Discord role name managed by HCD Hub for a team.
 *
 * The team TAG is preferred because it keeps member profiles cleaner.
 */
function getManagedTeamRoleName(
    name,
    tag = null,
) {
    const roleName =
        String(
            tag || name || '',
        ).trim();

    if (!roleName) {
        throw new TitanBotError(
            'Invalid HCD team role name',
            ErrorTypes.USER_INPUT,
            'The team must have a valid name or tag so HCD Hub can create its Discord role.',
        );
    }

    return roleName.slice(0, 100);
}

/**
 * Resolves the permanent Equipos separator role configured in Railway.
 */
async function getTeamsSeparatorRole(guild) {
    const separatorRoleId =
        process.env
            .HCD_TEAMS_SEPARATOR_ROLE_ID;

    if (!separatorRoleId) {
        throw new TitanBotError(
            'HCD teams separator role is not configured',
            ErrorTypes.VALIDATION,
            'HCD_TEAMS_SEPARATOR_ROLE_ID is not configured. An Administrator must configure the Equipos separator role before creating teams.',
        );
    }

    let separatorRole =
        guild.roles.cache.get(
            separatorRoleId,
        );

    if (!separatorRole) {
        try {
            separatorRole =
                await guild.roles.fetch(
                    separatorRoleId,
                );
        } catch {
            separatorRole = null;
        }
    }

    if (!separatorRole) {
        throw new TitanBotError(
            'HCD teams separator role was not found',
            ErrorTypes.VALIDATION,
            'HCD Hub could not find the configured Equipos separator role. Check HCD_TEAMS_SEPARATOR_ROLE_ID.',
        );
    }

    return separatorRole;
}

class TeamDiscordService {
    /**
     * Creates the Discord role owned by HCD Hub for a competitive team
     * and positions it directly below the Equipos separator.
     *
     * If role creation or positioning fails, the new role is deleted
     * automatically whenever possible.
     */
    static async createManagedRole({
        guild,
        name,
        tag = null,
        createdBy = null,
    }) {
        if (!guild) {
            throw new TitanBotError(
                'Missing guild for HCD team role',
                ErrorTypes.VALIDATION,
                'HCD Hub could not determine the Discord server where the Team Role should be created.',
            );
        }

        const separatorRole =
            await getTeamsSeparatorRole(
                guild,
            );

        const botMember =
            guild.members.me ??
            await guild.members.fetchMe();

        if (
            !botMember.permissions.has(
                PermissionsBitField.Flags
                    .ManageRoles,
            )
        ) {
            throw new TitanBotError(
                'HCD Hub cannot manage roles',
                ErrorTypes.PERMISSION,
                'HCD Hub needs the Manage Roles permission to create competitive team roles.',
            );
        }

        if (
            botMember.roles.highest.position <=
            separatorRole.position
        ) {
            throw new TitanBotError(
                'HCD Hub role is below the teams separator',
                ErrorTypes.PERMISSION,
                'The HCD Hub bot role must be above the Equipos separator role so it can position competitive team roles.',
            );
        }

        let teamRole = null;

        try {
            const reason = createdBy
                ? `HCD competitive team created by ${createdBy}`
                : 'HCD competitive team created by HCD Hub';

            teamRole =
                await guild.roles.create({
                    name:
                        getManagedTeamRoleName(
                            name,
                            tag,
                        ),

                    permissions: [],
                    hoist: false,
                    mentionable: false,
                    reason,
                });

            // Role positions can change immediately after creating
            // a new Discord role, so resolve the separator again.
            const refreshedSeparator =
                await getTeamsSeparatorRole(
                    guild,
                );

            await teamRole.setPosition(
                Math.max(
                    refreshedSeparator.position -
                        1,
                    1,
                ),
                {
                    reason:
                        'Position HCD team role below Equipos separator',
                },
            );

            logger.info(
                'HCD managed team role created',
                {
                    guildId: guild.id,
                    roleId: teamRole.id,
                    roleName:
                        teamRole.name,
                    createdBy,
                },
            );

            return teamRole;
        } catch (error) {
            if (teamRole) {
                try {
                    await teamRole.delete(
                        'HCD team role creation/positioning failed',
                    );
                } catch {
                    // Best-effort cleanup only.
                }
            }

            logger.error(
                'Failed to create or position HCD team role',
                {
                    guildId: guild.id,
                    userId:
                        createdBy || null,
                    separatorRoleId:
                        separatorRole.id,
                    error:
                        error.message,
                },
            );

            if (
                error instanceof
                TitanBotError
            ) {
                throw error;
            }

            throw new TitanBotError(
                'Failed to create HCD team role',
                ErrorTypes.VALIDATION,
                'HCD Hub could not create and position the Team Role. Make sure the bot has Manage Roles and that the HCD Hub role is above the Equipos separator.',
            );
        }
    }

    /**
     * Gives a team's Discord role to one member.
     *
     * This does NOT modify the competitive roster database.
     */
    static async assignTeamRole({
        guild,
        userId,
        roleId,
        teamName = null,
    }) {
        if (
            !guild ||
            !userId ||
            !roleId
        ) {
            throw new TitanBotError(
                'Missing team role assignment data',
                ErrorTypes.VALIDATION,
                'HCD Hub could not assign the Team Role because required information is missing.',
            );
        }

        let member;

        try {
            member =
                await guild.members.fetch(
                    userId,
                );
        } catch {
            throw new TitanBotError(
                'Team member was not found in Discord',
                ErrorTypes.VALIDATION,
                'One of the selected team members could not be found inside the HCD server.',
            );
        }

        if (
            member.roles.cache.has(
                roleId,
            )
        ) {
            return {
                member,
                assigned: false,
                alreadyHadRole: true,
            };
        }

        try {
            await member.roles.add(
                roleId,
                teamName
                    ? `Added to HCD team ${teamName}`
                    : 'Added to an HCD competitive team',
            );

            logger.info(
                'HCD team role assigned',
                {
                    guildId: guild.id,
                    userId,
                    roleId,
                    teamName,
                },
            );

            return {
                member,
                assigned: true,
                alreadyHadRole: false,
            };
        } catch (error) {
            logger.error(
                'Failed to assign HCD team role',
                {
                    guildId: guild.id,
                    userId,
                    roleId,
                    teamName,
                    error:
                        error.message,
                },
            );

            throw new TitanBotError(
                'Failed to assign HCD team role',
                ErrorTypes.VALIDATION,
                'HCD Hub could not assign the Team Role to one of the selected members. Check the bot role hierarchy and Manage Roles permission.',
            );
        }
    }

    /**
     * Removes a team's Discord role from one member.
     *
     * Intended primarily for rollback/cleanup operations.
     * This does NOT modify the competitive roster database.
     */
    static async removeTeamRole({
        guild,
        userId,
        roleId,
        teamName = null,
    }) {
        if (
            !guild ||
            !userId ||
            !roleId
        ) {
            return {
                removed: false,
                reason:
                    'missing_data',
            };
        }

        let member;

        try {
            member =
                await guild.members.fetch(
                    userId,
                );
        } catch (error) {
            logger.warn(
                'Failed to fetch member while removing HCD team role',
                {
                    guildId: guild.id,
                    userId,
                    roleId,
                    error:
                        error.message,
                },
            );

            return {
                removed: false,
                reason:
                    'member_not_found',
            };
        }

        if (
            !member.roles.cache.has(
                roleId,
            )
        ) {
            return {
                member,
                removed: false,
                reason:
                    'role_not_present',
            };
        }

        try {
            await member.roles.remove(
                roleId,
                teamName
                    ? `Rollback HCD team ${teamName}`
                    : 'HCD team role cleanup',
            );

            return {
                member,
                removed: true,
            };
        } catch (error) {
            logger.warn(
                'Failed to remove HCD team role',
                {
                    guildId: guild.id,
                    userId,
                    roleId,
                    teamName,
                    error:
                        error.message,
                },
            );

            return {
                member,
                removed: false,
                reason:
                    'discord_error',
                error,
            };
        }
    }

    /**
     * Deletes an HCD-managed Team Role.
     *
     * Intended for rollback and administrative cleanup.
     */
    static async deleteManagedRole({
        role,
        reason =
            'HCD managed team role cleanup',
    }) {
        if (!role) {
            return false;
        }

        try {
            await role.delete(reason);

            logger.info(
                'HCD managed team role deleted',
                {
                    guildId:
                        role.guild?.id,
                    roleId:
                        role.id,
                    roleName:
                        role.name,
                },
            );

            return true;
        } catch (error) {
            logger.warn(
                'Failed to delete HCD managed team role',
                {
                    guildId:
                        role.guild?.id,
                    roleId:
                        role.id,
                    roleName:
                        role.name,
                    error:
                        error.message,
                },
            );

            return false;
        }
    }
}

export default TeamDiscordService;
