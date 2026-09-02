import {
  ChatInputCommandInteraction,
  Client,
  REST,
  Routes,
  SlashCommandBuilder,
} from "discord.js";
import type { DiscordConfig } from "./config";
import type { PanelController } from "./panels";
import { isStaff } from "./permissions";

export const slashCommands = [
  new SlashCommandBuilder()
    .setName("cree-ma-team")
    .setDescription("Ouvre le panel de création et de gestion de team"),
  new SlashCommandBuilder()
    .setName("inscription")
    .setDescription("Ouvre le panel d'inscription au tournoi"),
  new SlashCommandBuilder()
    .setName("tournoi")
    .setDescription("Ouvre le panel Staff de gestion du tournoi"),
  new SlashCommandBuilder()
    .setName("tirage")
    .setDescription("Lance le panel de tirage Staff"),
  new SlashCommandBuilder()
    .setName("score")
    .setDescription("Ouvre le panel de gestion des scores"),
].map((command) => command.toJSON());

export async function registerCommands(
  client: Client,
  config: DiscordConfig,
): Promise<void> {
  if (!client.application) return;
  if (config.guildId) {
    await client.application.commands.set(slashCommands, config.guildId);
    return;
  }

  const rest = new REST({ version: "10" }).setToken(config.token);
  await rest.put(Routes.applicationCommands(client.application.id), {
    body: slashCommands,
  });
}

export async function routeCommand(
  interaction: ChatInputCommandInteraction,
  panels: PanelController,
  config: DiscordConfig,
): Promise<void> {
  switch (interaction.commandName) {
    case "cree-ma-team":
      await panels.sendTeamPanel(interaction);
      break;
    case "inscription":
      await panels.sendRegistrationPanel(interaction);
      break;
    case "tournoi":
      if (!isStaff(interaction, config)) {
        await interaction.reply({ content: "Accès réservé au Staff/Admin.", ephemeral: true });
        return;
      }
      await panels.sendStaffPanel(interaction);
      break;
    case "tirage":
      if (!isStaff(interaction, config)) {
        await interaction.reply({ content: "Accès réservé au Staff/Admin.", ephemeral: true });
        return;
      }
      await panels.sendDrawPrompt(interaction);
      break;
    case "score":
      await panels.sendScorePanel(interaction);
      break;
    default:
      await interaction.reply({ content: "Commande inconnue.", ephemeral: true });
  }
}