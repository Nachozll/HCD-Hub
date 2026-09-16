const SESSION_TTL = 30 * 60 * 1000;

const sessions = new Map();

function buildKey(guildId, userId) {
    return `${guildId}:${userId}`;
}

class TeamApplicationSessionService {
    static create(guildId, userId, data = {}) {
        const key = buildKey(guildId, userId);

        const session = {
            guildId,
            userId,

            type: data.type || null,

            name: data.name || null,
            tag: data.tag || null,
            discordUrl: data.discordUrl || null,

            captainIds: [],
            managerId: null,
            logoUrl: null,

            createdAt: Date.now(),
            updatedAt: Date.now(),
        };

        sessions.set(key, session);

        return session;
    }

    static get(guildId, userId) {
        const key = buildKey(guildId, userId);

        const session = sessions.get(key);

        if (!session) {
            return null;
        }

        if (
            Date.now() - session.updatedAt >
            SESSION_TTL
        ) {
            sessions.delete(key);
            return null;
        }

        return session;
    }

    static update(guildId, userId, updates = {}) {
        const key = buildKey(guildId, userId);

        const session = this.get(
            guildId,
            userId,
        );

        if (!session) {
            return null;
        }

        const updatedSession = {
            ...session,
            ...updates,

            guildId,
            userId,

            updatedAt: Date.now(),
        };

        sessions.set(
            key,
            updatedSession,
        );

        return updatedSession;
    }

    static delete(guildId, userId) {
        return sessions.delete(
            buildKey(guildId, userId),
        );
    }

    static has(guildId, userId) {
        return Boolean(
            this.get(guildId, userId),
        );
    }
}

export {
    SESSION_TTL,
};

export default TeamApplicationSessionService;
