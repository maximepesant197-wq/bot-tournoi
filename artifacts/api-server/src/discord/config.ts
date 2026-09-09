function parseIds(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

export interface DiscordConfig {
  token?: string;
  guildId?: string;
  staffRoleIds: string[];
  arbiterRoleIds: string[];
  modRoleIds: string[];
  archiveCategoryId: string;
}

export const defaultConfig: DiscordConfig = {
  staffRoleIds: ["1514982380161732628"],
  arbiterRoleIds: ["1514982380161732628"],
  modRoleIds: ["1514982380161732628"],
  archiveCategoryId: "1547325033989414952",
};

export function getDiscordConfig(): DiscordConfig {
  const token = process.env.DISCORD_BOT_TOKEN?.trim();

  return {
    token,
    guildId: process.env.DISCORD_GUILD_ID?.trim() || undefined,
    staffRoleIds: parseIds(process.env.STAFF_ROLE_IDS).length > 0
      ? parseIds(process.env.STAFF_ROLE_IDS)
      : defaultConfig.staffRoleIds,
    arbiterRoleIds: parseIds(process.env.ARBITER_ROLE_IDS).length > 0
      ? parseIds(process.env.ARBITER_ROLE_IDS)
      : defaultConfig.arbiterRoleIds,
    modRoleIds: parseIds(process.env.MOD_ROLE_IDS).length > 0
      ? parseIds(process.env.MOD_ROLE_IDS)
      : defaultConfig.modRoleIds,
    archiveCategoryId: process.env.ARCHIVE_CATEGORY_ID?.trim() || defaultConfig.archiveCategoryId,
  };
}
