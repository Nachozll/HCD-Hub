import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
} from 'discord.js';

import TeamApplicationSessionService
    from '../services/teamApplicationSessionService.js';

import TeamApplicationService
    from '../services/teamApplicationService.js';

export const teamApplicationSubmitButtonHandler = {
    name: 'team_application_submit',

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

        const applicationsChannelId =
            process.env
                .HCD_TEAM_APPLICATIONS_CHANNEL_ID;

        if (!applicationsChannelId) {
            await interaction.reply({
                content:
                    '❌ El canal de solicitudes de equipos no está configurado. Contacta a un Administrador de HCD.',
                ephemeral: true,
            });

            return;
        }

        let applicationsChannel =
            interaction.guild.channels.cache.get(
                applicationsChannelId,
            );

        if (!applicationsChannel) {
            applicationsChannel =
                await interaction.guild.channels
                    .fetch(
                        applicationsChannelId,
                    )
                    .catch(() => null);
        }

        if (
            !applicationsChannel ||
            !applicationsChannel.isTextBased()
        ) {
            await interaction.reply({
                content:
                    '❌ No se pudo encontrar el canal de solicitudes de equipos. Contacta a un Administrador de HCD.',
                ephemeral: true,
            });

            return;
        }

        await interaction.deferUpdate();

        const application =
            await TeamApplicationService.submit({
                guildId:
                    interaction.guildId,

                applicantId:
                    interaction.user.id,

                name:
                    session.name,

                tag:
                    session.tag,

                managerId:
                    session.type === 'faction'
                        ? session.managerId
                        : null,

                captainIds:
                    session.captainIds,

                discordUrl:
                    session.discordUrl,

                logoUrl:
                    session.logoUrl,
            });

        const captainMentions =
            session.captainIds
                .map(
                    captainId =>
                        `<@${captainId}>`,
                )
                .join(', ');

        const typeText =
            session.type === 'faction'
                ? 'Facción / Comunidad'
                : 'Equipo Independiente';

        const description = [
            `👤 **Solicitante:** <@${interaction.user.id}>`,
            '',
            `🏷️ **Nombre:** ${session.name}`,
            `🔖 **TAG:** ${session.tag || 'Sin TAG'}`,
            `🏛️ **Tipo:** ${typeText}`,
            '',
            `👥 **Capitanes:** ${captainMentions || 'Sin Capitanes'}`,
        ];

        if (
            session.type === 'faction' &&
            session.managerId
        ) {
            description.push(
                `👑 **Líder de Facción:** <@${session.managerId}>`,
            );
        }

        description.push(
            '',
            `🔗 **Discord:** ${session.discordUrl || 'No proporcionado'}`,
            '',
            '🟡 **Estado:** Pendiente',
            '',
            `🆔 **Solicitud:** \`${application.id}\``,
        );

        const applicationEmbed =
            new EmbedBuilder()
                .setColor(0xC9A227)
                .setTitle(
                    'HCD | NUEVA SOLICITUD DE EQUIPO',
                )
                .setDescription(
                    description.join('\n'),
                )
                .setFooter({
                    text:
                        `Solicitud enviada por ${interaction.user.username}`,
                })
                .setTimestamp();

        if (session.logoUrl) {
            applicationEmbed.setImage(
                session.logoUrl,
            );
        }

        const reviewButtons =
            new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(
                            `team_application_approve:${application.id}`,
                        )
                        .setLabel(
                            'Aprobar',
                        )
                        .setEmoji('✅')
                        .setStyle(
                            ButtonStyle.Success,
                        ),

                    new ButtonBuilder()
                        .setCustomId(
                            `team_application_reject:${application.id}`,
                        )
                        .setLabel(
                            'Rechazar',
                        )
                        .setEmoji('❌')
                        .setStyle(
                            ButtonStyle.Danger,
                        ),
                );

        try {
            await applicationsChannel.send({
                embeds: [
                    applicationEmbed,
                ],

                components: [
                    reviewButtons,
                ],
            });
        } catch (error) {
            await TeamApplicationService.cancel({
                guildId:
                    interaction.guildId,

                applicationId:
                    application.id,

                applicantId:
                    interaction.user.id,
            });

            throw error;
        }

        TeamApplicationSessionService.delete(
            interaction.guildId,
            interaction.user.id,
        );

        await interaction.editReply({
            embeds: [
                {
                    color: 0x57F287,

                    title:
                        'HCD | SOLICITUD ENVIADA',

                    description: [
                        `La solicitud de **${session.name}${session.tag ? ` [${session.tag}]` : ''}** fue enviada correctamente`,
                        '',
                        '📥 Tu solicitud ahora será revisada por la Administración de HCD',
                        '',
                        'Recibirás información cuando la solicitud sea procesada',
                        '',
                        `🆔 **Solicitud:** \`${application.id}\``,
                        '',
                        '✅ **Estado: Pendiente de revisión**',
                    ].join('\n'),

                    footer: {
                        text:
                            'Hispanic Competitive Development',
                    },
                },
            ],

            components: [],
        });
    },
};
