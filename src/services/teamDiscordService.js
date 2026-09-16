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
 * Resolves a permanent Discord role configured
 * through a Railway environment variable.
 */
async function getConfiguredRole({
    guild,
    envName,
    label,
}) {
    const roleId =
        process.env[envName];

    if (!roleId) {
        throw new TitanBotError(
            `${label} role is not configured`,
            ErrorTypes.VALIDATION,
            `${envName} is not configured. An Administrator must configure the ${label} role before creating teams.`,
        );
    }

    let role =
        guild.roles.cache.get(
            roleId,
        );

    if (!role) {
        try {
            role =
                await guild.roles.fetch(
                    roleId,
                );
        } catch {
            role = null;
        }
    }

    if (!role) {
        throw new TitanBotError(
            `${label} role was not found`,
            ErrorTypes.VALIDATION,
            `HCD Hub could not find the configured ${label} role. Check ${envName}.`,
        );
    }

    return role;
}

/**
 * Resolves the permanent Equipos separator role.
 */
async function getTeamsSeparatorRole(guild) {
    return getConfiguredRole({
        guild,
        envName:
            'HCD_TEAMS_SEPARATOR_ROLE_ID',
        label:
            'Equipos separator',
    });
}

/**
 * Resolves the permanent Capitán de Equipo role.
 *
 * Every automatically generated Team Role must
 * be positioned directly below this role.
 */
async function getTeamCaptainRole(guild) {
    return getConfiguredRole({
        guild,
        envName:
            'HCD_TEAM_CAPTAIN_ROLE_ID',
        label:
            'Capitán de Equipo',
    });
}

/**
 * Resolves the permanent Jugador Libre role.
 */
async function getFreeAgentRole(guild) {
    return getConfiguredRole({
        guild,
        envName:
            'HCD_FREE_AGENT_ROLE_ID',
        label:
            'Jugador Libre',
    });
}

/**
 * Resolves the permanent Jugador role.
 *
 * This role represents active membership
 * in an HCD competitive roster.
 */
async function getPlayerRole(guild) {
    return getConfiguredRole({
        guild,
        envName:
            'HCD_PLAYER_ROLE_ID',
        label:
            'Jugador',
    });
}

/**
 * Resolves the permanent Líder de Facción role.
 */
async function getFactionLeaderRole(guild) {
    return getConfiguredRole({
        guild,
        envName:
            'HCD_FACTION_LEADER_ROLE_ID',
        label:
            'Líder de Facción',
    });
}

/**
 * Fetches one Discord guild member.
 */
async function getGuildMember({
    guild,
    userId,
}) {
    if (
        !guild ||
        !userId
    ) {
        throw new TitanBotError(
            'Missing Discord member context',
            ErrorTypes.VALIDATION,
            'HCD Hub could not determine the Discord member.',
        );
    }

    let member = null;

    try {
        member =
            await guild.members.fetch(
                userId,
            );
    } catch {
        member = null;
    }

    if (!member) {
        throw new TitanBotError(
            'HCD member was not found',
            ErrorTypes.VALIDATION,
            'The selected member could not be found inside the HCD server.',
        );
    }

    if (member.user.bot) {
        throw new TitanBotError(
            'HCD team member cannot be a bot',
            ErrorTypes.VALIDATION,
            'Bots cannot receive HCD competitive roster roles.',
        );
    }

    return member;
}

class TeamDiscordService {
    /**
     * Creates the Discord role owned by HCD Hub for a competitive team.
     *
     * Expected hierarchy:
     *
     * Equipos separator
     * Líder de Facción
     * Capitán de Equipo
     * Team Roles...
     *
     * Every new Team Role is positioned directly
     * below Capitán de Equipo.
     *
     * If role creation or positioning fails, the
     * new role is deleted automatically whenever possible.
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

        const captainRole =
            await getTeamCaptainRole(
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

        /**
         * HCD Hub must be above both permanent
         * roles used by the team hierarchy.
         */
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

