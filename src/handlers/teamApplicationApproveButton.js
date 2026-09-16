import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionsBitField,
} from 'discord.js';

import TeamApplicationService
    from '../services/teamApplicationService.js';

import TeamDiscordService
    from '../services/teamDiscordService.js';

import TeamPanelService
    from '../services/teamPanelService.js';

import {
    getPlayerMembership,
    provisionTeamFromApplication,
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

        let teamRole = null;

        /**
         * Discord role changes completed by this approval attempt.
         *
         * We store the exact changes returned by TeamDiscordService so
         * a later PostgreSQL failure can restore the previous Discord
         * state without removing roles the member already had.
         */
        const captainProvisioning = [];
        let managerProvisioning = null;

        try {
            /**
             * Create the managed Discord Team Role.
             *
             * Discord is provisioned before PostgreSQL because
             * these changes can be rolled back if the database
             * transaction fails.
             */
            teamRole =
                await TeamDiscordService.createManagedRole({
                    guild:
                        interaction.guild,

                    name:
                        application.name,

                    tag:
                        application.tag,

                    createdBy:
                        interaction.user.tag,
                });

            /**
             * Provision the complete Discord identity for each Captain.
             *
             * Result:
             *
             * + Team Role
             * + Jugador
             * + Capitán de Equipo
             * - Jugador Libre
             */
            for (
                const member
                of captainMembers
            ) {
                const provisioning =
                    await TeamDiscordService.provisionCaptainRoles({
                        guild:
                            interaction.guild,

                        userId:
                            member.id,

                        teamRoleId:
                            teamRole.id,

                        teamName:
                            application.name,
                    });

                captainProvisioning.push({
                    userId:
                        member.id,

                    changes:
                        provisioning.changes,
                });
            }

            /**
             * Líder de Facción is administrative identity only.
             *
             * + Team Role
             * + Líder de Facción
             *
             * Jugador and Jugador Libre are intentionally untouched.
             */
            if (managerMember) {
                const provisioning =
                    await TeamDiscordService.provisionFactionLeaderRoles({
                        guild:
                            interaction.guild,

                        userId:
                            managerMember.id,

                        teamRoleId:
                            teamRole.id,

                        teamName:
                            application.name,
                    });

                managerProvisioning = {
                    userId:
                        managerMember.id,

                    changes:
                        provisioning.changes,
                };
            }

            /**
             * This is the atomic PostgreSQL operation.
             *
             * Inside a single transaction it:
             *
             * - Locks the pending application
             * - Validates it again
             * - Creates the official HCD team
             * - Inserts the Captains
             * - Cancels their pending team invitations
             * - Marks the application as approved
             * - Links the application to the new Team ID
             *
             * Either all database changes commit or none do.
             */
            const provisionResult =
                await provisionTeamFromApplication({
                    guildId:
                        interaction.guildId,

                    applicationId,

                    reviewedBy:
                        interaction.user.id,

                    roleId:
                        teamRole.id,
                });

            const team =
                provisionResult.team;

            /**
             * Refresh the public HCD teams panel.
             *
             * This is best-effort because the official team has
             * already been committed successfully at this point.
             * A panel failure should never destroy a valid team.
             */
            try {
                await TeamPanelService.refreshGuildPanel(
                    interaction.guild,
                );
            } catch {
                // The team is already approved.
                // The panel can be refreshed later.
            }

            const captainMentions =
                captainMembers
                    .map(
                        member =>
                            `<@${member.id}>`,
                    )
                    .join(', ');

            const approvedDescription = [
                `👤 **Solicitante:** <@${application.applicant_id}>`,
                '',
                `🏷️ **Nombre:** ${application.name}`,
                `🔖 **TAG:** ${application.tag || 'Sin TAG'}`,
                '',
                `👥 **Capitanes:** ${captainMentions}`,
            ];

            if (managerMember) {
                approvedDescription.push(
                    `👑 **Líder de Facción:** <@${managerMember.id}>`,
                );
            }

            approvedDescription.push(
                '',
                `🎭 **Team Role:** <@&${teamRole.id}>`,
                `🆔 **Team ID:** \`${team.id}\``,
                `🆔 **Solicitud:** \`${application.id}\``,
                '',
                `✅ **Estado:** Aprobada por <@${interaction.user.id}>`,
            );

            /**
             * Update the original message inside
             * 📥・solicitudes-equipos.
             *
             * The review buttons disappear after approval.
             */
            try {
                const approvedEmbed = {
                    color: 0x57F287,

                    title:
                        'HCD | SOLICITUD APROBADA',

                    description:
                        approvedDescription.join('\n'),

                    footer: {
                        text:
                            'Hispanic Competitive Development',
                    },

                    timestamp:
                        new Date().toISOString(),
                };

                if (application.logo_url) {
                    approvedEmbed.image = {
                        url:
                            application.logo_url,
                    };
                }

                await interaction.message.edit({
                    embeds: [
                        approvedEmbed,
                    ],

                    components: [],
                });
            } catch {
                /**
                 * Even if Discord cannot edit the old message,
                 * PostgreSQL prevents the application from being
                 * approved a second time.
                 */
            }

            /**
             * Private confirmation for the Owner/Admin
             * who approved the application.
             */
            await interaction.editReply({
                embeds: [
                    {
                        color: 0x57F287,

                        title:
                            'HCD | EQUIPO APROBADO',

                        description: [
                            `**${application.name}${application.tag ? ` [${application.tag}]` : ''}** fue creado correctamente como equipo oficial de HCD`,
                            '',
                            `🎭 **Team Role:** <@&${teamRole.id}>`,
                            `👥 **Capitanes:** ${captainMentions}`,
                            managerMember
                                ? `👑 **Líder de Facción:** <@${managerMember.id}>`
                                : '👑 **Líder de Facción:** No aplica',
                            '',
                            `🆔 **Team ID:** \`${team.id}\``,
                            `🆔 **Solicitud:** \`${application.id}\``,
                            '',
                            '✅ **Solicitud aprobada correctamente**',
                        ].join('\n'),

                        footer: {
                            text:
                                'HCD | Sistema de aprobación de equipos',
                        },
                    },
                ],
            });
        } catch (error) {
            /**
             * Roll back Discord-side changes.
             *
             * provisionTeamFromApplication() already performs its
             * own PostgreSQL ROLLBACK when the DB operation fails.
             *
             * Reverse only changes performed by this approval attempt.
             */

            if (
                teamRole &&
                managerProvisioning
            ) {
                const {
                    userId,
                    changes,
                } = managerProvisioning;

                if (
                    changes
                        ?.factionLeaderRoleAssigned
                ) {
                    await TeamDiscordService.removeFactionLeaderRole({
                        guild:
                            interaction.guild,

                        userId,

                        reason:
                            `Rollback failed HCD application #${application.id}`,
                    });
                }

                if (
                    changes
                        ?.teamRoleAssigned
                ) {
                    await TeamDiscordService.removeTeamRole({
                        guild:
                            interaction.guild,

                        userId,

                        roleId:
                            teamRole.id,

                        teamName:
                            application.name,
                    });
                }
            }

            if (teamRole) {
                for (
                    const provisioning
                    of [
                        ...captainProvisioning,
                    ].reverse()
                ) {
                    const {
                        userId,
                        changes,
                    } = provisioning;

                    if (
                        changes
                            ?.freeAgentRoleRemoved
                    ) {
                        try {
                            await TeamDiscordService.assignFreeAgentRole({
                                guild:
                                    interaction.guild,

                                userId,

                                reason:
                                    `Rollback failed HCD application #${application.id}`,
                            });
                        } catch {
                            // Best-effort rollback.
                        }
                    }

                    if (
                        changes
                            ?.captainRoleAssigned
                    ) {
                        await TeamDiscordService.removeCaptainRole({
                            guild:
                                interaction.guild,

                            userId,

                            reason:
                                `Rollback failed HCD application #${application.id}`,
                        });
                    }

                    if (
                        changes
                            ?.playerRoleAssigned
                    ) {
                        await TeamDiscordService.removePlayerRole({
                            guild:
                                interaction.guild,

                            userId,

                            reason:
                                `Rollback failed HCD application #${application.id}`,
                        });
                    }

                    if (
                        changes
                            ?.teamRoleAssigned
                    ) {
                        await TeamDiscordService.removeTeamRole({
                            guild:
                                interaction.guild,

                            userId,

                            roleId:
                                teamRole.id,

                            teamName:
                                application.name,
                        });
                    }
                }

                await TeamDiscordService.deleteManagedRole({
                    role:
                        teamRole,

                    reason:
                        `Rollback failed HCD application #${application.id}`,
                });
            }

            await interaction.editReply({
                content: [
                    '❌ **No se pudo aprobar la solicitud.**',
                    '',
                    'HCD Hub revirtió los cambios de Discord que alcanzó a realizar.',
                    'La solicitud debería continuar pendiente si PostgreSQL no alcanzó a confirmar la operación.',
                    '',
                    `Detalle: \`${String(error?.message || 'Error desconocido').slice(0, 500)}\``,
                ].join('\n'),

                embeds: [],
            });

            return;
        }
    },
};
