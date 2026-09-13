export const teamViewHandler = {
    name: 'team_view',

    async execute(interaction, client, args) {
        const teamId = args?.[0];

        await interaction.reply({
            content: `Team ID recibido: ${teamId}`,
            ephemeral: true,
        });
    },
};