        if (
            botMember.roles.highest.position <=
            captainRole.position
        ) {
            throw new TitanBotError(
                'HCD Hub role is below Capitán de Equipo',
                ErrorTypes.PERMISSION,
                'The HCD Hub bot role must be above Capitán de Equipo so it can position competitive Team Roles.',
            );
        }

        /**
         * Capitán de Equipo must itself be located
         * underneath the Equipos separator.
         *
         * This protects the hierarchy from accidental
         * manual changes in Discord.
         */
        if (
            captainRole.position >=
            separatorRole.position
        ) {
            throw new TitanBotError(
                'Invalid HCD team role hierarchy',
                ErrorTypes.VALIDATION,
                'Capitán de Equipo must be positioned below the Equipos separator before HCD Hub can create Team Roles.',
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

            /**
             * Discord role positions may shift immediately
             * after creating another role.
             *
             * Resolve Capitán de Equipo again so we use
             * its current position.
             */
            const refreshedCaptainRole =
                await getTeamCaptainRole(
                    guild,
                );

            /**
             * Position the newly-created Team Role
             * immediately below Capitán de Equipo.
             *
             * Discord positions count upward from @everyone,
             * therefore one position below means position - 1.
             */
            await teamRole.setPosition(
                Math.max(
                    refreshedCaptainRole.position -
                        1,
                    1,
                ),
                {
                    reason:
                        'Position HCD Team Role below Capitán de Equipo',
                },
            );

            logger.info(
                'HCD managed team role created',
                {
                    guildId:
                        guild.id,

                    roleId:
                        teamRole.id,

                    roleName:
                        teamRole.name,

                    createdBy,

                    separatorRoleId:
                        separatorRole.id,

                    captainRoleId:
                        refreshedCaptainRole.id,

                    finalPosition:
                        teamRole.position,
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
                    guildId:
                        guild.id,

                    userId:
                        createdBy || null,

                    separatorRoleId:
                        separatorRole.id,

                    captainRoleId:
                        captainRole.id,

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
                'HCD Hub could not create and position the Team Role. Make sure the bot has Manage Roles and that HCD Hub is above the HCD team hierarchy.',
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

        const member =
            await getGuildMember({
                guild,
                userId,
            });

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
                    guildId:
                        guild.id,

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
                    guildId:
                        guild.id,

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
     * Gives the permanent Capitán de Equipo role to a roster Captain.
     *
     * This method does not touch the database.
     */
    static async assignCaptainRole({
        guild,
        userId,
    }) {
        const member =
            await getGuildMember({
                guild,
                userId,
            });

        const captainRole =
            await getTeamCaptainRole(
                guild,
            );

        if (
            member.roles.cache.has(
                captainRole.id,
            )
        ) {
            return {
                member,
                role:
                    captainRole,
                assigned: false,
                alreadyHadRole: true,
            };
        }

        try {
            await member.roles.add(
                captainRole,
                'Assigned as HCD Team Captain',
            );

            logger.info(
                'HCD Captain role assigned',
                {
                    guildId:
                        guild.id,

                    userId,

                    roleId:
                        captainRole.id,
                },
            );

            return {
                member,
                role:
                    captainRole,
                assigned: true,
                alreadyHadRole: false,
            };
        } catch (error) {
            logger.error(
                'Failed to assign HCD Captain role',
                {
                    guildId:
                        guild.id,

                    userId,

                    roleId:
                        captainRole.id,

                    error:
                        error.message,
                },
            );

            throw new TitanBotError(
                'Failed to assign HCD Captain role',
                ErrorTypes.VALIDATION,
                'HCD Hub could not assign the Capitán de Equipo role. Check the bot role hierarchy.',
            );
        }
    }

    /**
     * Removes the permanent Capitán de Equipo role.
     *
     * This is used when a player is no longer a Captain
     * or when a provisioning operation must be rolled back.
     */
    static async removeCaptainRole({
        guild,
        userId,
        reason =
            'Removed from HCD Captain position',
    }) {
        if (
            !guild ||
            !userId
        ) {
            return {
                removed: false,
                reason:
                    'missing_data',
            };
        }

        let member = null;
        let captainRole = null;

        try {
            member =
                await getGuildMember({
                    guild,
                    userId,
                });

            captainRole =
                await getTeamCaptainRole(
                    guild,
                );
        } catch (error) {
            logger.warn(
                'Failed to resolve HCD Captain role removal',
                {
                    guildId:
                        guild?.id,

                    userId,

                    error:
                        error.message,
                },
            );

            return {
                removed: false,
                reason:
                    'resolution_failed',
                error,
            };
        }

        if (
            !member.roles.cache.has(
                captainRole.id,
            )
        ) {
            return {
                member,
                role:
                    captainRole,
                removed: false,
                reason:
                    'role_not_present',
            };
        }

        try {
            await member.roles.remove(
                captainRole,
                reason,
            );

            logger.info(
                'HCD Captain role removed',
                {
                    guildId:
                        guild.id,

                    userId,

                    roleId:
                        captainRole.id,
                },
            );

            return {
                member,
                role:
                    captainRole,
                removed: true,
            };
        } catch (error) {
            logger.warn(
                'Failed to remove HCD Captain role',
                {
                    guildId:
                        guild.id,

                    userId,

                    roleId:
                        captainRole.id,

                    error:
                        error.message,
                },
            );

            return {
                member,
                role:
                    captainRole,
                removed: false,
                reason:
                    'discord_error',
                error,
            };
        }
    }

    /**
     * Gives the permanent Líder de Facción role.
     *
     * Líder de Facción is an administrative identity and
     * does NOT imply competitive roster membership.
     *
     * Jugador Libre is intentionally left untouched.
     */
    static async assignFactionLeaderRole({
        guild,
        userId,
    }) {
        const member =
            await getGuildMember({
                guild,
                userId,
            });

        const factionLeaderRole =
            await getFactionLeaderRole(
                guild,
            );

        if (
            member.roles.cache.has(
                factionLeaderRole.id,
            )
        ) {
            return {
                member,
                role:
                    factionLeaderRole,
                assigned: false,
                alreadyHadRole: true,
            };
        }

        try {
            await member.roles.add(
                factionLeaderRole,
                'Assigned as HCD Faction Leader',
            );

            logger.info(
                'HCD Faction Leader role assigned',
                {
                    guildId:
                        guild.id,

                    userId,

                    roleId:
                        factionLeaderRole.id,
                },
            );

            return {
                member,
                role:
                    factionLeaderRole,
                assigned: true,
                alreadyHadRole: false,
            };
        } catch (error) {
            logger.error(
                'Failed to assign HCD Faction Leader role',
                {
                    guildId:
                        guild.id,

                    userId,

                    roleId:
                        factionLeaderRole.id,

                    error:
                        error.message,
                },
            );

            throw new TitanBotError(
                'Failed to assign HCD Faction Leader role',
                ErrorTypes.VALIDATION,
                'HCD Hub could not assign the Líder de Facción role. Check the bot role hierarchy.',
            );
        }
    }

    /**
     * Removes the permanent Líder de Facción role.
     *
     * Intended for faction-management changes and rollback.
     */
    static async removeFactionLeaderRole({
        guild,
        userId,
        reason =
            'Removed from HCD Faction Leader position',
    }) {
        if (
            !guild ||
            !userId
        ) {
            return {
                removed: false,
                reason:
                    'missing_data',
            };
        }

        let member = null;
        let factionLeaderRole = null;

        try {
            member =
                await getGuildMember({
                    guild,
                    userId,
                });

            factionLeaderRole =
                await getFactionLeaderRole(
                    guild,
                );
        } catch (error) {
            logger.warn(
                'Failed to resolve HCD Faction Leader role removal',
                {
                    guildId:
                        guild?.id,

                    userId,

                    error:
                        error.message,
                },
            );

            return {
                removed: false,
                reason:
                    'resolution_failed',
                error,
            };
        }

        if (
            !member.roles.cache.has(
                factionLeaderRole.id,
            )
        ) {
            return {
                member,
                role:
                    factionLeaderRole,
                removed: false,
                reason:
                    'role_not_present',
            };
        }

        try {
            await member.roles.remove(
                factionLeaderRole,
                reason,
            );

            logger.info(
                'HCD Faction Leader role removed',
                {
                    guildId:
                        guild.id,

                    userId,

                    roleId:
                        factionLeaderRole.id,
                },
            );

            return {
                member,
                role:
                    factionLeaderRole,
                removed: true,
            };
        } catch (error) {
            logger.warn(
                'Failed to remove HCD Faction Leader role',
                {
                    guildId:
                        guild.id,

                    userId,

                    roleId:
                        factionLeaderRole.id,

                    error:
                        error.message,
                },
            );

            return {
                member,
                role:
                    factionLeaderRole,
                removed: false,
                reason:
                    'discord_error',
                error,
            };
        }
    }

    /**
     * Gives the permanent Jugador role to an active
     * competitive roster member.
     *
     * This method does not modify the competitive roster database.
     */
    static async assignPlayerRole({
        guild,
        userId,
    }) {
        const member =
            await getGuildMember({
                guild,
                userId,
            });

        const playerRole =
            await getPlayerRole(
                guild,
            );

        if (
            member.roles.cache.has(
                playerRole.id,
            )
        ) {
            return {
                member,
                role:
                    playerRole,
                assigned: false,
                alreadyHadRole: true,
            };
        }

        try {
            await member.roles.add(
                playerRole,
                'Joined an HCD competitive roster',
            );

            logger.info(
                'HCD Player role assigned',
                {
                    guildId:
                        guild.id,

                    userId,

                    roleId:
                        playerRole.id,
                },
            );

            return {
                member,
                role:
                    playerRole,
                assigned: true,
                alreadyHadRole: false,
            };
        } catch (error) {
            logger.error(
                'Failed to assign HCD Player role',
                {
                    guildId:
                        guild.id,

                    userId,

                    roleId:
                        playerRole.id,

                    error:
                        error.message,
                },
            );

            throw new TitanBotError(
                'Failed to assign HCD Player role',
                ErrorTypes.VALIDATION,
                'HCD Hub could not assign the Jugador role. Check the bot role hierarchy.',
            );
        }
    }

    /**
     * Removes the permanent Jugador role.
     *
     * Intended for players leaving their competitive roster
     * and for provisioning rollback.
     */
    static async removePlayerRole({
        guild,
        userId,
        reason =
            'Left an HCD competitive roster',
    }) {
        if (
            !guild ||
            !userId
        ) {
            return {
                removed: false,
                reason:
                    'missing_data',
            };
        }

        let member = null;
        let playerRole = null;

        try {
            member =
                await getGuildMember({
                    guild,
                    userId,
                });

            playerRole =
                await getPlayerRole(
                    guild,
                );
        } catch (error) {
            logger.warn(
                'Failed to resolve HCD Player role removal',
                {
                    guildId:
                        guild?.id,

                    userId,

                    error:
                        error.message,
                },
            );

            return {
                removed: false,
                reason:
                    'resolution_failed',
                error,
            };
        }

        if (
            !member.roles.cache.has(
                playerRole.id,
            )
        ) {
            return {
                member,
                role:
                    playerRole,
                removed: false,
                reason:
                    'role_not_present',
            };
        }

        try {
            await member.roles.remove(
                playerRole,
                reason,
            );

            logger.info(
                'HCD Player role removed',
                {
                    guildId:
                        guild.id,

                    userId,

                    roleId:
                        playerRole.id,
                },
            );

            return {
                member,
                role:
                    playerRole,
                removed: true,
            };
        } catch (error) {
            logger.warn(
                'Failed to remove HCD Player role',
                {
                    guildId:
                        guild.id,

                    userId,

                    roleId:
                        playerRole.id,

                    error:
                        error.message,
                },
            );

            return {
                member,
                role:
                    playerRole,
                removed: false,
                reason:
                    'discord_error',
                error,
            };
        }
    }

    /**
     * Removes Jugador Libre from a competitive roster member.
     *
     * This should only be called after the user is confirmed
     * to be entering an HCD competitive roster.
     */
    static async removeFreeAgentRole({
        guild,
        userId,
        reason =
            'Joined an HCD competitive roster',
    }) {
        if (
            !guild ||
            !userId
        ) {
            return {
                removed: false,
                reason:
                    'missing_data',
            };
        }

        let member = null;
        let freeAgentRole = null;

        try {
            member =
                await getGuildMember({
                    guild,
                    userId,
                });

            freeAgentRole =
                await getFreeAgentRole(
                    guild,
                );
        } catch (error) {
            logger.warn(
                'Failed to resolve HCD Free Agent role removal',
                {
                    guildId:
                        guild?.id,

                    userId,

                    error:
                        error.message,
                },
            );

            return {
                removed: false,
                reason:
                    'resolution_failed',
                error,
            };
        }

        if (
            !member.roles.cache.has(
                freeAgentRole.id,
            )
        ) {
            return {
                member,
                role:
                    freeAgentRole,
                removed: false,
                reason:
                    'role_not_present',
            };
        }

        try {
            await member.roles.remove(
                freeAgentRole,
                reason,
            );

            logger.info(
                'HCD Free Agent role removed',
                {
                    guildId:
                        guild.id,

                    userId,

                    roleId:
                        freeAgentRole.id,
                },
            );

            return {
                member,
                role:
                    freeAgentRole,
                removed: true,
            };
        } catch (error) {
            logger.warn(
                'Failed to remove HCD Free Agent role',
                {
                    guildId:
                        guild.id,

                    userId,

                    roleId:
                        freeAgentRole.id,

                    error:
                        error.message,
                },
            );

            return {
                member,
                role:
                    freeAgentRole,
                removed: false,
                reason:
                    'discord_error',
                error,
            };
        }
    }

    /**
     * Restores Jugador Libre to a member.
     *
     * The caller must first confirm that the user no longer
     * belongs to any competitive HCD roster.
     */
    static async assignFreeAgentRole({
        guild,
        userId,
        reason =
            'No longer belongs to an HCD competitive roster',
    }) {
        const member =
            await getGuildMember({
                guild,
                userId,
            });

        const freeAgentRole =
            await getFreeAgentRole(
                guild,
            );

        if (
            member.roles.cache.has(
                freeAgentRole.id,
            )
        ) {
            return {
                member,
                role:
                    freeAgentRole,
                assigned: false,
                alreadyHadRole: true,
            };
        }

        try {
            await member.roles.add(
                freeAgentRole,
                reason,
            );

            logger.info(
                'HCD Free Agent role assigned',
                {
                    guildId:
                        guild.id,

                    userId,

                    roleId:
                        freeAgentRole.id,
                },
            );

            return {
                member,
                role:
                    freeAgentRole,
                assigned: true,
                alreadyHadRole: false,
            };
        } catch (error) {
            logger.error(
                'Failed to assign HCD Free Agent role',
                {
                    guildId:
                        guild.id,

                    userId,

                    roleId:
                        freeAgentRole.id,

                    error:
                        error.message,
                },
            );

            throw new TitanBotError(
                'Failed to assign HCD Free Agent role',
                ErrorTypes.VALIDATION,
                'HCD Hub could not assign the Jugador Libre role. Check the bot role hierarchy.',
            );
        }
    }

    /**
     * Synchronizes the Discord identity of a Captain
     * who is entering an HCD competitive roster.
     *
     * Result:
     *
     * + Team Role
     * + Jugador
     * + Capitán de Equipo
     * - Jugador Libre
     *
     * The return value records exactly which changes were
     * performed so the caller can roll them back safely.
     */
    static async provisionCaptainRoles({
        guild,
        userId,
        teamRoleId,
        teamName = null,
    }) {
        const changes = {
            teamRoleAssigned: false,
            playerRoleAssigned: false,
            captainRoleAssigned: false,
            freeAgentRoleRemoved: false,
        };

        try {
            const teamRoleResult =
                await this.assignTeamRole({
                    guild,
                    userId,
                    roleId:
                        teamRoleId,
                    teamName,
                });

            changes.teamRoleAssigned =
                teamRoleResult.assigned;

            const playerRoleResult =
                await this.assignPlayerRole({
                    guild,
                    userId,
                });

            changes.playerRoleAssigned =
                playerRoleResult.assigned;

            const captainRoleResult =
                await this.assignCaptainRole({
                    guild,
                    userId,
                });

            changes.captainRoleAssigned =
                captainRoleResult.assigned;

            const freeAgentResult =
                await this.removeFreeAgentRole({
                    guild,
                    userId,
                    reason:
                        teamName
                            ? `Joined HCD team ${teamName}`
                            : 'Joined an HCD competitive roster',
                });

            if (
                freeAgentResult.reason ===
                'discord_error'
            ) {
                throw new TitanBotError(
                    'Failed to remove HCD Free Agent role',
                    ErrorTypes.VALIDATION,
                    'HCD Hub could not remove Jugador Libre from the new roster member.',
                );
            }

            if (
                freeAgentResult.reason ===
                'resolution_failed'
            ) {
                throw new TitanBotError(
                    'Failed to resolve HCD Free Agent role',
                    ErrorTypes.VALIDATION,
                    'HCD Hub could not resolve the Jugador Libre role.',
                );
            }

            changes.freeAgentRoleRemoved =
                freeAgentResult.removed;

            logger.info(
                'HCD Captain Discord roles provisioned',
                {
                    guildId:
                        guild.id,

                    userId,
                    teamRoleId,
                    teamName,
                    changes,
                },
            );

            return {
                provisioned: true,
                changes,
            };
        } catch (error) {
            if (
                changes.freeAgentRoleRemoved
            ) {
                try {
                    await this.assignFreeAgentRole({
                        guild,
                        userId,
                        reason:
                            'Rollback HCD Captain provisioning',
                    });
                } catch {
                    // Best-effort rollback.
                }
            }

            if (
                changes.captainRoleAssigned
            ) {
                await this.removeCaptainRole({
                    guild,
                    userId,
                    reason:
                        'Rollback HCD Captain provisioning',
                });
            }

            if (
                changes.playerRoleAssigned
            ) {
                await this.removePlayerRole({
                    guild,
                    userId,
                    reason:
                        'Rollback HCD Captain provisioning',
                });
            }

            if (
                changes.teamRoleAssigned
            ) {
                await this.removeTeamRole({
                    guild,
                    userId,
                    roleId:
                        teamRoleId,
                    teamName,
                });
            }

            throw error;
        }
    }

    /**
     * Synchronizes the Discord identity of a Main/Sub player
     * who is entering an HCD competitive roster.
     *
     * Result:
     *
     * + Team Role
     * + Jugador
     * - Jugador Libre
     */
    static async provisionPlayerRoles({
        guild,
        userId,
        teamRoleId,
        teamName = null,
    }) {
        const changes = {
            teamRoleAssigned: false,
            playerRoleAssigned: false,
            freeAgentRoleRemoved: false,
        };

        try {
            const teamRoleResult =
                await this.assignTeamRole({
                    guild,
                    userId,
                    roleId:
                        teamRoleId,
                    teamName,
                });

            changes.teamRoleAssigned =
                teamRoleResult.assigned;

            const playerRoleResult =
                await this.assignPlayerRole({
                    guild,
                    userId,
                });

            changes.playerRoleAssigned =
                playerRoleResult.assigned;

            const freeAgentResult =
                await this.removeFreeAgentRole({
                    guild,
                    userId,
                    reason:
                        teamName
                            ? `Joined HCD team ${teamName}`
                            : 'Joined an HCD competitive roster',
                });

            if (
                freeAgentResult.reason ===
                'discord_error'
            ) {
                throw new TitanBotError(
                    'Failed to remove HCD Free Agent role',
                    ErrorTypes.VALIDATION,
                    'HCD Hub could not remove Jugador Libre from the new roster member.',
                );
            }

            if (
                freeAgentResult.reason ===
                'resolution_failed'
            ) {
                throw new TitanBotError(
                    'Failed to resolve HCD Free Agent role',
                    ErrorTypes.VALIDATION,
                    'HCD Hub could not resolve the Jugador Libre role.',
                );
            }

            changes.freeAgentRoleRemoved =
                freeAgentResult.removed;

            logger.info(
                'HCD Player Discord roles provisioned',
                {
                    guildId:
                        guild.id,

                    userId,
                    teamRoleId,
                    teamName,
                    changes,
                },
            );

            return {
                provisioned: true,
                changes,
            };
        } catch (error) {
            if (
                changes.freeAgentRoleRemoved
            ) {
                try {
                    await this.assignFreeAgentRole({
                        guild,
                        userId,
                        reason:
                            'Rollback HCD Player provisioning',
                    });
                } catch {
                    // Best-effort rollback.
                }
            }

            if (
                changes.playerRoleAssigned
            ) {
                await this.removePlayerRole({
                    guild,
                    userId,
                    reason:
                        'Rollback HCD Player provisioning',
                });
            }

            if (
                changes.teamRoleAssigned
            ) {
                await this.removeTeamRole({
                    guild,
                    userId,
                    roleId:
                        teamRoleId,
                    teamName,
                });
            }

            throw error;
        }
    }

    /**
     * Synchronizes the Discord identity of a
     * Líder de Facción.
     *
     * Result:
     *
     * + Team Role
     * + Líder de Facción
     *
     * Jugador Libre is intentionally NOT touched because
     * Líder de Facción is not a competitive roster position.
     */
    static async provisionFactionLeaderRoles({
        guild,
        userId,
        teamRoleId,
        teamName = null,
    }) {
        const changes = {
            teamRoleAssigned: false,
            factionLeaderRoleAssigned: false,
        };

        try {
            const teamRoleResult =
                await this.assignTeamRole({
                    guild,
                    userId,
                    roleId:
                        teamRoleId,
                    teamName,
                });

            changes.teamRoleAssigned =
                teamRoleResult.assigned;

            const factionLeaderResult =
                await this.assignFactionLeaderRole({
                    guild,
                    userId,
                });

            changes.factionLeaderRoleAssigned =
                factionLeaderResult.assigned;

            logger.info(
                'HCD Faction Leader Discord roles provisioned',
                {
                    guildId:
                        guild.id,

                    userId,
                    teamRoleId,
                    teamName,
                    changes,
                },
            );

            return {
                provisioned: true,
                changes,
            };
        } catch (error) {
            if (
                changes.factionLeaderRoleAssigned
            ) {
                await this.removeFactionLeaderRole({
                    guild,
                    userId,
                    reason:
                        'Rollback HCD Faction Leader provisioning',
                });
            }

            if (
                changes.teamRoleAssigned
            ) {
                await this.removeTeamRole({
                    guild,
                    userId,
                    roleId:
                        teamRoleId,
                    teamName,
                });
            }

            throw error;
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
                    guildId:
                        guild.id,

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
                    guildId:
                        guild.id,

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
            await role.delete(
                reason,
            );

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
