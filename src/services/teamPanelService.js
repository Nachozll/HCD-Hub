import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
} from 'discord.js';

import TeamService from './teamService.js';

import {
    getTeamPanel,
    saveTeamPanel,
    deleteTeamPanel,
} from '../utils/database/teamPanels.js';

import { logger } from '../utils/logger.js';

class TeamPanelService {
    static buildEmbed() {
        const embed = new EmbedBuilder()
            .setColor('#C9A227')
            .setTitle('HCD | EQUIPOS')
            .setDescription(
                [
                    'Este canal reúne a los equipos oficialmente registrados en Hispanic Competitive Development, que posteriormente competirán dentro del Competitive Hub.',
                    '',
                    'Selecciona un equipo para consultar su **Líder de Facción, Capitanes, Main Roster, Sub Roster** y acceder a su **servidor oficial**.',
                ].join('\n'),
            );

        const teamsBannerUrl =
            process.env.HCD_TEAMS_BANNER_URL;

        if (teamsBannerUrl) {
            embed.setImage(teamsBannerUrl);
        }

        return embed;
    }

    static buildComponents(teams = []) {
        const rows = [];

        for (let i = 0; i < teams.length; i += 5) {
            const row = new ActionRowBuilder();

            const group = teams.slice(i, i + 5);

            for (const team of group) {
                const label = team.tag
                    ? `${team.tag} | ${team.name}`
                    : team.name;

                const button = new ButtonBuilder()
                    .setCustomId(
                        `team_view:${team.id}`,
                    )
                    .setLabel(
                        label.slice(0, 80),
                    )
                    .setStyle(
                        ButtonStyle.Secondary,
                    );

                if (team.button_emoji) {
                    button.setEmoji(
                        team.button_emoji,
                    );
                }

                row.addComponents(button);
            }

            rows.push(row);
        }

        return rows;
    }

    static async buildPayload(guildId) {
        const teams =
            await TeamService.getTeams(guildId);

        if (!teams.length) {
            return {
                teams,
                payload: {
                    embeds: [
                        this.buildEmbed(),
                    ],
                    components: [],
                },
            };
        }

        return {
            teams,
            payload: {
                embeds: [
                    this.buildEmbed(),
                ],
                components:
                    this.buildComponents(teams),
            },
        };
    }

    static async getSavedPanel(guildId) {
        return getTeamPanel(guildId);
    }

    static async clearSavedPanel(guildId) {
        return deleteTeamPanel(guildId);
    }

    static async createPanel(channel) {
        const guildId = channel.guild.id;

        const {
            payload,
        } = await this.buildPayload(
            guildId,
        );

        const message =
            await channel.send(payload);

        await saveTeamPanel({
            guildId,
            channelId: channel.id,
            messageId: message.id,
        });

        logger.info(
            'HCD teams panel created',
            {
                guildId,
                channelId: channel.id,
                messageId: message.id,
            },
        );

        return message;
    }

    static async refreshPanel(guild) {
        const guildId = guild.id;

        const savedPanel =
            await getTeamPanel(guildId);

        if (!savedPanel) {
            return {
                updated: false,
                missing: true,
                reason: 'not_configured',
            };
        }

        let channel;

        try {
            channel =
                guild.channels.cache.get(
                    savedPanel.channel_id,
                ) ||
                await guild.channels.fetch(
                    savedPanel.channel_id,
                );
        } catch (error) {
            logger.warn(
                'Failed to fetch HCD teams panel channel',
                {
                    guildId,
                    channelId:
                        savedPanel.channel_id,
                    error: error.message,
                },
            );

            await deleteTeamPanel(guildId);

            return {
                updated: false,
                missing: true,
                reason: 'channel_missing',
            };
        }

        if (!channel?.isTextBased()) {
            await deleteTeamPanel(guildId);

            return {
                updated: false,
                missing: true,
                reason: 'invalid_channel',
            };
        }

        let message;

        try {
            message =
                await channel.messages.fetch(
                    savedPanel.message_id,
                );
        } catch (error) {
            logger.warn(
                'Failed to fetch HCD teams panel message',
                {
                    guildId,
                    channelId:
                        savedPanel.channel_id,
                    messageId:
                        savedPanel.message_id,
                    error: error.message,
                },
            );

            await deleteTeamPanel(guildId);

            return {
                updated: false,
                missing: true,
                reason: 'message_missing',
            };
        }

        const {
            payload,
        } = await this.buildPayload(
            guildId,
        );

        await message.edit(payload);

        logger.info(
            'HCD teams panel refreshed',
            {
                guildId,
                channelId: channel.id,
                messageId: message.id,
            },
        );

        return {
            updated: true,
            missing: false,
            message,
        };
    }

    static async publishOrRefresh(channel) {
        const guild = channel.guild;

        const result =
            await this.refreshPanel(guild);

        if (result.updated) {
            return {
                created: false,
                refreshed: true,
                message: result.message,
            };
        }

        const message =
            await this.createPanel(channel);

        return {
            created: true,
            refreshed: false,
            message,
        };
    }
}

export default TeamPanelService;
