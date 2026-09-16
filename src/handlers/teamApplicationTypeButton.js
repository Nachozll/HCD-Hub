import {
    ActionRowBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} from 'discord.js';

export const teamApplicationTypeHandler = {
    name: 'team_application_type',

    async execute(interaction, client, args) {
        const applicationType = args?.[0];

        if (
            applicationType !== 'faction' &&
            applicationType !== 'independent'
        ) {
            await interaction.reply({
                content:
                    '❌ Tipo de equipo inválido.',
                ephemeral: true,
            });

            return;
        }

        const modal = new ModalBuilder()
            .setCustomId(
                `team_application_info:${applicationType}`,
            )
            .setTitle(
                applicationType === 'faction'
                    ? 'Inscribir Facción / Comunidad'
                    : 'Inscribir Equipo Independiente',
            );

        const nameInput = new TextInputBuilder()
            .setCustomId('team_name')
            .setLabel('Nombre del equipo')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder(
                'Ejemplo: Black Akron',
            )
            .setRequired(true)
            .setMinLength(2)
            .setMaxLength(100);

        const tagInput = new TextInputBuilder()
            .setCustomId('team_tag')
            .setLabel('TAG del equipo')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder(
                'Ejemplo: BA',
            )
            .setRequired(true)
            .setMaxLength(20);

        const discordInput =
            new TextInputBuilder()
                .setCustomId('discord_url')
                .setLabel(
                    'Discord del equipo (opcional)',
                )
                .setStyle(TextInputStyle.Short)
                .setPlaceholder(
                    'https://discord.gg/...',
                )
                .setRequired(false)
                .setMaxLength(250);

        modal.addComponents(
            new ActionRowBuilder()
                .addComponents(nameInput),

            new ActionRowBuilder()
                .addComponents(tagInput),

            new ActionRowBuilder()
                .addComponents(discordInput),
        );

        await interaction.showModal(modal);
    },
};
