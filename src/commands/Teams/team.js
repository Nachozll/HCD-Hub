import {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
} from 'discord.js';

import TeamService, {
    TEAM_LIMITS,
} from '../../services/teamService.js';

import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';
import {
    TitanBotError,
    ErrorTypes,
} from '../../utils/errorHandler.js';

const POSITION_NAMES = Object.freeze({
    captain: 'Captain',
    main: 'Main Roster',
    sub: 'Substitute Roster',
});

/**
 * Returns whether the interaction member has HCD Staff-level
 * permissions for team management.
 *
 * For now this uses Discord's ManageGuild permission.
 * Later this can be replaced/extended with HCD-specific Staff roles.
 */
function isHcdStaff(interaction) {
    return interaction.memberPermissions?.has(
        PermissionFlagsBits.ManageGuild,
    ) ?? false;
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

    const tag = interaction.options.getString('tag');

    const manager = interaction.options.getUser(
        'manager',
        true,
    );

    const role = interaction.options.getRole('role');

    const discordUrl =
        interaction.options.getString('discord');

    const logoUrl =
        interaction.options.getString('logo');

    if (manager.bot) {
        throw new TitanBotError(
            'Bot cannot manage team',
            ErrorTypes.USER_INPUT,
            'A bot cannot be assigned as Team Manager.',
        );
    }

    const team = await TeamService.create({
        guildId: interaction.guildId,
        name,
        tag,
        managerId: manager.id,
        roleId: role?.id ?? null,
        discordUrl,
        logoUrl,
    });

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
                `**Team Manager:** <@${team.manager_id}>`,
                `**Team ID:** \`${team.id}\``,
                team.role_id
                    ? `**Team Role:** <@&${team.role_id}>`
                    : null,
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
    if (!isHcdStaff(interaction)) {
        throw new TitanBotError(
            'Missing team edit permission',
            ErrorTypes.PERMISSION,
            'Only HCD Staff can edit teams.',
        );
    }

    const teamId = getTeamId(interaction);

    const name =
        interaction.options.getString('name');

    const tag =
        interaction.options.getString('tag');

    const manager =
        interaction.options.getUser('manager');

    const role =
        interaction.options.getRole('role');

    const discordUrl =
        interaction.options.getString('discord');

    const logoUrl =
        interaction.options.getString('logo');

    if (manager?.bot) {
        throw new TitanBotError(
            'Bot cannot manage team',
            ErrorTypes.USER_INPUT,
            'A bot cannot be assigned as Team Manager.',
        );
    }

    if (
        name === null &&
        tag === null &&
        manager === null &&
        role === null &&
        discordUrl === null &&
        logoUrl === null
    ) {
        throw new TitanBotError(
            'No team edit fields provided',
            ErrorTypes.USER_INPUT,
            'You must provide at least one field to update.',
        );
    }

    const team = await TeamService.update({
        guildId: interaction.guildId,
        teamId,
        name:
            name ?? undefined,
        tag:
            tag ?? undefined,
        managerId:
            manager?.id ?? undefined,
        roleId:
            role?.id ?? undefined,
        discordUrl:
            discordUrl ?? undefined,
        logoUrl:
            logoUrl ?? undefined,
    });

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
                `**Team Manager:** <@${team.manager_id}>`,
                team.role_id
                    ? `**Team Role:** <@&${team.role_id}>`
                    : '**Team Role:** None',
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
        `**Team Manager:** <@${team.manager_id}>`,
        `**Players:** ${counts.total}/9`,
        '',
        `### Captains — ${counts.captain}/${TEAM_LIMITS.captain}`,
        formatRosterSection(captains),
        '',
        `### Main Roster — ${counts.main}/${TEAM_LIMITS.main}`,
        formatRosterSection(mains),
        '',
        `### Substitute Roster — ${counts.sub}/${TEAM_LIMITS.sub}`,
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
                            'Team Manager / faction leader',
                        )
                        .setRequired(true),
                )
                .addStringOption((option) =>
                    option
                        .setName('tag')
                        .setDescription(
                            'Short team tag',
                        )
                        .setMaxLength(20),
                )
                .addRoleOption((option) =>
                    option
                        .setName('role')
                        .setDescription(
                            'Discord role assigned to the team',
                        ),
                )
                .addStringOption((option) =>
                    option
                        .setName('discord')
                        .setDescription(
                            'Faction Discord invite URL',
                        ),
                )
                .addStringOption((option) =>
                    option
                        .setName('logo')
                        .setDescription(
                            'Team logo image URL',
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
                            'New Team Manager',
                        ),
                )
                .addRoleOption((option) =>
                    option
                        .setName('role')
                        .setDescription(
                            'Discord role assigned to the team',
                        ),
                )
                .addStringOption((option) =>
                    option
                        .setName('discord')
                        .setDescription(
                            'Faction Discord invite URL',
                        ),
                )
                .addStringOption((option) =>
                    option
                        .setName('logo')
                        .setDescription(
                            'Team logo image URL',
                        ),
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
                                name: 'Captain',
                                value: 'captain',
                            },
                            {
                                name: 'Main Roster',
                                value: 'main',
                            },
                            {
                                name: 'Substitute Roster',
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
                                name: 'Captain',
                                value: 'captain',
                            },
                            {
                                name: 'Main Roster',
                                value: 'main',
                            },
                            {
                                name: 'Substitute Roster',
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
        ),

    category: 'teams',

    async execute(interaction, config, client) {
        const deferSuccess =
            await InteractionHelper.safeDefer(
                interaction,
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
