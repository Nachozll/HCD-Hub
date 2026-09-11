import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
} from 'discord.js';

import TeamService from '../services/teamService.js';
import { logger } from '../utils/logger.js';
import {
    createError,
    ErrorTypes,
    handleInteractionError,
} from '../utils/errorHandler.js';

const POSITION_NAMES = Object.freeze({
    captain: 'Captain',
    main: 'Main Roster',
    sub: 'Substitute Roster',
});

/**
 * Returns a disabled version of the invitation buttons.
 */
function buildDisabledInviteButtons(
    guildId,
    inviteId,
    accepted = false,
) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(
                `team_invite_accept:${guildId}:${inviteId}`,
            )
            .setLabel(
                accepted ? 'Accepted' : 'Accept',
            )
            .setStyle(ButtonStyle.Success)
            .setDisabled(true),

        new ButtonBuilder()
            .setCustomId(
                `team_invite_decline:${guildId}:${inviteId}`,
            )
            .setLabel(
                accepted ? 'Decline' : 'Declined',
            )
            .setStyle(ButtonStyle.Danger)
            .setDisabled(true),
    );
}

/**
 * Reads the guild ID and invitation ID
 * from the button custom ID arguments.
 */
function getInviteData(args = []) {
    const guildId = args?.[0];
    const inviteId = Number(args?.[1]);

    if (
        !guildId ||
        !/^\d+$/.test(guildId)
    ) {
        throw createError(
            'Invalid guild ID in team invitation',
            ErrorTypes.VALIDATION,
            'This team invitation contains an invalid server ID.',
            {
                guildId,
            },
        );
    }

    if (
        !Number.isInteger(inviteId) ||
        inviteId <= 0
    ) {
        throw createError(
            'Invalid team invitation ID',
            ErrorTypes.VALIDATION,
            'This team invitation is invalid.',
            {
                inviteId: args?.[1],
            },
        );
    }

    return {
        guildId,
        inviteId,
    };
}

/**
 * Synchronizes Discord roles after a player
 * successfully joins an HCD team.
 */
async function syncAcceptedMemberRoles(
    client,
    guildId,
    userId,
    team,
) {
    const freeAgentRoleId =
        process.env.HCD_FREE_AGENT_ROLE_ID;

    const guild = await client.guilds.fetch(guildId);

    const guildMember =
        await guild.members.fetch(userId);

    const warnings = [];

    if (team.role_id) {
        try {
            await guildMember.roles.add(
                team.role_id,
                `Joined HCD team: ${team.name}`,
            );

            logger.info(
                'HCD team role assigned',
                {
                    guildId,
                    teamId: team.id,
                    userId,
                    roleId: team.role_id,
                },
            );
        } catch (error) {
            warnings.push(
                'The team role could not be assigned.',
            );

            logger.warn(
                'Failed to assign HCD team role',
                {
                    guildId,
                    teamId: team.id,
                    userId,
                    roleId: team.role_id,
                    error: error.message,
                },
            );
        }
    } else {
        warnings.push(
            'This team does not have a Discord role configured.',
        );

        logger.warn(
            'HCD team has no Discord role configured',
            {
                guildId,
                teamId: team.id,
                userId,
            },
        );
    }

    if (freeAgentRoleId) {
        try {
            if (
                guildMember.roles.cache.has(
                    freeAgentRoleId,
                )
            ) {
                await guildMember.roles.remove(
                    freeAgentRoleId,
                    `Joined HCD team: ${team.name}`,
                );

                logger.info(
                    'HCD free agent role removed',
                    {
                        guildId,
                        teamId: team.id,
                        userId,
                        roleId:
                            freeAgentRoleId,
                    },
                );
            }
        } catch (error) {
            warnings.push(
                'The Jugador Libre role could not be removed.',
            );

            logger.warn(
                'Failed to remove HCD free agent role',
                {
                    guildId,
                    teamId: team.id,
                    userId,
                    roleId:
                        freeAgentRoleId,
                    error: error.message,
                },
            );
        }
    } else {
        warnings.push(
            'The Jugador Libre role is not configured.',
        );

        logger.warn(
            'HCD_FREE_AGENT_ROLE_ID is not configured',
            {
                guildId,
                teamId: team.id,
                userId,
            },
        );
    }

    return warnings;
}

