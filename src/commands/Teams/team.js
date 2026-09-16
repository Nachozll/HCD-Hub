import {
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    PermissionsBitField,
} from 'discord.js';

import TeamService, {
    TEAM_LIMITS,
} from '../../services/teamService.js';

import TeamDiscordService from '../../services/teamDiscordService.js';
import TeamPanelService from '../../services/teamPanelService.js';
import TeamApplicationPanelService from '../../services/teamApplicationPanelService.js';

import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';
import {
    TitanBotError,
    ErrorTypes,
} from '../../utils/errorHandler.js';

const POSITION_NAMES = Object.freeze({
    captain: 'Capitán',
    main: 'Main Roster',
    sub: 'Sub Roster',
});

/**
 * Returns whether the interaction member has HCD Staff-level
 * permissions for team management.
 *
 * For now this uses Discord's ManageGuild permission.
 * Later this can be replaced/extended with HCD-specific Staff roles.
 */
function isHcdStaff(interaction) {
    const teamAdminRoleId =
        process.env.HCD_TEAM_ADMIN_ROLE_ID;

    const coachLeaderRoleId =
        process.env.HCD_COACH_LEADER_ROLE_ID;

    const ownerIds = (process.env.OWNER_IDS || '')
        .split(',')
        .map(id => id.trim())
        .filter(Boolean);

    const isOwner =
        ownerIds.includes(interaction.user.id);

    const isAdministrator =
        teamAdminRoleId &&
        (interaction.member?.roles?.cache?.has(
            teamAdminRoleId,
        ) ?? false);

    const isCoachLeader =
        coachLeaderRoleId &&
        (interaction.member?.roles?.cache?.has(
            coachLeaderRoleId,
        ) ?? false);

    return (
        isOwner ||
        isAdministrator ||
        isCoachLeader
    );
}

/**
 * Returns whether the interaction member can administratively edit
 * the identity/settings of any HCD team.
 *
 * Only Owner + Administrador. Coach Leader is intentionally excluded.
 */
function isHcdTeamIdentityAdmin(interaction) {
    const teamAdminRoleId =
        process.env.HCD_TEAM_ADMIN_ROLE_ID;

    const ownerIds = (process.env.OWNER_IDS || '')
        .split(',')
        .map(id => id.trim())
        .filter(Boolean);

    const isOwner =
        ownerIds.includes(interaction.user.id);

    const isAdministrator =
        teamAdminRoleId &&
        (interaction.member?.roles?.cache?.has(
            teamAdminRoleId,
        ) ?? false);

    return isOwner || isAdministrator;
}

/**
 * Builds a safe Discord emoji name for an HCD team logo.
 */
function buildTeamEmojiName(name, tag = null) {
    const source = (tag || name || 'team')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9_]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toLowerCase();

    const base = source || 'team';
    const suffix = Date.now().toString().slice(-5);

    return `hcdteam_${base}_${suffix}`.slice(0, 32);
}

/**
 * Creates the custom Discord emoji used by a team's panel button.
 * The same emoji CDN image is also used as the roster thumbnail.
 */
async function createTeamLogoEmoji({
    interaction,
    attachment,
    teamName,
    teamTag = null,
}) {
    if (!attachment) {
        return null;
    }

    const isImage =
        attachment.contentType?.startsWith('image/');

    if (!isImage) {
        throw new TitanBotError(
            'Invalid team logo attachment',
            ErrorTypes.USER_INPUT,
            'The team logo must be an image file.',
        );
    }

    // Discord's guild emoji endpoint accepts images up to 256 KiB.
    if (attachment.size > 256 * 1024) {
        throw new TitanBotError(
            'Team logo is too large for a Discord emoji',
            ErrorTypes.USER_INPUT,
            'The team logo must be smaller than 256 KB so HCD Hub can create the button emoji automatically.',
        );
    }

    let emoji;

    try {
        emoji = await interaction.guild.emojis.create({
            attachment: attachment.url,
            name: buildTeamEmojiName(
                teamName,
                teamTag,
            ),
            reason:
                `HCD team logo configured by ${interaction.user.tag}`,
        });
    } catch (error) {
        logger.error(
            'Failed to create HCD team logo emoji',
            {
                guildId: interaction.guildId,
                userId: interaction.user.id,
                fileName: attachment.name,
                fileSize: attachment.size,
                error: error.message,
            },
        );

        throw new TitanBotError(
            'Failed to create team logo emoji',
            ErrorTypes.VALIDATION,
            'HCD Hub could not create the team logo emoji. Make sure the image is valid, under 256 KB, and that the bot has permission to Create Expressions.',
        );
    }

    return {
        emoji,
        buttonEmoji: emoji.id,
        logoUrl: emoji.imageURL({
            size: 256,
        }),
    };
}

/**
 * Removes an older HCD Hub-created team emoji after a successful
 * replacement. Manually created emojis are intentionally preserved.
 */
