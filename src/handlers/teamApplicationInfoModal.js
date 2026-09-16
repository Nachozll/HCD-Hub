import {
    ActionRowBuilder,
    UserSelectMenuBuilder,
} from 'discord.js';

import TeamApplicationSessionService
    from '../services/teamApplicationSessionService.js';

export const teamApplicationInfoModalHandler = {
    name: 'team_application_info',

    async execute(interaction, client, args) {
        const applicationType = args?.[0];

        if (
            applicationType !== 'faction' &&
            applicationType !== 'independent'
        ) {
            await interaction.reply({
                content:
                    '❌ El tipo de equipo no es válido.',
                ephemeral: true,
            });

            return;
        }

        const name =
            interaction.fields
                .getTextInputValue('team_name')
                .trim();

        const tag =
            interaction.fields
                .getTextInputValue('team_tag')
                .trim();

        const discordUrl =
            interaction.fields
                .getTextInputValue('discord_url')
                .trim();

        TeamApplicationSessionService.create(
            interaction.guildId,
            interaction.user.id,
            {
                type: applicationType,
                name,
                tag,
                discordUrl:
                    discordUrl || null,
            },
        );

        const captainSelect =
            new UserSelectMenuBuilder()
                .setCustomId(
                    'team_application_captains',
                )
                .setPlaceholder(
                    'Selecciona los Capitanes',
                )
                .setMinValues(1)
                .setMaxValues(2);

        const row =
            new ActionRowBuilder()
                .addComponents(captainSelect);

        await interaction.reply({
            embeds: [
                {
                    color: 0xC9A227,

                    title:
                        'HCD | CAPITANES',

                    description: [
                        `Ahora selecciona los Capitanes de **${name} [${tag}]**`,
                        '',
                        'Los Capitanes formarán parte del roster competitivo y podrán administrar a los jugadores **Main Roster** y **Sub Roster** de su equipo',
                        '',
                        '**Selecciona 1 o 2 Capitanes**',
                    ].join('\n'),

                    footer: {
                        text:
                            'Podrás revisar toda la información antes de enviar la solicitud',
                    },
                },
            ],

            components: [row],

            ephemeral: true,
        });
    },
};
