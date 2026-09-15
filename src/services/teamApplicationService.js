import { logger } from '../utils/logger.js';
import { createError, ErrorTypes } from '../utils/errorHandler.js';
import {
    createTeamApplication,
    getTeamApplicationById,
    getPendingTeamApplications,
    getTeamApplicationsByApplicant,
    getPendingTeamApplicationForApplicant,
    updatePendingTeamApplication,
    approveTeamApplication,
    rejectTeamApplication,
    cancelTeamApplication,
} from '../utils/database/teamApplications.js';

const MAX_CAPTAINS = 2;

class TeamApplicationService {
    static validateApplicationData(data) {
        if (!data || typeof data !== 'object') {
            throw createError(
                'Missing team application data',
                ErrorTypes.VALIDATION,
                'Invalid team application data.',
            );
        }

        const {
            guildId,
            applicantId,
            name,
        } = data;

        if (!guildId || !applicantId || !name) {
            throw createError(
                'Missing required team application fields',
                ErrorTypes.VALIDATION,
                'Guild, applicant, and team name are required.',
                {
                    guildId,
                    applicantId,
                    name,
                },
            );
        }

        const cleanName = String(name).trim();

        if (cleanName.length < 2 || cleanName.length > 100) {
            throw createError(
                'Invalid team application name length',
                ErrorTypes.VALIDATION,
                'Team name must contain between 2 and 100 characters.',
                { nameLength: cleanName.length },
            );
        }

        if (data.tag) {
            const cleanTag = String(data.tag).trim();

            if (cleanTag.length > 20) {
                throw createError(
                    'Invalid team application tag length',
                    ErrorTypes.VALIDATION,
                    'Team tag cannot contain more than 20 characters.',
                    { tagLength: cleanTag.length },
                );
            }
        }

        if (
            data.managerId !== undefined &&
            data.managerId !== null &&
            !String(data.managerId).trim()
        ) {
            throw createError(
                'Invalid team application manager',
                ErrorTypes.VALIDATION,
                'Líder de Facción must be a valid Discord user or left unassigned.',
                { managerId: data.managerId },
            );
        }

        this.validateCaptainIds(
            data.captainIds ?? [],
            data.managerId ?? null,
        );

        return true;
    }

    static validateCaptainIds(
        captainIds = [],
        managerId = null,
    ) {
        if (!Array.isArray(captainIds)) {
            throw createError(
                'Invalid team application captains',
                ErrorTypes.VALIDATION,
                'Captains must be provided as a valid list.',
            );
        }

        const normalized = [
            ...new Set(
                captainIds
                    .map(id => String(id || '').trim())
                    .filter(Boolean),
            ),
        ];

        if (normalized.length > MAX_CAPTAINS) {
            throw createError(
                'Too many team application captains',
                ErrorTypes.VALIDATION,
                `A team can have at most ${MAX_CAPTAINS} captains.`,
                {
                    captainCount: normalized.length,
                    limit: MAX_CAPTAINS,
                },
            );
        }

        if (
            managerId &&
            normalized.includes(String(managerId))
        ) {
            throw createError(
                'Faction leader also listed as captain',
                ErrorTypes.VALIDATION,
                'Líder de Facción and Captain are separate roles in HCD.',
                { managerId },
            );
        }

        return normalized;
    }

    static normalizeApplicationData(data) {
        return {
            guildId: String(data.guildId).trim(),
            applicantId: String(data.applicantId).trim(),
            name: String(data.name).trim(),
            tag: data.tag
                ? String(data.tag).trim()
                : null,
            managerId: data.managerId
                ? String(data.managerId).trim()
                : null,
            captainIds: this.validateCaptainIds(
                data.captainIds ?? [],
                data.managerId ?? null,
            ),
            discordUrl: data.discordUrl
                ? String(data.discordUrl).trim()
                : null,
            logoUrl: data.logoUrl
                ? String(data.logoUrl).trim()
                : null,
        };
    }

    static async submit(data) {
        try {
            this.validateApplicationData(data);

            const normalized =
                this.normalizeApplicationData(data);

            const existingPending =
                await getPendingTeamApplicationForApplicant(
                    normalized.guildId,
                    normalized.applicantId,
                );

            if (existingPending) {
                throw createError(
                    'Applicant already has pending team application',
                    ErrorTypes.VALIDATION,
                    'You already have a pending team application. Wait for it to be reviewed before submitting another.',
                    {
                        guildId: normalized.guildId,
                        applicantId: normalized.applicantId,
                        applicationId: existingPending.id,
                    },
                );
            }

            const application =
                await createTeamApplication(normalized);

            logger.info('HCD team application submitted', {
                guildId: normalized.guildId,
                applicationId: application?.id,
                applicantId: normalized.applicantId,
                name: normalized.name,
                managerId: normalized.managerId,
                captainCount:
                    normalized.captainIds.length,
            });

            return application;
        } catch (error) {
            return this.handleError(
                'submit team application',
                error,
                {
                    guildId: data?.guildId,
                    applicantId: data?.applicantId,
                    name: data?.name,
                },
            );
        }
    }

