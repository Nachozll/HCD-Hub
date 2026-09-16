import {
    ActionRowBuilder,
    UserSelectMenuBuilder,
} from 'discord.js';

import TeamApplicationSessionService
    from '../services/teamApplicationSessionService.js';

export const teamApplicationCaptainsHandler = {
    name: 'team_application_captains',

    async execute(interaction) {
        const session =
            TeamApplicationSessionService.get(
                interaction.guildId,
                interaction.user.id,
            );

        if (!session) {
            await interaction.reply({
                content:
                    '❌ Tu sesión de inscripción expiró. Pulsa **Inscribir Equipo** nuevamente para comenzar.',
                ephemeral: true,
            });

            return;
        }

        const captainIds =
            interaction.values || [];

        if (
            captainIds.length < 1 ||
            captainIds.length > 2
        ) {
            await interaction.reply({
                content:
                    '❌ Debes seleccionar 1 o 2 Capitanes.',
                ephemeral: true,
            });

            return;
        }

        TeamApplicationSessionService.update(
            interaction.guildId,
            interaction.user.id,
            {
                captainIds,
            },
        );

        /*
         * Faction/community teams need one additional
         * leadership step.
         */
        if (session.type === 'faction') {
            const leaderSelect =
                new UserSelectMenuBuilder()
                    .setCustomId(
                        'team_application_manager',
                    )
                    .setPlaceholder(
                        'Selecciona al Líder de Facción',
                    )
                    .setMinValues(1)
                    .setMaxValues(1);

            const row =
                new ActionRowBuilder()
                    .addComponents(
                        leaderSelect,
                    );

            await interaction.update({
                embeds: [
                    {
                        color: 0xC9A227,

                        title:
                            'HCD | LÍDER DE FACCIÓN',

                        description: [
                            `Los Capitanes de **${session.name} [${session.tag}]** fueron seleccionados correctamente`,
                            '',
                            'Ahora selecciona al **Líder de Facción** que representará a la facción o comunidad dentro de HCD',
                            '',
                            'El Líder de Facción **no ocupa un puesto dentro del roster competitivo**',
                            '',
                            '**Selecciona 1 Líder de Facción**',
                        ].join('\n'),

                        footer: {
                            text:
                                'Podrás revisar toda la información antes de enviar la solicitud',
                        },
                    },
                ],

                components: [row],
            });

            return;
        }

        /*
         * Independent teams do not have a faction leader,
         * so they skip directly to the next stage.
         */
        await interaction.update({
            embeds: [
                {
                    color: 0xC9A227,

                    title:
                        'HCD | EQUIPO INDEPENDIENTE',

                    description: [
                        `Los Capitanes de **${session.name} [${session.tag}]** fueron seleccionados correctamente`,
                        '',
                        '👥 Este equipo fue registrado como **Equipo Independiente**, por lo que no necesita un Líder de Facción',
                        '',
                        'El siguiente paso será añadir el **logo del equipo**',
                        '',
                        '✅ **Capitanes guardados correctamente**',
                    ].join('\n'),

                    footer: {
                        text:
                            'Podrás revisar toda la información antes de enviar la solicitud',
                    },
                },
            ],

            components: [],
        });
    },
};
