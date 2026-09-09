import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  ModalBuilder,
  ModalSubmitInteraction,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  UserSelectMenuInteraction,
  type ChatInputCommandInteraction,
  type InteractionReplyOptions,
} from "discord.js";
import type { Logger } from "pino";
import type { DiscordConfig } from "./config";
import {
  canManageTeam,
  isArbiter,
  isStaff,
  userId,
} from "./permissions";
import { TournamentStore } from "./store";
import { renderBracketImage, buildBracketSvg } from "./bracket-image";
import {
  activateAvailableMatches,
  confirmScore,
  createBracket,
  formatFromValue,
} from "./tournament";
import type {
  Format,
  Team,
} from "./types";

interface PendingTeamFlow {
  guildId: string;
  ownerId: string;
  name: string;
  tag: string;
  memberIds: string[];
  captainId?: string;
}

interface PendingRegistrationFlow {
  guildId: string;
  ownerId: string;
  format: Format;
  teamId?: string;
  playerIds?: string[];
  squads?: string[][];
  benchIds?: string[];
  captainId?: string;
}

type ReplyableInteraction =
  | ChatInputCommandInteraction
  | ButtonInteraction
  | StringSelectMenuInteraction
  | UserSelectMenuInteraction
  | ModalSubmitInteraction;

export class PanelController {
  private readonly pendingTeams = new Map<string, PendingTeamFlow>();
  private readonly pendingRegistrations = new Map<string, PendingRegistrationFlow>();

  public constructor(
    private readonly client: Client,
    private readonly store: TournamentStore,
    private readonly config: DiscordConfig,
    private readonly logger: Logger,
  ) {}

  // ==================== PANELS ====================

  public async sendTeamPanel(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.reply({
      content: "Panel séparé — crée ou gère une team sans mélanger les actions Staff.",
      ...teamPanel(),
    });
  }

  public async sendRegistrationPanel(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.reply({
      content: "Panel séparé — choisis le format puis compose tes squads.",
      ...registrationPanel(),
    });
  }

  public async sendStaffPanel(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.reply({
      content: "Panel Staff — chaque action sensible demande une confirmation dédiée.",
      ...staffPanel(),
    });
  }

  private async sendStaffModerationPanel(interaction: ButtonInteraction): Promise<void> {
    if (!isStaff(interaction, this.config)) return safeReply(interaction, { content: "Accès réservé au Staff/Admin.", ephemeral: true });
    await safeReply(interaction, {
      content: "Panel Staff — suppressions sensibles. Chaque action demande une confirmation.",
      ...staffModerationPanel(),
      ephemeral: true,
    });
  }

