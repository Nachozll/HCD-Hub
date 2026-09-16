import TeamApplicationService
    from '../services/teamApplicationService.js';

/**
 * Returns whether the member can approve/reject
 * HCD team applications.
 *
 * Only Owner + Administrador.
 * Coach Leader is intentionally excluded.
 */
function isTeamApplicationAdmin(
    interaction,
) {
    const teamAdminRoleId =
        process.env
            .HCD_TEAM_ADMIN_ROLE_ID;

    const ownerIds =
        (process.env.OWNER_IDS || '')
            .split(',')
            .map(id => id.trim())
            .filter(Boolean);

    const isOwner =
        ownerIds.includes(
            interaction.user.id,
        );

    const isAdministrator =
        teamAdminRoleId &&
        (
            interaction.member
                ?.roles
                ?.cache
                ?.has(
                    teamAdminRoleId,
                ) ?? false
        );

    return Boolean(
        isOwner ||
        isAdministrator,
    );
}

export const teamApplicationApproveButtonHandler = {
    name: 'team_application_approve',

    async execute(
        interaction,
        client,
        args,
    ) {
        if (
            !isTeamApplicationAdmin(
                interaction,
            )
        ) {
            await interaction.reply({
                content:
                    '❌ Solo el Owner o un Administrador de HCD puede aprobar solicitudes de equipos.',
                ephemeral: true,
            });

            return;
        }

        const applicationId =
            Number(args?.[0]);

        if (
            !Number.isInteger(
                applicationId,
            ) ||
            applicationId <= 0
        ) {
            await interaction.reply({
                content:
                    '❌ El ID de esta solicitud no es válido.',
                ephemeral: true,
            });

            return;
        }

        await interaction.deferReply({
            ephemeral: true,
        });

        const application =
            await TeamApplicationService.get(
                interaction.guildId,
                applicationId,
            );

        if (
            application.status !==
            'pending'
        ) {
            await interaction.editReply({
                content:
                    `❌ Esta solicitud ya fue procesada. Estado actual: **${application.status}**`,
            });

            return;
        }

        const captainIds =
            Array.isArray(
                application.captain_ids,
            )
                ? application.captain_ids
                : [];

        const captainMentions =
            captainIds
                .map(
                    captainId =>
                        `<@${captainId}>`,
                )
                .join(', ');

        await interaction.editReply({
            embeds: [
                {
                    color: 0x57F287,

                    title:
                        'HCD | APROBACIÓN VALIDADA',

                    description: [
                        'La solicitud fue encontrada correctamente y continúa pendiente',
                        '',
                        `🆔 **Solicitud:** \`${application.id}\``,
                        `🏷️ **Equipo:** ${application.name}${application.tag ? ` [${application.tag}]` : ''}`,
                        `👤 **Solicitante:** <@${application.applicant_id}>`,
                        '',
                        `👥 **Capitanes:** ${captainMentions || 'Sin Capitanes'}`,
                        application.manager_id
                            ? `👑 **Líder de Facción:** <@${application.manager_id}>`
                            : '👑 **Líder de Facción:** No aplica',
                        '',
                        '🟡 **Estado:** Pendiente',
                        '',
                        '🧪 **Prueba superada:** todavía no se ha creado ni modificado ningún equipo',
                    ].join('\n'),

                    footer: {
                        text:
                            'HCD | Prueba del sistema de aprobación',
                    },
                },
            ],
        });
    },
};