async function cleanupOldTeamEmoji(
    interaction,
    emojiId,
) {
    if (!emojiId) {
        return;
    }

    try {
        let emoji =
            interaction.guild.emojis.cache.get(emojiId);

        if (!emoji) {
            try {
                emoji =
                    await interaction.guild.emojis.fetch(
                        emojiId,
                    );
            } catch {
                return;
            }
        }

        if (!emoji?.name?.startsWith('hcdteam_')) {
            return;
        }

        await emoji.delete(
            `Replaced HCD team logo by ${interaction.user.tag}`,
        );
    } catch (error) {
        logger.warn(
            'Failed to clean up previous HCD team logo emoji',
            {
                guildId: interaction.guildId,
                emojiId,
                error: error.message,
            },
        );
    }
}

/**
 * Converts a database team ID to an integer.
 */
function getTeamId(interaction) {
    const teamId = interaction.options.getInteger('team');

    if (!teamId || teamId <= 0) {
        throw new TitanBotError(
            'Invalid team ID',
            ErrorTypes.USER_INPUT,
            'You must provide a valid team ID.',
            {
                subtype: 'invalid_team_id',
                teamId,
            },
        );
    }

    return teamId;
}

/**
 * Formats one roster section.
 */
function formatRosterSection(members = []) {
    if (!members.length) {
        return '*Empty*';
    }

    return members
        .map((member) => `<@${member.user_id}>`)
        .join('\n');
}

/**
 * Refreshes the public teams panel after a team identity change.
 * Team creation/editing must still succeed even if the panel cannot refresh.
 */
async function refreshTeamsPanelSafely(interaction) {
    try {
        const result =
            await TeamPanelService.refreshPanel(
                interaction.guild,
            );

        if (!result.updated && !result.missing) {
            logger.warn(
                'HCD teams panel was not refreshed',
                {
                    guildId: interaction.guildId,
                    reason:
                        result.reason || 'unknown',
                },
            );
        }
    } catch (error) {
        logger.warn(
            'Failed to automatically refresh HCD teams panel',
            {
                guildId: interaction.guildId,
                error: error.message,
            },
        );
    }
}

/**
 * Formats the faction leader for team responses.
 */
function formatFactionLeader(managerId) {
    return managerId
        ? `<@${managerId}>`
        : 'Sin Líder de Facción';
}

/**
 * Returns the Discord role name managed by HCD Hub for a team.
 * The tag is preferred to keep member profiles clean.
 */
