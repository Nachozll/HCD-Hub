import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
} from 'discord.js';

import TeamApplicationSessionService
    from '../services/teamApplicationSessionService.js';

const ALLOWED_IMAGE_TYPES = [
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
];

export const teamApplicationLogoModalHandler = {
    name: 'team_application_logo_upload',

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
         * Get the file uploaded through the
         * File Upload component inside the modal.
         */
        const uploadedFiles =
            interaction.fields.getUploadedFiles(
                'team_logo_file',
            );

        const logo =
            uploadedFiles?.first();

        if (!logo) {
            await interaction.reply({
                content:
                    '❌ No se pudo obtener el logo. Intenta subir el archivo nuevamente.',
                ephemeral: true,
            });

            return;
        }

        /*
         * Only image files are accepted as team logos.
         */
        if (
            !logo.contentType ||
            !ALLOWED_IMAGE_TYPES.includes(
                logo.contentType,
            )
        ) {
            await interaction.reply({
                content:
                    '❌ El archivo debe ser una imagen PNG, JPG/JPEG, WEBP o GIF.',
                ephemeral: true,
            });

            return;
        }

        const updatedSession =
            TeamApplicationSessionService.update(
                interaction.guildId,
                interaction.user.id,
                {
                    logoUrl: logo.url,
                },
            );

        if (!updatedSession) {
            await interaction.reply({
                content:
                    '❌ No se pudo guardar el logo porque tu sesión expiró.',
                ephemeral: true,
            });

            return;
        }

        const captainMentions =
            updatedSession.captainIds
                .map(
                    captainId =>
                        `<@${captainId}>`,
                )
                .join(', ');

        const typeText =
            updatedSession.type === 'faction'
                ? 'Facción / Comunidad'
                : 'Equipo Independiente';

        const description = [
            'Revisa cuidadosamente la información antes de enviar tu solicitud',
            '',
            `🏷️ **Nombre:** ${updatedSession.name}`,
            `🔖 **TAG:** ${updatedSession.tag}`,
            `🏛️ **Tipo:** ${typeText}`,
            '',
            `👥 **Capitanes:** ${captainMentions || 'Sin Capitanes'}`,
        ];

        if (
            updatedSession.type === 'faction'
        ) {
            description.push(
                `👑 **Líder de Facción:** <@${updatedSession.managerId}>`,
            );
        }

        description.push(
            '',
            `🔗 **Discord:** ${updatedSession.discordUrl || 'No proporcionado'}`,
            '',
            '🖼️ **Logo:** Guardado correctamente',
            '',
            'Si toda la información es correcta, pulsa **Enviar Solicitud**',
        );

        const submitButton =
            new ButtonBuilder()
                .setCustomId(
                    'team_application_submit',
                )
                .setLabel(
                    'Enviar Solicitud',
                )
                .setEmoji('✅')
                .setStyle(
                    ButtonStyle.Success,
                );

        const row =
            new ActionRowBuilder()
                .addComponents(
                    submitButton,
                );

        await interaction.reply({
            embeds: [
                {
                    color: 0xC9A227,

                    title:
                        'HCD | RESUMEN DE SOLICITUD',

                    description:
                        description.join('\n'),

                    image: {
                        url:
                            updatedSession.logoUrl,
                    },

                    footer: {
                        text:
                            'La solicitud todavía no ha sido enviada',
                    },
                },
            ],

            components: [row],

            ephemeral: true,
        });
    },
};
