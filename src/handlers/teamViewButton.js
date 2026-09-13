import { EmbedBuilder } from 'discord.js';
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

        const embed = new EmbedBuilder()
            .setColor('#C9A227')
            .setTitle(
                `${team.name}${team.tag ? ` [${team.tag}]` : ''}`,
            )
            .addFields(
                {
                    name: 'Líder de Facción',
                    value: `<@${team.manager_id}>`,
                },
                {
                    name: `Capitanes — ${counts.captain}/${TEAM_LIMITS.captain}`,
                    value: formatRosterSection(captains),
                },
                {
                    name: `Main Roster — ${counts.main}/${TEAM_LIMITS.main}`,
                    value: formatRosterSection(mains),
                },
                                {
                    name: `Sub Roster — ${counts.sub}/${TEAM_LIMITS.sub}`,
                    value: formatRosterSection(substitutes),
                },
            );
                
        if (team.logo_url) {
            embed.setThumbnail(team.logo_url);
        }

        if (team.discord_url) {
            embed.addFields({
                name: 'Servidor oficial',
                value: team.discord_url,
            });
        }
        embed.setFooter({
            text: `Roster system inspired by the BRM5 Competitive Hub • Adapted for HCD • ${counts.total}/9 jugadores`,
        });

        embed.setTimestamp(new Date());
        await interaction.reply({
            embeds: [embed],
            ephemeral: true,
        });
    },
};
