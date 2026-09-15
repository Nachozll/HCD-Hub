import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
} from 'discord.js';

export const teamApplicationStartHandler = {
    name: 'team_application_start',

    async execute(interaction) {
        const components = [
            new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(
                            'team_application_type:faction',
                        )
                        .setLabel('Facción / Comunidad')
                        .setEmoji('🏛️')
                        .setStyle(
                            ButtonStyle.Primary,
                        ),

                    new ButtonBuilder()
                        .setCustomId(
                            'team_application_type:independent',
                        )
                        .setLabel('Equipo Independiente')
                        .setEmoji('👥')
                        .setStyle(
                            ButtonStyle.Secondary,
                        ),
                ),
        ];

        await interaction.reply({
            embeds: [
                {
                    color: 0xC9A227,
                    title:
                        'HCD | INSCRIPCIÓN DE EQUIPO',
                    description: [
                        'Vamos a recopilar la información necesaria para enviar tu equipo a revisión de la Administración de HCD',
                        '',
                        '**Primero, selecciona qué tipo de equipo quieres registrar:**',
                        '',
                        '🏛️ **Facción / Comunidad**',
                        'El equipo pertenece a una facción o comunidad existente',
                        '',
                        '👥 **Equipo Independiente**',
                        'El equipo está formado por jugadores independientes y no necesita un Líder de Facción',
                        '',
                        '*Podrás revisar la información antes de enviar la solicitud*',
                    ].join('\n'),
                },
            ],
            components,
            ephemeral: true,
        });
    },
};
