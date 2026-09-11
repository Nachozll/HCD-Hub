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

            await interaction.followUp({
                content: [
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
                ].join('\n'),
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
