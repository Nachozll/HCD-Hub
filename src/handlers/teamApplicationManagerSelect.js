import TeamApplicationSessionService
    from '../services/teamApplicationSessionService.js';

export const teamApplicationManagerHandler = {
    name: 'team_application_manager',

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

        /*
         * This step is only available for
         * faction/community teams.
         */
        if (session.type !== 'faction') {
            await interaction.reply({
                content:
                    '❌ Este equipo no necesita seleccionar un Líder de Facción.',
                ephemeral: true,
            });

            return;
        }

        const managerIds =
            interaction.values || [];

        if (managerIds.length !== 1) {
            await interaction.reply({
                content:
                    '❌ Debes seleccionar exactamente 1 Líder de Facción.',
                ephemeral: true,
            });

            return;
        }

        const managerId =
            managerIds[0];

        TeamApplicationSessionService.update(
            interaction.guildId,
            interaction.user.id,
            {
                managerId,
            },
        );

        /*
         * Manager saved successfully.
         * The next stage will handle the team logo.
         */
        await interaction.update({
            embeds: [
                {
                    color: 0xC9A227,

                    title:
                        'HCD | LOGO DEL EQUIPO',

                    description: [
                        `El Líder de Facción de **${session.name} [${session.tag}]** fue seleccionado correctamente`,
                        '',
                        `👑 Líder de Facción: <@${managerId}>`,
                        '',
                        'Ahora deberás añadir el **logo de tu equipo o facción**',
                        '',
                        '🖼️ El logo será utilizado para identificar a tu equipo dentro de HCD',
                        '',
                        '✅ **Líder de Facción guardado correctamente**',
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
