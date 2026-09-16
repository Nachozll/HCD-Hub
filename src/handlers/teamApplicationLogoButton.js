import {
    FileUploadBuilder,
    LabelBuilder,
    ModalBuilder,
} from 'discord.js';

import TeamApplicationSessionService
    from '../services/teamApplicationSessionService.js';

export const teamApplicationLogoButtonHandler = {
    name: 'team_application_logo',

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

        const logoUpload =
            new FileUploadBuilder()
                .setCustomId('team_logo_file')
                .setMinValues(1)
                .setMaxValues(1)
                .setRequired(true);

        const logoLabel =
            new LabelBuilder()
                .setLabel('Logo del equipo')
                .setDescription(
                    'Sube el logo que identificará a tu equipo dentro de HCD.',
                )
                .setFileUploadComponent(
                    logoUpload,
                );

        const modal =
            new ModalBuilder()
                .setCustomId(
                    'team_application_logo_upload',
                )
                .setTitle(
                    'Añadir Logo del Equipo',
                )
                .addLabelComponents(
                    logoLabel,
                );

        await interaction.showModal(
            modal,
        );
    },
};