    static async get(guildId, applicationId) {
        try {
            const application =
                await getTeamApplicationById(
                    guildId,
                    applicationId,
                );

            if (!application) {
                throw createError(
                    'Team application not found',
                    ErrorTypes.VALIDATION,
                    'This team application does not exist.',
                    {
                        guildId,
                        applicationId,
                    },
                );
            }

            return application;
        } catch (error) {
            return this.handleError(
                'get team application',
                error,
                {
                    guildId,
                    applicationId,
                },
            );
        }
    }

    static async getPending(guildId) {
        try {
            return await getPendingTeamApplications(
                guildId,
            );
        } catch (error) {
            return this.handleError(
                'get pending team applications',
                error,
                { guildId },
            );
        }
    }

    static async getByApplicant(
        guildId,
        applicantId,
        options = {},
    ) {
        try {
            return await getTeamApplicationsByApplicant(
                guildId,
                applicantId,
                options,
            );
        } catch (error) {
            return this.handleError(
                'get applicant team applications',
                error,
                {
                    guildId,
                    applicantId,
                },
            );
        }
    }

    static async updatePending({
        guildId,
        applicationId,
        applicantId,
        updates = {},
        isAdmin = false,
    }) {
        try {
            const application = await this.get(
                guildId,
                applicationId,
            );

            if (application.status !== 'pending') {
                throw createError(
                    'Team application is not pending',
                    ErrorTypes.VALIDATION,
                    'Only pending team applications can be edited.',
                    {
                        guildId,
                        applicationId,
                        status: application.status,
                    },
                );
            }

            if (
                !isAdmin &&
                application.applicant_id !== applicantId
            ) {
                throw createError(
                    'User cannot edit team application',
                    ErrorTypes.PERMISSION,
                    'You do not have permission to edit this team application.',
                    {
                        guildId,
                        applicationId,
                        applicantId,
                    },
                );
            }

            const normalizedUpdates = {
                ...updates,
            };

            if (updates.name !== undefined) {
                const cleanName =
                    String(updates.name || '').trim();

                if (
                    cleanName.length < 2 ||
                    cleanName.length > 100
                ) {
                    throw createError(
                        'Invalid team application name length',
                        ErrorTypes.VALIDATION,
                        'Team name must contain between 2 and 100 characters.',
                    );
                }

                normalizedUpdates.name = cleanName;
            }

            if (updates.tag !== undefined) {
                const cleanTag =
                    updates.tag === null
                        ? null
                        : String(updates.tag).trim();

                if (
                    cleanTag &&
                    cleanTag.length > 20
                ) {
                    throw createError(
                        'Invalid team application tag length',
                        ErrorTypes.VALIDATION,
                        'Team tag cannot contain more than 20 characters.',
                    );
                }

                normalizedUpdates.tag =
                    cleanTag || null;
            }

            const managerId =
                updates.managerId !== undefined
                    ? updates.managerId
                    : application.manager_id;

            const captainIds =
                updates.captainIds !== undefined
                    ? updates.captainIds
                    : application.captain_ids;

            if (
                updates.managerId !== undefined &&
                updates.managerId !== null &&
                !String(updates.managerId).trim()
            ) {
                throw createError(
                    'Invalid team application manager',
                    ErrorTypes.VALIDATION,
                    'Líder de Facción must be a valid Discord user or left unassigned.',
                );
            }

            if (
                updates.managerId !== undefined
            ) {
                normalizedUpdates.managerId =
                    updates.managerId
                        ? String(
                            updates.managerId,
                        ).trim()
                        : null;
            }

            if (
                updates.captainIds !== undefined ||
                updates.managerId !== undefined
            ) {
                normalizedUpdates.captainIds =
                    this.validateCaptainIds(
                        captainIds || [],
                        managerId || null,
                    );
            }

            if (updates.discordUrl !== undefined) {
                normalizedUpdates.discordUrl =
                    updates.discordUrl
                        ? String(
                            updates.discordUrl,
                        ).trim()
                        : null;
            }

            if (updates.logoUrl !== undefined) {
                normalizedUpdates.logoUrl =
                    updates.logoUrl
                        ? String(
                            updates.logoUrl,
                        ).trim()
                        : null;
            }

            const updated =
                await updatePendingTeamApplication(
                    guildId,
                    applicationId,
                    normalizedUpdates,
                );

            if (!updated) {
                throw createError(
                    'Team application update failed',
                    ErrorTypes.VALIDATION,
                    'The team application could not be updated.',
                    {
                        guildId,
                        applicationId,
                    },
                );
            }

            logger.info('HCD team application updated', {
                guildId,
                applicationId,
                updatedBy: applicantId,
                isAdmin,
                updatedFields:
                    Object.keys(normalizedUpdates),
            });

            return updated;
        } catch (error) {
            return this.handleError(
                'update team application',
                error,
                {
                    guildId,
                    applicationId,
                    applicantId,
                },
            );
        }
    }

