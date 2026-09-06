import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
} from "discord.js";
import type { Logger } from "pino";
import { getDiscordConfig } from "./config";
import { routeCommand, registerCommands } from "./commands";
import { PanelController } from "./panels";
import { TournamentStore } from "./store";

export async function startDiscordBot(logger: Logger): Promise<{
  client: Client;
  stop: () => Promise<void>;
} | null> {
  const config = getDiscordConfig();
  if (!config) {
    logger.warn("DISCORD_BOT_TOKEN is not configured; Discord bot is disabled");
    return null;
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
  });
  
  const store = new TournamentStore(logger);
  await store.init();
  const panels = new PanelController(client, store, config, logger);

  client.once(Events.ClientReady, async (readyClient) => {
    try {
      await registerCommands(readyClient, config);
      logger.info({ user: readyClient.user.tag, guilds: readyClient.guilds.cache.size }, "Discord bot ready - +16 teams fix loaded");
    } catch (e) {
      logger.error({ err: e }, "Failed to register commands");
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        await routeCommand(interaction, panels, config);
      } else if (interaction.isButton()) {
        await panels.handleButton(interaction);
      } else if (interaction.isUserSelectMenu()) {
        await panels.handleUserSelect(interaction);
      } else if (interaction.isStringSelectMenu()) {
        await panels.handleStringSelect(interaction);
      } else if (interaction.isModalSubmit()) {
        await panels.handleModal(interaction);
      }
    } catch (error) {
      logger.error({ err: error, interactionId: interaction.id, customId: (interaction as any).customId }, "Discord interaction failed");
      if (interaction.isRepliable()) {
        const message = "Une erreur est survenue. Vérifie les permissions du bot et réessaie. Si c'est l'image du bracket, vérifie que `sharp` est installé dans package.json";
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: message, ephemeral: true }).catch(() => undefined);
        } else {
          await interaction.reply({ content: message, ephemeral: true }).catch(() => undefined);
        }
      }
    }
  });

  await client.login(config.token);

  return {
    client,
    stop: async () => {
      client.destroy();
      logger.info("Discord bot stopped");
    },
  };
}