/**
 * Accept team invitation button.
 */
const teamInviteAcceptHandler = {
    name: 'team_invite_accept',

    async execute(interaction, client, args) {
        try {
            const {
                guildId,
                inviteId,
            } = getInviteData(args);

            await interaction.deferUpdate();

            const result =
                await TeamService.acceptInvite(
                    guildId,
                    inviteId,
                    interaction.user.id,
                );

            const team = result.team;
            const member = result.member;

            const roleWarnings =
                await syncAcceptedMemberRoles(
                    client,
                    guildId,
                    interaction.user.id,
                    team,
                );

            await interaction.message.edit({
                components: [
                    buildDisabledInviteButtons(
                        guildId,
                        inviteId,
                        true,
                    ),
                ],
            }).catch((error) => {
                logger.warn(
                    'Failed to disable accepted team invitation buttons',
                    {
                        guildId,
                        inviteId,
                        userId:
                            interaction.user.id,
                        error: error.message,
                    },
                );
            });

            const response = [
                '✅ **Team invitation accepted**',
                '',
                `**Team:** ${team.name}${
                    team.tag
                        ? ` [${team.tag}]`
                        : ''
                }`,
                `**Position:** ${
                    POSITION_NAMES[
                        member.position
                    ] ?? member.position
                }`,
                '',
                'You have been added to the competitive roster.',
            ];

            if (roleWarnings.length > 0) {
                response.push(
                    '',
                    '⚠️ **Discord role synchronization warning**',
                    ...roleWarnings.map(
                        (warning) =>
                            `• ${warning}`,
                    ),
                );
            }

            await interaction.followUp({
                content: response.join('\n'),
            });

            logger.info(
                'Team invitation accepted through button',
                {
                    guildId,
                    inviteId,
                    teamId: team.id,
                    userId:
                        interaction.user.id,
                    position:
                        member.position,
                    roleWarnings:
                        roleWarnings.length,
                },
            );
        } catch (error) {
            await handleInteractionError(
                interaction,
                error,
                {
                    type: 'button',
                    handler:
                        'team_invite_accept',
                    customId:
                        interaction.customId,
                },
            );
        }
    },
};

/**
 * Decline team invitation button.
 */
const teamInviteDeclineHandler = {
    name: 'team_invite_decline',

    async execute(interaction, client, args) {
        try {
            const {
                guildId,
                inviteId,
            } = getInviteData(args);

            await interaction.deferUpdate();

            const declined =
                await TeamService.declineInvite(
                    guildId,
                    inviteId,
                    interaction.user.id,
                );

            await interaction.message.edit({
                components: [
                    buildDisabledInviteButtons(
                        guildId,
                        inviteId,
                        false,
                    ),
                ],
            }).catch((error) => {
                logger.warn(
                    'Failed to disable declined team invitation buttons',
                    {
                        guildId,
                        inviteId,
                        userId:
                            interaction.user.id,
                        error: error.message,
                    },
                );
            });

            await interaction.followUp({
                content: [
                    '❌ **Team invitation declined**',
                    '',
                    `**Invitation ID:** \`${declined.id}\``,
                ].join('\n'),
            });

            logger.info(
                'Team invitation declined through button',
                {
                    guildId,
                    inviteId,
                    teamId:
                        declined.team_id,
                    userId:
                        interaction.user.id,
                },
            );
        } catch (error) {
            await handleInteractionError(
                interaction,
                error,
                {
                    type: 'button',
                    handler:
                        'team_invite_decline',
                    customId:
                        interaction.customId,
                },
            );
        }
    },
};

export {
    teamInviteAcceptHandler,
    teamInviteDeclineHandler,
};

export default teamInviteAcceptHandler;