    static async approve({
        guildId,
        applicationId,
        reviewedBy,
        teamId,
        isAdmin = false,
        reviewReason = null,
    }) {
        try {
            this.assertAdminReviewPermission(
                isAdmin,
                reviewedBy,
                applicationId,
            );

            if (!teamId) {
                throw createError(
                    'Missing approved team ID',
                    ErrorTypes.VALIDATION,
                    'The official HCD team must be created before the application can be marked as approved.',
                    {
                        guildId,
                        applicationId,
                    },
                );
            }

            const application = await this.get(
                guildId,
                applicationId,
            );

            this.assertPending(application);

            const approved =
                await approveTeamApplication({
                    guildId,
                    applicationId,
                    reviewedBy,
                    teamId,
                    reviewReason,
                });

            if (!approved) {
                throw createError(
                    'Team application approval failed',
                    ErrorTypes.VALIDATION,
                    'The team application could not be approved.',
                    {
                        guildId,
                        applicationId,
                    },
                );
            }

            logger.info('HCD team application approved', {
                guildId,
                applicationId,
                reviewedBy,
                teamId,
            });

            return approved;
        } catch (error) {
            return this.handleError(
                'approve team application',
                error,
                {
                    guildId,
                    applicationId,
                    reviewedBy,
                    teamId,
                },
            );
        }
    }

    static async reject({
        guildId,
        applicationId,
        reviewedBy,
        isAdmin = false,
        reviewReason = null,
    }) {
        try {
            this.assertAdminReviewPermission(
                isAdmin,
                reviewedBy,
                applicationId,
            );

            const application = await this.get(
                guildId,
                applicationId,
            );

            this.assertPending(application);

            const rejected =
                await rejectTeamApplication({
                    guildId,
                    applicationId,
                    reviewedBy,
                    reviewReason,
                });

            if (!rejected) {
                throw createError(
                    'Team application rejection failed',
                    ErrorTypes.VALIDATION,
                    'The team application could not be rejected.',
                    {
                        guildId,
                        applicationId,
                    },
                );
            }

            logger.info('HCD team application rejected', {
                guildId,
                applicationId,
                reviewedBy,
            });

            return rejected;
        } catch (error) {
            return this.handleError(
                'reject team application',
                error,
                {
                    guildId,
                    applicationId,
                    reviewedBy,
                },
            );
        }
    }

    static async cancel({
        guildId,
        applicationId,
        applicantId,
    }) {
        try {
            const application = await this.get(
                guildId,
                applicationId,
            );

            this.assertPending(application);

            if (
                application.applicant_id !== applicantId
            ) {
                throw createError(
                    'User cannot cancel team application',
                    ErrorTypes.PERMISSION,
                    'You can only cancel your own team application.',
                    {
                        guildId,
                        applicationId,
                        applicantId,
                    },
                );
            }

            const cancelled =
                await cancelTeamApplication(
                    guildId,
                    applicationId,
                    applicantId,
                );

            if (!cancelled) {
                throw createError(
                    'Team application cancellation failed',
                    ErrorTypes.VALIDATION,
                    'The team application could not be cancelled.',
                    {
                        guildId,
                        applicationId,
                    },
                );
            }

            logger.info('HCD team application cancelled', {
                guildId,
                applicationId,
                applicantId,
            });

            return cancelled;
        } catch (error) {
            return this.handleError(
                'cancel team application',
                error,
                {
                    guildId,
                    applicationId,
                    applicantId,
                },
            );
        }
    }

    static assertPending(application) {
        if (!application) {
            throw createError(
                'Missing team application',
                ErrorTypes.VALIDATION,
                'This team application does not exist.',
            );
        }

        if (application.status !== 'pending') {
            throw createError(
                'Team application is no longer pending',
                ErrorTypes.VALIDATION,
                'This team application has already been processed.',
                {
                    applicationId: application.id,
                    status: application.status,
                },
            );
        }

        return true;
    }

    static assertAdminReviewPermission(
        isAdmin,
        reviewedBy,
        applicationId = null,
    ) {
        if (!isAdmin) {
            throw createError(
                'User cannot review team applications',
                ErrorTypes.PERMISSION,
                'Only HCD Owner or Administrador can review team applications.',
                {
                    reviewedBy,
                    applicationId,
                },
            );
        }

        return true;
    }

    static handleError(
        action,
        error,
        metadata = {},
    ) {
        logger.error(
            `Team application service error: ${action}`,
            {
                error: error.message,
                stack: error.stack,
                ...metadata,
            },
        );

        throw error;
    }
}

export {
    MAX_CAPTAINS,
};

export default TeamApplicationService;
