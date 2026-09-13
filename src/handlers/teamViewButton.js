import TeamService, {
    TEAM_LIMITS,
} from '../services/teamService.js';

function formatRosterSection(members = []) {
    if (!members.length) {
        return '*Vacío*';
    }

    return members
        .map((member) => `<@${member.user_id}>`)
        .join('\n');
}

export const teamViewHandler = {
    name: 'team_view',

    async execute(interaction, client, args) {
        const teamId = Number(args?.[0]);

        const roster = await TeamService.getRoster(
            interaction.guildId,
            teamId,
        );

        const {
            team,
            captains,
            mains,
            substitutes,
            counts,
        } = roster;

        const fields = [
            {
                name: '👑 Líder de Facción',
                value: `<@${team.manager_id}>`,
            },
            {
                name: `⚔️ Capitanes — ${counts.captain}/${TEAM_LIMITS.captain}`,
                value: formatRosterSection(captains),
            },
            {
                name: `🎯 Main Roster — ${counts.main}/${TEAM_LIMITS.main}`,
                value: formatRosterSection(mains),
            },
            {
                name: `🔄 Sub Roster — ${counts.sub}/${TEAM_LIMITS.sub}`,
                value: formatRosterSection(substitutes),
            },
        ];

        if (team.discord_url) {
            fields.push({
                name: '🔗 Discord oficial',
                value: `[Click Here](${team.discord_url})`,
            });
        }

        const embed = {
            color: 0xC9A227,

            title: `${team.name}${team.tag ? ` [${team.tag}]` : ''}`,

            description:
                `**Roster competitivo oficial**\n` +
                `${counts.total}/9 jugadores registrados`,

            fields,

            footer: {
                text: 'Roster system inspired by the BRM5 Competitive Hub • Adapted for HCD',
            },

            timestamp: new Date().toISOString(),
        };

        if (team.logo_url) {
            embed.thumbnail = {
                url: team.logo_url,
            };
        }

        await interaction.reply({
            embeds: [embed],
            ephemeral: true,
        });
    },
};