  public async sendDrawPrompt(interaction: ChatInputCommandInteraction | ButtonInteraction): Promise<void> {
    await interaction.reply({
      content: "Le tirage est une action irréversible pour le bracket courant. Confirmer ?",
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          button("staff-draw-confirm", "🎲 Confirmer le tirage", ButtonStyle.Danger),
          button("staff-cancel", "Annuler", ButtonStyle.Secondary),
        ),
      ],
      ephemeral: true,
    });
  }

  public async sendScorePanel(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.reply({
      content: "Panel séparé — seuls les capitaines des matchs concernés peuvent saisir un score.",
      ...scorePanel(),
    });
  }

  // ==================== BUTTON HANDLER ====================

  public async handleButton(interaction: ButtonInteraction): Promise<void> {
    const [action, id, contextId] = interaction.customId.split(":");
    switch (action) {
      case "team-create":
        await interaction.showModal(teamCreationModal());
        return;
      case "team-create-continue":
        await this.showCaptainPicker(interaction);
        return;
      case "team-create-confirm":
        await this.createTeam(interaction);
        return;
      case "team-manage":
        await this.openMyTeamManagement(interaction);
        return;
      case "team-delete":
        await this.openMyTeamDeletion(interaction);
        return;
      case "team-manage-add":
        await this.showMemberPicker(interaction, id, "team-add-members");
        return;
      case "team-manage-remove":
        await this.showRemoveMemberPicker(interaction, id);
        return;
      case "staff-moderation":
        await this.sendStaffModerationPanel(interaction);
        return;
      case "staff-delete-team":
        await this.showStaffTeamDeletePicker(interaction);
        return;
      case "staff-delete-tournament":
        await this.confirmTournamentDeletion(interaction);
        return;
      case "staff-delete-tournament-confirm":
        await this.deleteTournament(interaction);
        return;
      case "staff-delete-member":
        await this.showStaffMemberPicker(interaction);
        return;
      case "staff-member-delete-confirm":
        await this.deleteStaffMember(interaction, id);
        return;
      case "team-manage-voice":
        await this.createVoice(interaction, id);
        return;
      case "team-manage-delete":
        await this.confirmTeamDeletion(interaction, id);
        return;
      case "team-delete-confirm":
        await this.deleteTeam(interaction, id);
        return;
      case "checkin-self":
        await this.confirmPresence(interaction, false);
        return;
      case "checkin-all":
        await this.confirmPresence(interaction, true);
        return;
      case "bracket":
        await this.replyBracket(interaction);
        return;
      case "my-match":
        await this.replyMyMatch(interaction);
        return;
      case "format":
        await this.startRegistration(interaction, formatFromValue(id ?? ""));
        return;
      case "registration-confirm":
        await this.confirmRegistration(interaction);
        return;
      case "registration-squad-add":
        await this.showAdditionalSquadPicker(interaction);
        return;
      case "registration-squad-finish":
        await this.showBenchPicker(interaction);
        return;
      case "registration-no-bench":
        await this.showRegistrationCaptainPicker(interaction);
        return;
      case "staff-registrations":
        await this.replyRegistrations(interaction);
        return;
      case "staff-publish-registration":
        await this.sendStaffRegistrationFormatPicker(interaction);
        return;
      case "staff-format":
        await this.publishRegistrationPanel(interaction, formatFromValue(id ?? ""));
        return;
      case "staff-start-checkin":
        await this.startCheckIn(interaction);
        return;
      case "staff-close-checkin":
        await this.closeCheckIn(interaction);
        return;
      case "staff-draw":
        await this.sendDrawPrompt(interaction);
        return;
      case "staff-draw-confirm":
        await this.draw(interaction);
        return;
      case "staff-bracket":
        await this.replyBracket(interaction);
        return;
      case "staff-launch":
        await this.confirmLaunch(interaction);
        return;
      case "staff-launch-confirm":
        await this.launch(interaction);
        return;
      case "staff-pause":
        await this.pause(interaction);
        return;
      case "staff-resume":
        await this.resume(interaction);
        return;
      case "staff-finish":
        await this.confirmFinish(interaction);
        return;
      case "staff-finish-confirm":
        await this.finish(interaction);
        return;
      case "team-delete-cancel":
        await interaction.update({ content: "Suppression de la team annulée.", components: [] });
        return;
      case "staff-cancel":
        await interaction.update({ content: "Action annulée.", components: [] });
        return;
      case "score-enter":
        await this.showScoreMatchPicker(interaction);
        return;
      case "score-my-matches":
        await this.replyMyMatch(interaction);
        return;
      case "score-confirm":
        await this.confirmProposedScore(interaction, id, contextId);
        return;
      case "score-dispute":
        await this.openDispute(interaction, id);
        return;
      case "dispute-call":
        await this.callArbiter(interaction, id);
        return;
      case "dispute-resolve":
        await this.showDisputeResolution(interaction, id);
        return;
      default:
        await safeReply(interaction, { content: "Interaction inconnue ou expirée.", ephemeral: true });
    }
  }

  // ==================== BRACKET IMAGE ====================

  private async replyBracket(interaction: ButtonInteraction | ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild) return;
    const state = this.store.getGuild(guild.id);
    
    if (Object.keys(state.matches).length === 0) {
      return safeReply(interaction, { content: "Aucun bracket généré. Fais `/tirage` d'abord.", ephemeral: true });
    }

    await interaction.deferReply();

    try {
      const buffer = await renderBracketImage(state);
      const attachment = new AttachmentBuilder(buffer, { name: `bracket-${Date.now()}.png` });
      
      const embed = new EmbedBuilder()
        .setTitle(`🏆 ARENA FR - Bracket ${Object.keys(state.teams).length} teams`)
        .setDescription(`**Winners:** ${Object.values(state.matches).filter(m => (m.bracket ?? "winners") === "winners").length} matchs | **Losers:** ${Object.values(state.matches).filter(m => m.bracket === "losers").length} matchs`)
        .setColor(0x1d4ed8)
        .setImage(`attachment://${attachment.name}`);

      await interaction.editReply({
        embeds: [embed],
        files: [attachment],
      });
    } catch (error) {
      this.logger.error({ err: error }, "Bracket image failed - fallback to SVG");
      try {
        const svg = buildBracketSvg(state);
        const attachment = new AttachmentBuilder(Buffer.from(svg), { name: "bracket.svg" });
        await interaction.editReply({
          content: "⚠️ PNG échoué. Voici le SVG :",
          files: [attachment],
        });
      } catch (e) {
        await interaction.editReply({ content: `Erreur bracket: ${String(e).slice(0, 1000)}` });
      }
    }
  }

  // ==================== SCORE CONFIRMATION ====================

  private async confirmProposedScore(interaction: ButtonInteraction, matchId: string, contextId?: string): Promise<void> {
    const guild = interaction.guild;
    if (!guild) return;
    const state = this.store.getGuild(guild.id);
    const match = state.matches[matchId];
    
    if (!match) return safeReply(interaction, { content: "Match introuvable.", ephemeral: true });
    if (match.status !== "awaiting-confirmation") {
      return safeReply(interaction, { content: "Ce score ne peut plus être confirmé (déjà terminé ou pas proposé).", ephemeral: true });
    }

    const teamA = match.teamAId ? state.teams[match.teamAId] : undefined;
    const teamB = match.teamBId ? state.teams[match.teamBId] : undefined;
    if (!teamA || !teamB) return safeReply(interaction, { content: "Teams introuvables pour ce match.", ephemeral: true });

    const uid = userId(interaction);
    const isCapA = teamA.captainId === uid;
    const isCapB = teamB.captainId === uid;
    const staff = isStaff(interaction, this.config) || isArbiter(interaction, this.config);

    if (!isCapA && !isCapB && !staff) {
      return safeReply(interaction, { content: "Seul un capitaine du match ou le staff peut confirmer.", ephemeral: true });
    }
    if (match.proposedBy === uid) {
      return safeReply(interaction, { content: "Tu ne peux pas confirmer ton propre score.", ephemeral: true });
    }

    const proposerIsA = match.proposedBy === teamA.captainId;
    const proposerIsB = match.proposedBy === teamB.captainId;
    
    if (!staff) {
      if (proposerIsA && uid !== teamB.captainId) {
        return safeReply(interaction, { content: `Seul le capitaine adverse (<@${teamB.captainId}>) peut confirmer.`, ephemeral: true });
      }
      if (proposerIsB && uid !== teamA.captainId) {
        return safeReply(interaction, { content: `Seul le capitaine adverse (<@${teamA.captainId}>) peut confirmer.`, ephemeral: true });
      }
    }

    const result = confirmScore(state, match, uid);
    if (!result.ok) {
      return safeReply(interaction, { content: result.error ?? "Erreur confirmation.", ephemeral: true });
    }

    await this.store.mutateGuild(guild.id, (current) => {
      const m = current.matches[matchId];
      if (m) {
        m.winnerId = result.winnerId;
        m.loserId = result.loserId;
        m.status = "completed";
      }
    });

    await this.store.mutateGuild(guild.id, (current) => {
      activateAvailableMatches(current);
    });

    await safeReply(interaction, { 
      content: `✅ Score confirmé! Vainqueur: **${state.teams[result.winnerId!]?.name ?? result.winnerId}**\nMatch ${matchId} terminé.`, 
    });

    try {
      const updatedState = this.store.getGuild(guild.id);
      const buffer = await renderBracketImage(updatedState);
      const attachment = new AttachmentBuilder(buffer, { name: `bracket-updated.png` });
      await interaction.followUp({ files: [attachment] });
    } catch {}
  }

  private async replyMyMatch(interaction: ButtonInteraction | ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild) return;
    const state = this.store.getGuild(guild.id);
    const uid = userId(interaction);
    const myTeam = Object.values(state.teams).find(t => t.memberIds.includes(uid));
    if (!myTeam) return safeReply(interaction, { content: "Tu n'es dans aucune team.", ephemeral: true });
    
    const myMatches = Object.values(state.matches).filter(m => 
      m.teamAId === myTeam.id || m.teamBId === myTeam.id
    );
    if (myMatches.length === 0) return safeReply(interaction, { content: "Aucun match pour ta team.", ephemeral: true });

    const embed = new EmbedBuilder()
      .setTitle(`Tes matchs - ${myTeam.name} [${myTeam.tag}]`)
      .setColor(0x1d4ed8)
      .setDescription(myMatches.map(m => {
        const oppId = m.teamAId === myTeam.id ? m.teamBId : m.teamAId;
        const opp = oppId ? state.teams[oppId]?.name ?? oppId : "À venir";
        return `**${m.id}** (${m.bracket ?? "winners"} R${m.round}) vs ${opp} - ${m.status}`;
      }).join("\n"));

    await safeReply(interaction, { embeds: [embed], ephemeral: true });
  }

  private async showScoreMatchPicker(interaction: ButtonInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild) return;
    const state = this.store.getGuild(guild.id);
    const uid = userId(interaction);
    const myTeam = Object.values(state.teams).find(t => t.memberIds.includes(uid));
    if (!myTeam) return safeReply(interaction, { content: "Tu n'es dans aucune team.", ephemeral: true });

    const available = Object.values(state.matches).filter(m => 
      (m.teamAId === myTeam.id || m.teamBId === myTeam.id) && m.status === "in-progress"
    );
    if (available.length === 0) return safeReply(interaction, { content: "Aucun match à scorer.", ephemeral: true });

    const select = new StringSelectMenuBuilder()
      .setCustomId("score-match")
      .setPlaceholder("Choisir un match à scorer")
      .addOptions(available.slice(0, 25).map(m => {
        const oppId = m.teamAId === myTeam.id ? m.teamBId : m.teamAId;
        const opp = oppId ? state.teams[oppId]?.tag ?? "TBD" : "TBD";
        return { label: `${m.id} vs ${opp}`, value: m.id };
      }));

    await safeReply(interaction, {
      content: "Sélectionne un match pour proposer un score :",
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
      ephemeral: true,
    });
  }

  private async openMyTeamManagement(interaction: ButtonInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild) return;
    const state = this.store.getGuild(guild.id);
    const myTeam = Object.values(state.teams).find(t => t.captainId === userId(interaction));
    if (!myTeam) return safeReply(interaction, { content: "Tu n'es capitaine d'aucune team.", ephemeral: true });
    await safeReply(interaction, { ...teamManagementPanel(myTeam), ephemeral: true });
  }

  private async openMyTeamDeletion(interaction: ButtonInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild) return;

    const state = this.store.getGuild(guild.id);
    const myTeam = Object.values(state.teams).find(t => t.captainId === userId(interaction));

    if (!myTeam) {
      return safeReply(interaction, {
        content: "Tu n'es capitaine d'aucune team.",
        ephemeral: true,
      });
    }

    await safeReply(interaction, {
      content: `⚠️ **Supprimer la team ${myTeam.name} [${myTeam.tag}] ?**\n\nCette action déplacera **tous les salons** vers la catégorie d'archivage, supprimera le rôle de la team, la catégorie et les données liées à la team.\n\n**Cette action est irréversible.**`,
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          button(`team-delete-confirm:${myTeam.id}`, "🗑️ Confirmer la suppression", ButtonStyle.Danger),
          button("team-delete-cancel", "Annuler", ButtonStyle.Secondary),
        ),
      ],
      ephemeral: true,
    });
  }

  private async confirmTeamDeletion(interaction: ButtonInteraction, teamId: string): Promise<void> {
    const guild = interaction.guild;
    if (!guild) return;

    const state = this.store.getGuild(guild.id);
    const team = state.teams[teamId];
    if (!team) {
      return safeReply(interaction, { content: "Team introuvable ou déjà supprimée.", ephemeral: true });
    }

    if (!this.canManageTeamOrMod(interaction, team)) {
      return safeReply(interaction, { content: "Seul le capitaine de la team, le Staff ou un Modérateur peut la supprimer.", ephemeral: true });
    }

    await safeReply(interaction, {
      content: `⚠️ **Dernière confirmation : supprimer ${team.name} [${team.tag}] ?**\n\nTous les salons de la catégorie seront déplacés vers la catégorie d'archivage, le rôle, la catégorie d'origine et les données de tournoi liées seront supprimés.`,
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          button(`team-delete-confirm:${team.id}`, "🗑️ Confirmer la suppression", ButtonStyle.Danger),
          button("team-delete-cancel", "Annuler", ButtonStyle.Secondary),
        ),
      ],
      ephemeral: true,
    });
  }

  private canManageTeamOrMod(interaction: ButtonInteraction, team: Team): boolean {
    if (canManageTeam(interaction, team, this.config)) return true;

    const modRoleId = "1514982380161732628";
    const member = interaction.member;
    if (member && "roles" in member && Array.isArray(member.roles)) {
      return member.roles.includes(modRoleId);
    } else if (member && "roles" in member && typeof member.roles === "object" && "cache" in member.roles) {
      return (member.roles as any).cache.has(modRoleId);
    }
    return false;
  }

  // ==================== DELETION LOGIC (ARCHIVE ARCHITECTURE) ====================

  private async deleteTeam(interaction: ButtonInteraction, teamId?: string): Promise<void> {
    const guild = interaction.guild;
    if (!guild) return;

    const state = this.store.getGuild(guild.id);
    const id = teamId ?? Object.values(state.teams).find(t => t.captainId === userId(interaction))?.id;

    if (!id) {
      return safeReply(interaction, { content: "Team introuvable.", ephemeral: true });
           }
        const team = state.teams[id];
    if (!team) {
      return safeReply(interaction, { content: "Team introuvable ou déjà supprimée.", ephemeral: true });
    }

    if (!this.canManageTeamOrMod(interaction, team)) {
      return safeReply(interaction, { 
        content: "Seul le capitaine de la team, le Staff ou un Modérateur peut effectuer cette action.", 
        ephemeral: true 
      });
    }

    await interaction.deferReply({ ephemeral: true });

    const errors: string[] = [];
    const targetCategoryId = "1547325033989414952";

    const currentCategory = guild.channels.cache.get(team.categoryId) ?? await guild.channels.fetch(team.categoryId).catch(() => null);
    const targetCategory = guild.channels.cache.get(targetCategoryId) ?? await guild.channels.fetch(targetCategoryId).catch(() => null);

    if (!targetCategory || targetCategory.type !== ChannelType.GuildCategory) {
      errors.push(`La catégorie cible d'archivage (ID: ${targetCategoryId}) n'a pas été trouvée sur le serveur.`);
    } else if (currentCategory && currentCategory.type === ChannelType.GuildCategory) {
      const children = guild.channels.cache.filter(c => c.parentId === currentCategory.id);
      for (const [_, channel] of children) {
        try {
          await channel.setParent(targetCategoryId, { lockPermissions: true });
        } catch (err) {
          errors.push(`Impossible de déplacer le salon ${channel.name} : ${String(err).slice(0, 100)}`);
        }
      }

      try {
        await currentCategory.delete(`Suppression/Archivage de la team ${team.name}`);
      } catch (err) {
        errors.push(`Erreur lors de la suppression de la catégorie : ${String(err).slice(0, 100)}`);
      }
    }

    try {
      const role = guild.roles.cache.get(team.roleId) ?? await guild.roles.fetch(team.roleId).catch(() => null);
      if (role) {
        await role.delete(`Suppression de la team ${team.name}`);
      }
    } catch (err) {
      errors.push(`Erreur lors de la suppression du rôle : ${String(err).slice(0, 100)}`);
    }

    try {
      await this.store.deleteTeamFully(guild.id, id);
    } catch (err) {
      errors.push(`Erreur base de données : ${String(err).slice(0, 100)}`);
    }

    if (errors.length === 0) {
      await interaction.editReply({
        content: `✅ **La team ${team.name} [${team.tag}] a été supprimée.**\nTous ses salons ont été déplacés dans la catégorie d'archivage avec les permissions du Staff.`,
        components: [],
      });
    } else {
      await interaction.editReply({
        content: `⚠️ **Action effectuée avec des avertissements :**\n` + errors.join("\n"),
        components: [],
      });
    }
  }
  
