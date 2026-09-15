import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
} from 'discord.js';

import { logger } from '../utils/logger.js';

class TeamApplicationPanelService {
    /**
     * Builds the public HCD team registration embed.
     */
    static buildEmbed() {
        return new EmbedBuilder()
            .setColor('#C9A227')
            .setTitle('HCD | INSCRIPCIÓN DE EQUIPOS')
            .setDescription(
                [
                    'Registra tu equipo para comenzar su proceso dentro de Hispanic Competitive Development',
                    '',
                    'Puedes inscribir un equipo perteneciente a una **facción/comunidad** o formar un equipo **independiente** junto a otros jugadores',
                    '',
                    'Una vez enviada la solicitud, será revisada por la Administración de HCD antes de que el equipo sea registrado oficialmente',
                    '',
                    '**Antes de inscribirte**',
                    '',
                    '• Define el nombre y TAG de tu equipo',
                    '',
                    '• Ten definidos tus Capitanes',
                    '',
                    '• Prepara el logo de tu equipo',
                    '',
                    '• Si pertenecen a una facción, podrán indicar a su Líder de Facción',
                ].join('\n'),
            );
    }

    /**
     * Builds the registration button shown below the public embed.
     */
    static buildComponents() {
        const button = new ButtonBuilder()
            .setCustomId('team_application_start')
            .setLabel('Inscribir Equipo')
            .setEmoji('📝')
            .setStyle(ButtonStyle.Primary);

        return [
            new ActionRowBuilder()
                .addComponents(button),
        ];
    }

    /**
     * Builds the complete public registration panel payload.
     */
    static buildPayload() {
        return {
            embeds: [
                this.buildEmbed(),
            ],
            components:
                this.buildComponents(),
        };
    }

    /**
     * Publishes the public HCD team registration panel
     * in the selected Discord channel.
     */
    static async publish(channel) {
        if (!channel?.isTextBased()) {
            throw new Error(
                'The HCD team application panel must be published in a text-based channel',
            );
        }

        const message = await channel.send(
            this.buildPayload(),
        );

        logger.info(
            'HCD team application panel published',
            {
                guildId: channel.guild?.id,
                channelId: channel.id,
                messageId: message.id,
            },
        );

        return message;
    }
}

export default TeamApplicationPanelService;