function getManagedTeamRoleName(name, tag = null) {
    const roleName = String(tag || name || '').trim();

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
async function getTeamsSeparatorRole(interaction) {
    const separatorRoleId =
        process.env.HCD_TEAMS_SEPARATOR_ROLE_ID;

    if (!separatorRoleId) {
        throw new TitanBotError(
            'HCD teams separator role is not configured',
            ErrorTypes.VALIDATION,
            'HCD_TEAMS_SEPARATOR_ROLE_ID is not configured. An Administrator must configure the Equipos separator role before creating teams.',
        );
    }

    let separatorRole =
        interaction.guild.roles.cache.get(
            separatorRoleId,
        );

    if (!separatorRole) {
        try {
            separatorRole =
                await interaction.guild.roles.fetch(
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

/**
 * Creates the Discord role owned by HCD Hub for a competitive team
 * and positions it directly below the Equipos separator.
 */
async function createManagedTeamRole({
    interaction,
    name,
    tag = null,
}) {
    const separatorRole =
        await getTeamsSeparatorRole(interaction);

    const botMember =
        interaction.guild.members.me ??
        await interaction.guild.members.fetchMe();

    if (
        !botMember.permissions.has(
            PermissionsBitField.Flags.ManageRoles,
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
        teamRole =
            await interaction.guild.roles.create({
                name:
                    getManagedTeamRoleName(
                        name,
                        tag,
                    ),
                permissions: [],
                hoist: false,
                mentionable: false,
                reason:
                    `HCD competitive team created by ${interaction.user.tag}`,
            });

        // Re-fetch the separator because role positions can shift after
        // creating a new role.
        const refreshedSeparator =
            await getTeamsSeparatorRole(interaction);

        await teamRole.setPosition(
            Math.max(
                refreshedSeparator.position - 1,
                1,
            ),
            {
                reason:
                    'Position HCD team role below Equipos separator',
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
                guildId: interaction.guildId,
                userId: interaction.user.id,
                separatorRoleId:
                    separatorRole.id,
                error: error.message,
            },
        );

        throw new TitanBotError(
            'Failed to create HCD team role',
            ErrorTypes.VALIDATION,
            'HCD Hub could not create and position the Team Role. Make sure the bot has Manage Roles and that the HCD Hub role is above the Equipos separator.',
        );
    }
}

/**
 * Renames the HCD Hub-managed Discord role when the team's public
 * identity changes.
 */
async function renameManagedTeamRole(
    interaction,
    roleId,
    name,
    tag = null,
) {
    if (!roleId) {
        return null;
    }

    let teamRole =
        interaction.guild.roles.cache.get(roleId);

    if (!teamRole) {
        try {
            teamRole =
                await interaction.guild.roles.fetch(
                    roleId,
                );
        } catch {
            teamRole = null;
        }
    }

    if (!teamRole) {
        throw new TitanBotError(
            'HCD team role was not found',
            ErrorTypes.VALIDATION,
            'The Discord Team Role linked to this team no longer exists.',
        );
    }

    const desiredName =
        getManagedTeamRoleName(name, tag);

    if (teamRole.name === desiredName) {
        return {
            role: teamRole,
            renamed: false,
            previousName: teamRole.name,
        };
    }

    const previousName = teamRole.name;

    try {
        await teamRole.setName(
            desiredName,
            `HCD team identity updated by ${interaction.user.tag}`,
        );

        return {
            role: teamRole,
            renamed: true,
            previousName,
        };
    } catch (error) {
        logger.error(
            'Failed to rename HCD team role',
            {
                guildId: interaction.guildId,
                roleId,
                desiredName,
                error: error.message,
            },
        );

        throw new TitanBotError(
            'Failed to rename HCD team role',
            ErrorTypes.VALIDATION,
            'HCD Hub could not rename the Team Role. Check the bot role hierarchy and Manage Roles permission.',
        );
    }
}

/**
 * Handles /team create.
 */
async function handleCreate(interaction) {
    if (!isHcdStaff(interaction)) {
        throw new TitanBotError(
            'Missing team creation permission',
            ErrorTypes.PERMISSION,
            'Only HCD Staff can create teams.',
        );
    }

    const name = interaction.options.getString(
        'name',
        true,
    );

    const tag =
        interaction.options.getString('tag');

    const manager =
        interaction.options.getUser('manager');

    const discordUrl =
        interaction.options.getString('discord');

    const logoAttachment =
        interaction.options.getAttachment('logo');

    if (manager?.bot) {
        throw new TitanBotError(
            'Bot cannot manage team',
            ErrorTypes.USER_INPUT,
            'A bot cannot be assigned as Líder de Facción.',
        );
    }

    let logoResult = null;
    let teamRole = null;
    let team = null;

    try {
        logoResult =
            await createTeamLogoEmoji({
                interaction,
                attachment: logoAttachment,
                teamName: name,
                teamTag: tag,
            });

       teamRole =
    await TeamDiscordService.createManagedRole({
        guild:
            interaction.guild,

        name,
        tag,

        createdBy:
            interaction.user.tag,
    });

        team = await TeamService.create({
            guildId: interaction.guildId,
            name,
            tag,
            managerId:
                manager?.id ?? null,
            roleId: teamRole.id,
            discordUrl,
            logoUrl:
                logoResult?.logoUrl ?? null,
            buttonEmoji:
                logoResult?.buttonEmoji ?? null,
        });
    } catch (error) {
        if (teamRole) {
            try {
                await teamRole.delete(
                    'HCD team creation failed',
                );
            } catch {
                // Best-effort cleanup only.
            }
        }

        if (logoResult?.emoji) {
            try {
                await logoResult.emoji.delete(
                    'HCD team creation failed',
                );
            } catch {
                // Best-effort cleanup only.
            }
        }

        throw error;
    }

    await refreshTeamsPanelSafely(interaction);

    await InteractionHelper.safeEditReply(
        interaction,
        {
            content: [
                '✅ **Team created successfully**',
                '',
                `**Name:** ${team.name}`,
                team.tag
                    ? `**Tag:** ${team.tag}`
                    : null,
                `**Líder de Facción:** ${formatFactionLeader(team.manager_id)}`,
                `**Team ID:** \`${team.id}\``,
                `**Team Role:** <@&${team.role_id}>`,
            ]
                .filter(Boolean)
                .join('\n'),
        },
    );
}

/**
 * Handles /team edit.
 */
async function handleEdit(interaction) {
    const teamId = getTeamId(interaction);

    const currentTeam = await TeamService.get(
        interaction.guildId,
        teamId,
    );

    const isIdentityAdmin =
        isHcdTeamIdentityAdmin(interaction);

    const isFactionLeader =
        currentTeam.manager_id === interaction.user.id;

    if (!isIdentityAdmin && !isFactionLeader) {
        throw new TitanBotError(
            'Missing team edit permission',
            ErrorTypes.PERMISSION,
            'Only the Líder de Facción, an HCD Administrator, or the Owner can edit this team.',
        );
    }

    const name =
        interaction.options.getString('name');

    const tag =
        interaction.options.getString('tag');

    const manager =
        interaction.options.getUser('manager');

    const clearManager =
        interaction.options.getBoolean(
            'clear_manager',
        );

    const discordUrl =
        interaction.options.getString('discord');

    const logoAttachment =
        interaction.options.getAttachment('logo');

    if (manager?.bot) {
        throw new TitanBotError(
            'Bot cannot manage team',
            ErrorTypes.USER_INPUT,
            'A bot cannot be assigned as Líder de Facción.',
        );
    }

    if (
        manager !== null &&
        clearManager === true
    ) {
        throw new TitanBotError(
            'Conflicting faction leader options',
            ErrorTypes.USER_INPUT,
            'Choose either a new Líder de Facción or clear the current leader, not both.',
        );
    }

    if (
        !isIdentityAdmin &&
        (
            manager !== null ||
            clearManager !== null
        )
    ) {
        throw new TitanBotError(
            'Restricted team administration field',
            ErrorTypes.PERMISSION,
            'Only an HCD Administrator or the Owner can change or remove the Líder de Facción.',
        );
    }

    if (
        name === null &&
        tag === null &&
        manager === null &&
        clearManager === null &&
        discordUrl === null &&
        logoAttachment === null
    ) {
        throw new TitanBotError(
            'No team edit fields provided',
            ErrorTypes.USER_INPUT,
            'You must provide at least one field to update.',
        );
    }

    const nextName =
        name ?? currentTeam.name;

    const nextTag =
        tag ?? currentTeam.tag;

    let logoResult = null;
    let roleUpdate = null;
    let team = null;

    try {
        logoResult =
            await createTeamLogoEmoji({
                interaction,
                attachment: logoAttachment,
                teamName: nextName,
                teamTag: nextTag,
            });

        if (
            currentTeam.role_id &&
            (
                name !== null ||
                tag !== null
            )
        ) {
            roleUpdate =
                await renameManagedTeamRole(
                    interaction,
                    currentTeam.role_id,
                    nextName,
                    nextTag,
                );
        }

        team = await TeamService.update({
            guildId: interaction.guildId,
            teamId,
            name:
                name ?? undefined,
            tag:
                tag ?? undefined,
            managerId:
                clearManager === true
                    ? null
                    : manager?.id ?? undefined,
            discordUrl:
                discordUrl ?? undefined,
            logoUrl:
                logoResult?.logoUrl ?? undefined,
            buttonEmoji:
                logoResult?.buttonEmoji ?? undefined,
        });
    } catch (error) {
        if (
            roleUpdate?.renamed &&
            roleUpdate.role
        ) {
            try {
                await roleUpdate.role.setName(
                    roleUpdate.previousName,
                    'Rollback failed HCD team update',
                );
            } catch (rollbackError) {
                logger.warn(
                    'Failed to rollback HCD team role name',
                    {
                        guildId:
                            interaction.guildId,
                        teamId,
                        roleId:
                            currentTeam.role_id,
                        error:
                            rollbackError.message,
                    },
                );
            }
        }

        if (logoResult?.emoji) {
            try {
                await logoResult.emoji.delete(
                    'HCD team update failed',
                );
            } catch {
                // Best-effort cleanup only.
            }
        }

        throw error;
    }

    if (
        logoResult?.buttonEmoji &&
        currentTeam.button_emoji &&
        currentTeam.button_emoji !==
            logoResult.buttonEmoji
    ) {
        await cleanupOldTeamEmoji(
            interaction,
            currentTeam.button_emoji,
        );
    }

    await refreshTeamsPanelSafely(interaction);

    await InteractionHelper.safeEditReply(
        interaction,
        {
            content: [
                '✅ **Team updated successfully**',
                '',
                `**Team:** ${team.name}${
                    team.tag
                        ? ` [${team.tag}]`
                        : ''
                }`,
                `**Team ID:** \`${team.id}\``,
                `**Líder de Facción:** ${formatFactionLeader(team.manager_id)}`,
                team.role_id
                    ? `**Team Role:** <@&${team.role_id}>`
                    : '**Team Role:** None',
                team.button_emoji
                    ? `**Button Emoji:** ${team.button_emoji}`
                    : null,
            ]
                .filter(Boolean)
                .join('\n'),
        },
    );
}

/**
 * Handles /team disband.
 *
 * Only Owner + Administrador can disband a team.
 * The HCD Hub-managed Discord team role is deleted after roster cleanup.
 */
async function handleDisband(interaction) {
    if (!isHcdTeamIdentityAdmin(interaction)) {
        throw new TitanBotError(
            'Missing team disband permission',
            ErrorTypes.PERMISSION,
            'Only an HCD Administrator or the Owner can disband a team.',
        );
    }

    const teamId = getTeamId(interaction);

    const currentTeam = await TeamService.get(
        interaction.guildId,
        teamId,
    );

    if (!currentTeam.active) {
        throw new TitanBotError(
            'Team is already inactive',
            ErrorTypes.VALIDATION,
            'This team is already inactive.',
        );
    }

    const result = await TeamService.deactivate({
        guildId: interaction.guildId,
        teamId,
        deactivatedBy: interaction.user.id,
    });

    const team = result.team;
    const members = result.members || [];
    const roleWarnings = [];

    for (const rosterMember of members) {
        try {
            const member =
                await interaction.guild.members.fetch(
                    rosterMember.user_id,
                );

            if (team.role_id) {
                try {
                    if (
                        member.roles.cache.has(
                            team.role_id,
                        )
                    ) {
                        await member.roles.remove(
                            team.role_id,
                            `HCD team ${team.name} was disbanded`,
                        );
                    }
                } catch (error) {
                    logger.warn(
                        'Failed to remove team role during team disband',
                        {
                            guildId:
                                interaction.guildId,
                            teamId,
                            userId:
                                rosterMember.user_id,
                            roleId:
                                team.role_id,
                            error:
                                error.message,
                        },
                    );

                    roleWarnings.push(
                        `<@${rosterMember.user_id}>: team role could not be removed.`,
                    );
                }
            }

            const freeAgentRoleId =
                process.env.HCD_FREE_AGENT_ROLE_ID;

            if (freeAgentRoleId) {
                try {
                    if (
                        !member.roles.cache.has(
                            freeAgentRoleId,
                        )
                    ) {
                        await member.roles.add(
                            freeAgentRoleId,
                            `HCD team ${team.name} was disbanded`,
                        );
                    }
                } catch (error) {
                    logger.warn(
                        'Failed to restore free-agent role during team disband',
                        {
                            guildId:
                                interaction.guildId,
                            teamId,
                            userId:
                                rosterMember.user_id,
                            roleId:
                                freeAgentRoleId,
                            error:
                                error.message,
                        },
                    );

                    roleWarnings.push(
                        `<@${rosterMember.user_id}>: Jugador Libre could not be restored.`,
                    );
                }
            } else {
                logger.warn(
                    'HCD_FREE_AGENT_ROLE_ID is not configured during team disband',
                    {
                        guildId:
                            interaction.guildId,
                        teamId,
                        userId:
                            rosterMember.user_id,
                    },
                );

                roleWarnings.push(
                    `<@${rosterMember.user_id}>: Jugador Libre could not be restored because HCD_FREE_AGENT_ROLE_ID is not configured.`,
                );
            }
        } catch (error) {
            logger.warn(
                'Failed to fetch roster member during team disband',
                {
                    guildId:
                        interaction.guildId,
                    teamId,
                    userId:
                        rosterMember.user_id,
                    error:
                        error.message,
                },
            );

            roleWarnings.push(
                `<@${rosterMember.user_id}>: Discord roles could not be synchronized.`,
            );
        }
    }

    let teamRoleDeleted = false;

    if (team.role_id) {
        try {
            let teamRole =
                interaction.guild.roles.cache.get(
                    team.role_id,
                );

            if (!teamRole) {
                try {
                    teamRole =
                        await interaction.guild.roles.fetch(
                            team.role_id,
                        );
                } catch {
                    teamRole = null;
                }
            }

            if (teamRole) {
                await teamRole.delete(
                    `HCD team ${team.name} was disbanded by ${interaction.user.tag}`,
                );
                teamRoleDeleted = true;
            } else {
                teamRoleDeleted = true;
            }
        } catch (error) {
            logger.warn(
                'Failed to delete HCD team role during team disband',
                {
                    guildId:
                        interaction.guildId,
                    teamId,
                    roleId:
                        team.role_id,
                    error:
                        error.message,
                },
            );

            roleWarnings.push(
                'The Discord Team Role could not be deleted automatically.',
            );
        }
    }

    if (team.button_emoji) {
        await cleanupOldTeamEmoji(
            interaction,
            team.button_emoji,
        );
    }

    await refreshTeamsPanelSafely(interaction);

    await InteractionHelper.safeEditReply(
        interaction,
        {
            content: [
                '🛑 **Team disbanded successfully**',
                '',
                `**Team:** ${team.name}${
                    team.tag
                        ? ` [${team.tag}]`
                        : ''
                }`,
                `**Team ID:** \`${team.id}\``,
                `**Roster members removed:** ${members.length}`,
                '',
                team.role_id
                    ? teamRoleDeleted
                        ? '🧹 **Discord Team Role:** Deleted automatically'
                        : '⚠️ **Discord Team Role:** Could not be deleted automatically'
                    : 'ℹ️ **Discord Team Role:** None',
                'The team was disbanded, pending invitations were cancelled, and the public teams panel was refreshed.',
                '',
                roleWarnings.length
                    ? `⚠️ **Role sync warnings:**\n${roleWarnings.join('\n')}`
                    : members.length
                        ? '🔄 Team roles were removed and Jugador Libre was restored for roster members.'
                        : '✅ No roster members required Discord role cleanup.',
            ].join('\n'),
        },
    );
}

/**
 * Handles /team invite.
 */
async function handleInvite(interaction) {
    const teamId = getTeamId(interaction);

    const player = interaction.options.getUser(
        'player',
        true,
    );

    const position =
        interaction.options.getString(
            'position',
            true,
        );

    if (player.bot) {
        throw new TitanBotError(
            'Bot cannot join team',
            ErrorTypes.USER_INPUT,
            'You cannot invite a bot to a competitive team.',
        );
    }

    const result = await TeamService.invitePlayer({
        guildId: interaction.guildId,
        teamId,
        userId: player.id,
        invitedBy: interaction.user.id,
        position,
        isStaff: isHcdStaff(interaction),
    });

    const inviteId = result.invite.id;

    const buttons = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(
    `team_invite_accept:${interaction.guildId}:${inviteId}`,
)
                .setLabel('Accept')
                .setStyle(ButtonStyle.Success),

            new ButtonBuilder()
                .setCustomId(
    `team_invite_decline:${interaction.guildId}:${inviteId}`,
)
                .setLabel('Decline')
                .setStyle(ButtonStyle.Danger),
        );

    let inviteMessageSent = false;

    try {
        await player.send({
            content: [
                '## HCD Team Invitation',
                '',
                `You have been invited to join **${result.team.name}${
                    result.team.tag
                        ? ` [${result.team.tag}]`
                        : ''
                }**`,
                '',
                `**Position:** ${POSITION_NAMES[position]}`,
                `**Invited by:** <@${interaction.user.id}>`,
                `**Expires:** <t:${Math.floor(
                    new Date(
                        result.invite.expires_at,
                    ).getTime() / 1000,
                )}:R>`,
                '',
                'Use the buttons below to accept or decline the invitation.',
            ].join('\n'),
            components: [buttons],
        });

        inviteMessageSent = true;
    } catch (error) {
        logger.warn(
            'Failed to send team invitation DM',
            {
                guildId: interaction.guildId,
                teamId,
                inviteId,
                userId: player.id,
                error: error.message,
            },
        );
    }

    await InteractionHelper.safeEditReply(
        interaction,
        {
            content: [
                '✅ **Team invitation created**',
                '',
                `**Player:** ${player}`,
                `**Team:** ${result.team.name}`,
                `**Position:** ${POSITION_NAMES[position]}`,
                `**Expires:** <t:${Math.floor(
                    new Date(
                        result.invite.expires_at,
                    ).getTime() / 1000,
                )}:R>`,
                '',
                inviteMessageSent
                    ? '📩 The invitation was sent to the player by DM.'
                    : '⚠️ The invitation was created, but I could not send the player a DM.',
                '',
                `Invitation ID: \`${inviteId}\``,
            ].join('\n'),
        },
    );
}

/**
 * Handles /team remove.
 */
async function handleRemove(interaction) {
    const teamId = getTeamId(interaction);

    const player = interaction.options.getUser(
        'player',
        true,
    );

    // Fetch the team before removing the member so we still know
    // which Discord role must be removed afterwards.
    const team = await TeamService.get(
        interaction.guildId,
        teamId,
    );

    const removed = await TeamService.removePlayer({
        guildId: interaction.guildId,
        teamId,
        userId: player.id,
        removedBy: interaction.user.id,
        isStaff: isHcdStaff(interaction),
    });

    if (!removed) {
        throw new TitanBotError(
            'Team member removal failed',
            ErrorTypes.VALIDATION,
            'The player could not be removed from the team.',
        );
    }

    const roleWarnings = [];

    try {
        const member = await interaction.guild.members.fetch(
            player.id,
        );

        if (team.role_id) {
            try {
                if (member.roles.cache.has(team.role_id)) {
                    await member.roles.remove(
                        team.role_id,
                        `Removed from HCD team ${team.name}`,
                    );
                }
            } catch (error) {
                logger.warn(
                    'Failed to remove team role after roster removal',
                    {
                        guildId: interaction.guildId,
                        teamId,
                        userId: player.id,
                        roleId: team.role_id,
                        error: error.message,
                    },
                );

                roleWarnings.push(
                    'I could not remove the team Discord role.',
                );
            }
        }

        const freeAgentRoleId =
            process.env.HCD_FREE_AGENT_ROLE_ID;

        if (freeAgentRoleId) {
            try {
                if (!member.roles.cache.has(freeAgentRoleId)) {
                    await member.roles.add(
                        freeAgentRoleId,
                        `Removed from HCD team ${team.name}`,
                    );
                }
            } catch (error) {
                logger.warn(
                    'Failed to restore free-agent role after roster removal',
                    {
                        guildId: interaction.guildId,
                        teamId,
                        userId: player.id,
                        roleId: freeAgentRoleId,
                        error: error.message,
                    },
                );

                roleWarnings.push(
                    'I could not restore the Jugador Libre role.',
                );
            }
        } else {
            logger.warn(
                'HCD_FREE_AGENT_ROLE_ID is not configured',
                {
                    guildId: interaction.guildId,
                    teamId,
                    userId: player.id,
                },
            );

            roleWarnings.push(
                'Jugador Libre could not be restored because HCD_FREE_AGENT_ROLE_ID is not configured.',
            );
        }
    } catch (error) {
        logger.warn(
            'Failed to fetch guild member after roster removal',
            {
                guildId: interaction.guildId,
                teamId,
                userId: player.id,
                error: error.message,
            },
        );

        roleWarnings.push(
            'The roster was updated, but Discord roles could not be synchronized.',
        );
    }

    await InteractionHelper.safeEditReply(
        interaction,
        {
            content: [
                '✅ **Player removed from team**',
                '',
                `**Player:** ${player}`,
                `**Team:** ${team.name}${
                    team.tag ? ` [${team.tag}]` : ''
                }`,
                `**Team ID:** \`${teamId}\``,
                '',
                roleWarnings.length
                    ? `⚠️ ${roleWarnings.join(' ')}`
                    : '🔄 Team role removed and Jugador Libre restored.',
            ].join('\n'),
        },
    );
}

/**
 * Handles /team move.
 */
async function handleMove(interaction) {
    const teamId = getTeamId(interaction);

    const player = interaction.options.getUser(
        'player',
        true,
    );

    const position =
        interaction.options.getString(
            'position',
            true,
        );

    const result = await TeamService.movePlayer({
        guildId: interaction.guildId,
        teamId,
        userId: player.id,
        newPosition: position,
        movedBy: interaction.user.id,
        isStaff: isHcdStaff(interaction),
    });

    await InteractionHelper.safeEditReply(
        interaction,
        {
            content: [
                '✅ **Roster position updated**',
                '',
                `**Player:** ${player}`,
                `**New Position:** ${POSITION_NAMES[position]}`,
                `**Team ID:** \`${teamId}\``,
            ].join('\n'),
        },
    );

    return result;
}

/**
 * Handles /team roster.
 */
async function handleRoster(interaction) {
    const teamId = getTeamId(interaction);

    const roster = await TeamService.getRoster(
        interaction.guildId,
        teamId,
    );

    const {
        team,
        captains,
        mains,
        substitutes,
        counts,
    } = roster;

    const content = [
        `## ${team.name}${team.tag ? ` [${team.tag}]` : ''}`,
        '',
        `**Líder de Facción:** ${formatFactionLeader(team.manager_id)}`,
        `**Players:** ${counts.total}/9`,
        '',
        `### Capitanes — ${counts.captain}/${TEAM_LIMITS.captain}`,
        formatRosterSection(captains),
        '',
        `### Main Roster — ${counts.main}/${TEAM_LIMITS.main}`,
        formatRosterSection(mains),
        '',
        `### Sub Roster — ${counts.sub}/${TEAM_LIMITS.sub}`,
        formatRosterSection(substitutes),
    ];

    if (team.discord_url) {
        content.push(
            '',
            `**Faction Discord:** ${team.discord_url}`,
        );
    }

    await InteractionHelper.safeEditReply(
        interaction,
        {
            content: content.join('\n'),
        },
    );
}
/**
 * Handles /team panel.
 * Publishes either the official teams panel or
 * the public team application panel.
 */
async function handlePanel(interaction) {
    if (!isHcdStaff(interaction)) {
        throw new TitanBotError(
            'Missing team panel permission',
            ErrorTypes.PERMISSION,
            'Only HCD Staff can publish HCD panels.',
        );
    }

    const panelType =
        interaction.options.getString('type', true);

    if (panelType === 'applications') {
        await TeamApplicationPanelService.publish(
            interaction.channel,
        );

        await InteractionHelper.safeEditReply(
            interaction,
            {
                content:
                    '✅ **Team application panel published successfully**',
            },
        );

        return;
    }

    const result =
        await TeamPanelService.publishOrRefresh(
            interaction.channel,
        );

    await InteractionHelper.safeEditReply(
        interaction,
        {
            content: result.created
                ? '✅ **Teams panel created successfully**'
                : '🔄 **Teams panel refreshed successfully**',
        },
    );
}

export default {
    data: new SlashCommandBuilder()
        .setName('team')
        .setDescription('Manage HCD competitive teams')

        .addSubcommand((subcommand) =>
            subcommand
                .setName('create')
                .setDescription(
                    'Create a new HCD competitive team',
                )
                .addStringOption((option) =>
                    option
                        .setName('name')
                        .setDescription('Team name')
                        .setRequired(true)
                        .setMaxLength(100),
                )
                .addUserOption((option) =>
                    option
                        .setName('manager')
                        .setDescription(
                            'Líder de Facción (optional)',
                        ),
                )
                .addStringOption((option) =>
                    option
                        .setName('tag')
                        .setDescription(
                            'Short team tag (used for the automatic Team Role)',
                        )
                        .setMaxLength(20),
                )
                .addStringOption((option) =>
                    option
                        .setName('discord')
                        .setDescription(
                            'Faction Discord invite URL',
                        ),
                )
                .addAttachmentOption((option) =>
                    option
                        .setName('logo')
                        .setDescription(
                            'Upload the team logo (also used for the panel button)',
                        ),
                ),
        )

        .addSubcommand((subcommand) =>
            subcommand
                .setName('edit')
                .setDescription(
                    'Edit an existing HCD competitive team',
                )
                .addIntegerOption((option) =>
                    option
                        .setName('team')
                        .setDescription('Team ID')
                        .setRequired(true)
                        .setMinValue(1),
                )
                .addStringOption((option) =>
                    option
                        .setName('name')
                        .setDescription(
                            'New team name',
                        )
                        .setMaxLength(100),
                )
                .addStringOption((option) =>
                    option
                        .setName('tag')
                        .setDescription(
                            'New team tag',
                        )
                        .setMaxLength(20),
                )
                .addUserOption((option) =>
                    option
                        .setName('manager')
                        .setDescription(
                            'Nuevo Líder de Facción',
                        ),
                )
                .addBooleanOption((option) =>
                    option
                        .setName('clear_manager')
                        .setDescription(
                            'Remove the current Líder de Facción',
                        ),
                )
                .addStringOption((option) =>
                    option
                        .setName('discord')
                        .setDescription(
                            'Faction Discord invite URL',
                        ),
                )
                .addAttachmentOption((option) =>
                    option
                        .setName('logo')
                        .setDescription(
                            'Upload the team logo (also used for the panel button)',
                        ),
                ),
        )

        .addSubcommand((subcommand) =>
            subcommand
                .setName('disband')
                .setDescription(
                    'Disband an HCD competitive team',
                )
                .addIntegerOption((option) =>
                    option
                        .setName('team')
                        .setDescription('Team ID')
                        .setRequired(true)
                        .setMinValue(1),
                ),
        )

        .addSubcommand((subcommand) =>
            subcommand
                .setName('invite')
                .setDescription(
                    'Invite a player to a team',
                )
                .addIntegerOption((option) =>
                    option
                        .setName('team')
                        .setDescription('Team ID')
                        .setRequired(true)
                        .setMinValue(1),
                )
                .addUserOption((option) =>
                    option
                        .setName('player')
                        .setDescription(
                            'Player to invite',
                        )
                        .setRequired(true),
                )
                .addStringOption((option) =>
                    option
                        .setName('position')
                        .setDescription(
                            'Competitive roster position',
                        )
                        .setRequired(true)
                        .addChoices(
                            {
                                name: 'Capitán',
                                value: 'captain',
                            },
                            {
                                name: 'Main Roster',
                                value: 'main',
                            },
                            {
                                name: 'Sub Roster',
                                value: 'sub',
                            },
                        ),
                ),
        )

        .addSubcommand((subcommand) =>
            subcommand
                .setName('remove')
                .setDescription(
                    'Remove a player from a team',
                )
                .addIntegerOption((option) =>
                    option
                        .setName('team')
                        .setDescription('Team ID')
                        .setRequired(true)
                        .setMinValue(1),
                )
                .addUserOption((option) =>
                    option
                        .setName('player')
                        .setDescription(
                            'Player to remove',
                        )
                        .setRequired(true),
                ),
        )

        .addSubcommand((subcommand) =>
            subcommand
                .setName('move')
                .setDescription(
                    'Move a player to another roster position',
                )
                .addIntegerOption((option) =>
                    option
                        .setName('team')
                        .setDescription('Team ID')
                        .setRequired(true)
                        .setMinValue(1),
                )
                .addUserOption((option) =>
                    option
                        .setName('player')
                        .setDescription(
                            'Player to move',
                        )
                        .setRequired(true),
                )
                .addStringOption((option) =>
                    option
                        .setName('position')
                        .setDescription(
                            'New roster position',
                        )
                        .setRequired(true)
                        .addChoices(
                            {
                                name: 'Capitán',
                                value: 'captain',
                            },
                            {
                                name: 'Main Roster',
                                value: 'main',
                            },
                            {
                                name: 'Sub Roster',
                                value: 'sub',
                            },
                        ),
                ),
        )

        .addSubcommand((subcommand) =>
            subcommand
                .setName('roster')
                .setDescription(
                    'View the current roster of a team',
                )
                .addIntegerOption((option) =>
                    option
                        .setName('team')
                        .setDescription('Team ID')
                        .setRequired(true)
                        .setMinValue(1),
                ),
        )

        .addSubcommand((subcommand) =>
            subcommand
                .setName('panel')
                .setDescription(
                    'Publish an HCD team panel',
                )
                .addStringOption((option) =>
                    option
                        .setName('type')
                        .setDescription(
                            'Panel to publish',
                        )
                        .setRequired(true)
                        .addChoices(
                            {
                                name: 'Equipos',
                                value: 'teams',
                            },
                            {
                                name: 'Inscripciones',
                                value: 'applications',
                            },
                        ),
                ),
        ),

    category: 'teams',
async execute(interaction, config, client) {
   const deferSuccess =
    await InteractionHelper.safeDefer(
        interaction,
        {
            ephemeral: true,
        },
    );

        if (!deferSuccess) {
            logger.warn(
                'Team interaction defer failed',
                {
                    userId: interaction.user.id,
                    guildId: interaction.guildId,
                    commandName: 'team',
                },
            );

            return;
        }

        if (!interaction.inGuild()) {
            throw new TitanBotError(
                'Team command used outside guild',
                ErrorTypes.USER_INPUT,
                'This command can only be used inside the HCD server.',
            );
        }

        const subcommand =
            interaction.options.getSubcommand();

        switch (subcommand) {
            case 'create':
                await handleCreate(interaction);
                break;

            case 'edit':
                await handleEdit(interaction);
                break;

            case 'disband':
                await handleDisband(interaction);
                break;

            case 'invite':
                await handleInvite(interaction);
                break;

            case 'remove':
                await handleRemove(interaction);
                break;

            case 'move':
                await handleMove(interaction);
                break;

            case 'roster':
                await handleRoster(interaction);
                break;

            case 'panel':
                await handlePanel(interaction);
                break;

            default:
                throw new TitanBotError(
                    'Unknown team subcommand',
                    ErrorTypes.USER_INPUT,
                    'Unknown team command.',
                    {
                        subcommand,
                    },
                );
        }
    },
};
