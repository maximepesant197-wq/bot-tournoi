import {
  GuildMember,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Guild,
  type Interaction,
  PermissionFlagsBits,
} from "discord.js";
import type { DiscordConfig } from "./config";
import type { Team } from "./types";

export function memberOf(interaction: Interaction): GuildMember | null {
  return interaction.member instanceof GuildMember ? interaction.member : null;
}

export function isStaff(interaction: Interaction, config: DiscordConfig): boolean {
  const member = memberOf(interaction);
  if (!member) return false;
  return (
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    config.staffRoleIds.some((roleId) => member.roles.cache.has(roleId))
  );
}

export function isArbiter(interaction: Interaction, config: DiscordConfig): boolean {
  const member = memberOf(interaction);
  if (!member) return false;
  return (
    isStaff(interaction, config) ||
    config.arbiterRoleIds.some((roleId) => member.roles.cache.has(roleId))
  );
}

export function userId(interaction: Interaction): string {
  return interaction.user.id;
}

export function isCaptain(interaction: Interaction, team: Team): boolean {
  return team.captainId === userId(interaction);
}

export function canManageTeam(interaction: Interaction, team: Team, config: DiscordConfig): boolean {
  return isStaff(interaction, config) || isCaptain(interaction, team);
}

export function requireGuild(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
): Guild | null {
  return interaction.guild;
}