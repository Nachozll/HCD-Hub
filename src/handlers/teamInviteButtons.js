import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
} from 'discord.js';

import TeamService from '../services/teamService.js';
import { InteractionHelper } from '../utils/interactionHelper.js';
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
 * Returns a disabled version of the invite action buttons.
 */
function buildDisabledInviteButtons(inviteId, accepted = false) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`team_invite_accept:${inviteId}`)
            .setLabel(accepted ? 'Accepted' : 'Accept')
            .setStyle(ButtonStyle.Success)
            .setDisabled(true),

        new ButtonBuilder()
            .setCustomId(`team_invite_decline:${inviteId}`)
            .setLabel(accepted ? 'Decline' : 'Declined')
            .setStyle(ButtonStyle.Danger)
            .setDisabled(true),
    );
}

/**
 * Validates an invitation ID received from a dynamic button customId.
 */
function getInviteId(args = []) {
    const inviteId = Number(args?.[0]);

    if (!Number.isInteger(inviteId) || inviteId <= 0) {
        throw createError(
            'Invalid team invitation ID',
            ErrorTypes.VALIDATION,
            'This team invitation is invalid.',
            {
                inviteId: args?.[0],
            },
        );
    }

    return inviteId;
}

/**
 * Handles accepting a team invitation.
 */
const teamInviteAcceptHandler = {
    name: 'team_invite_accept',

    async execute(interaction, client, args) {
        try {
            if (!interaction.inGuild()) {
                throw createError(
                    'Team invitation button used outside guild',
                    ErrorTypes.VALIDATION,
                    'This invitation can only be accepted inside the HCD server.',
                );
            }

            const inviteId = getInviteId(args);

            const deferSuccess =
                await InteractionHelper.safeDefer(
                    interaction,
                    {
                        flags: MessageFlags.Ephemeral,
                    },
                );

            if (!deferSuccess) {
                return;
            }

            const result = await TeamService.acceptInvite(
                interaction.guildId,
                inviteId,
                interaction.user.id,
            );

            const team = result.team;
            const member = result.member;

            await interaction.message.edit({
                components: [
                    buildDisabledInviteButtons(
                        inviteId,
                        true,
                    ),
                ],
            }).catch((error) => {
                logger.warn(
                    'Failed to disable accepted team invitation buttons',
                    {
                        guildId: interaction.guildId,
                        inviteId,
                        userId: interaction.user.id,
                        error: error.message,
                    },
                );
            });

            await InteractionHelper.safeEditReply(
                interaction,
                {
                    content: [
                        '✅ **Team invitation accepted**',
                        '',
                        `**Team:** ${team.name}`,
                        `**Position:** ${
                            POSITION_NAMES[member.position] ??
                            member.position
                        }`,
                    ].join('\n'),
                },
            );

            logger.info('Team invitation accepted through button', {
                guildId: interaction.guildId,
                inviteId,
                teamId: team.id,
                userId: interaction.user.id,
                position: member.position,
            });
        } catch (error) {
            await handleInteractionError(
                interaction,
                error,
                {
                    type: 'button',
                    handler: 'team_invite_accept',
                    customId: interaction.customId,
                },
            );
        }
    },
};

/**
 * Handles declining a team invitation.
 */
const teamInviteDeclineHandler = {
    name: 'team_invite_decline',

    async execute(interaction, client, args) {
        try {
            if (!interaction.inGuild()) {
                throw createError(
                    'Team invitation button used outside guild',
                    ErrorTypes.VALIDATION,
                    'This invitation can only be declined inside the HCD server.',
                );
            }

            const inviteId = getInviteId(args);

            const deferSuccess =
                await InteractionHelper.safeDefer(
                    interaction,
                    {
                        flags: MessageFlags.Ephemeral,
                    },
                );

            if (!deferSuccess) {
                return;
            }

            const declined =
                await TeamService.declineInvite(
                    interaction.guildId,
                    inviteId,
                    interaction.user.id,
                );

            await interaction.message.edit({
                components: [
                    buildDisabledInviteButtons(
                        inviteId,
                        false,
                    ),
                ],
            }).catch((error) => {
                logger.warn(
                    'Failed to disable declined team invitation buttons',
                    {
                        guildId: interaction.guildId,
                        inviteId,
                        userId: interaction.user.id,
                        error: error.message,
                    },
                );
            });

            await InteractionHelper.safeEditReply(
                interaction,
                {
                    content: [
                        '❌ **Team invitation declined**',
                        '',
                        `**Invitation ID:** \`${declined.id}\``,
                    ].join('\n'),
                },
            );

            logger.info('Team invitation declined through button', {
                guildId: interaction.guildId,
                inviteId,
                teamId: declined.team_id,
                userId: interaction.user.id,
            });
        } catch (error) {
            await handleInteractionError(
                interaction,
                error,
                {
                    type: 'button',
                    handler: 'team_invite_decline',
                    customId: interaction.customId,
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
