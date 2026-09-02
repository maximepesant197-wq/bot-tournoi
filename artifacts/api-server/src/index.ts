import app from "./app";
import { logger } from "./lib/logger";
import { startDiscordBot } from "./discord";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});

const discord = await startDiscordBot(logger);

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "Shutdown requested");
  await discord?.stop();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
