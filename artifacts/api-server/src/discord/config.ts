function parseIds(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

export interface DiscordConfig {
  token: string;
  guildId?: string;
  staffRoleIds: string[];
  arbiterRoleIds: string[];
}

export function getDiscordConfig(): DiscordConfig | null {
  const token = process.env.DISCORD_BOT_TOKEN?.trim();
  if (!token) return null;

  return {
    token,
    guildId: process.env.DISCORD_GUILD_ID?.trim() || undefined,
    staffRoleIds: parseIds(process.env.STAFF_ROLE_IDS),
    arbiterRoleIds: parseIds(process.env.ARBITER_ROLE_IDS),
  };
}