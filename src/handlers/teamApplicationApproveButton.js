import {
    PermissionsBitField,
} from 'discord.js';

import TeamApplicationService
    from '../services/teamApplicationService.js';

import {
    getPlayerMembership,
} from '../utils/database/teams.js';

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

/**
 * Fetches and validates a Discord member that
 * participates in a team application.
 */
async function getApplicationMember({
    guild,
    userId,
    label,
}) {
    let member = null;

    try {
        member =
            await guild.members.fetch(
                userId,
            );
    } catch {
        member = null;
    }

    if (!member) {
        return {
            valid: false,

            error:
                `❌ ${label} <@${userId}> ya no se encuentra dentro del servidor de HCD.`,
        };
    }

    if (member.user.bot) {
        return {
            valid: false,

            error:
                `❌ ${label} <@${userId}> no puede ser un bot.`,
        };
    }

    return {
        valid: true,
        member,
    };
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
                    .map(
                        captainId =>
                            String(
                                captainId,
                            ).trim(),
                    )
                    .filter(Boolean)
                : [];

        /**
         * Validate captain count.
         */
        if (
            captainIds.length < 1 ||
            captainIds.length > 2
        ) {
            await interaction.editReply({
                content:
                    '❌ La solicitud debe contener entre 1 y 2 Capitanes.',
            });

            return;
        }

        /**
         * Prevent duplicate Captains.
         */
        const uniqueCaptainIds =
            new Set(
                captainIds,
            );

        if (
            uniqueCaptainIds.size !==
            captainIds.length
        ) {
            await interaction.editReply({
                content:
                    '❌ La solicitud contiene al mismo Capitán más de una vez.',
            });

            return;
        }

        const managerId =
            application.manager_id
                ? String(
                    application.manager_id,
                ).trim()
                : null;

        /**
         * Líder de Facción and Captain are
         * separate HCD roles.
         */
        if (
            managerId &&
            captainIds.includes(
                managerId,
            )
        ) {
            await interaction.editReply({
                content:
                    '❌ El Líder de Facción no puede ocupar también un puesto de Capitán.',
            });

            return;
        }

        /**
         * Check HCD Hub Discord permissions before
         * provisioning anything.
         */
        const botMember =
            interaction.guild.members.me ??
            await interaction.guild.members
                .fetchMe();

        if (
            !botMember.permissions.has(
                PermissionsBitField.Flags
                    .ManageRoles,
            )
        ) {
            await interaction.editReply({
                content:
                    '❌ HCD Hub no tiene el permiso **Manage Roles**. La solicitud no puede ser aprobada todavía.',
            });

            return;
        }

        /**
         * Validate every Captain against Discord.
         */
        const captainMembers = [];

        for (
            const captainId
            of captainIds
        ) {
            const captainResult =
                await getApplicationMember({
                    guild:
                        interaction.guild,

                    userId:
                        captainId,

                    label:
                        'El Capitán',
                });

            if (!captainResult.valid) {
                await interaction.editReply({
                    content:
                        captainResult.error,
                });

                return;
            }

            captainMembers.push(
                captainResult.member,
            );
        }

        /**
         * Validate faction manager against Discord.
         *
         * Independent teams simply skip this step.
         */
        let managerMember = null;

        if (managerId) {
            const managerResult =
                await getApplicationMember({
                    guild:
                        interaction.guild,

                    userId:
                        managerId,

                    label:
                        'El Líder de Facción',
                });

            if (!managerResult.valid) {
                await interaction.editReply({
                    content:
                        managerResult.error,
                });

                return;
            }

            managerMember =
                managerResult.member;
        }

        /**
         * Captains cannot already belong to another
         * competitive HCD roster.
         */
        for (
            const captainId
            of captainIds
        ) {
            const membership =
                await getPlayerMembership(
                    interaction.guildId,
                    captainId,
                );

            if (membership) {
                await interaction.editReply({
                    content:
                        `❌ El Capitán <@${captainId}> ya pertenece al roster competitivo de otro equipo de HCD.`,
                });

                return;
            }
        }

        /**
         * Final safety check.
         *
         * The application could theoretically have
         * changed while the preflight was running.
         */
        const finalApplication =
            await TeamApplicationService.get(
                interaction.guildId,
                applicationId,
            );

        if (
            finalApplication.status !==
            'pending'
        ) {
            await interaction.editReply({
                content:
                    `❌ La solicitud cambió de estado durante la validación. Estado actual: **${finalApplication.status}**`,
            });

            return;
        }

        const captainMentions =
            captainMembers
                .map(
                    member =>
                        `<@${member.id}>`,
                )
                .join(', ');

        const checks = [
            '✅ Solicitud pendiente',
            '✅ Cantidad de Capitanes válida',
            '✅ Capitanes sin duplicados',
            '✅ Capitanes presentes en HCD',
            '✅ Capitanes disponibles para un roster',
            '✅ HCD Hub puede administrar roles',
        ];

        if (managerMember) {
            checks.push(
                '✅ Líder de Facción presente en HCD',
                '✅ Líder de Facción separado del roster competitivo',
            );
        }

        await interaction.editReply({
            embeds: [
                {
                    color: 0x57F287,

                    title:
                        'HCD | PREFLIGHT SUPERADO',

                    description: [
                        `La solicitud de **${application.name}${application.tag ? ` [${application.tag}]` : ''}** está preparada para ser provisionada`,
                        '',
                        `🆔 **Solicitud:** \`${application.id}\``,
                        `👤 **Solicitante:** <@${application.applicant_id}>`,
                        '',
                        `👥 **Capitanes:** ${captainMentions}`,
                        managerMember
                            ? `👑 **Líder de Facción:** <@${managerMember.id}>`
                            : '👑 **Líder de Facción:** No aplica',
                        '',
                        '**Comprobaciones**',
                        ...checks,
                        '',
                        '🟢 **Preflight completado correctamente**',
                        '',
                        '🧪 Todavía no se ha creado ningún Team Role, equipo ni miembro del roster',
                    ].join('\n'),

                    footer: {
                        text:
                            'HCD | Sistema de aprobación de equipos',
                    },
                },
            ],
        });
    },
};
