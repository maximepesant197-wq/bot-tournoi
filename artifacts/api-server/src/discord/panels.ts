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

  // ==================== REGISTRATION & CAPTAIN ROLE ====================

  private async confirmRegistration(interaction: ButtonInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild) return;

    const flowKey = `${guild.id}:${userId(interaction)}`;
    const flow = this.pendingRegistrations.get(flowKey);
    if (!flow || !flow.captainId) {
      return safeReply(interaction, { content: "Inscription invalide ou expirée.", ephemeral: true });
    }

    const registrationId = flow.teamId ?? flowKey;

    await this.store.mutateGuild(guild.id, (state) => {
      if (!state.registrations) state.registrations = {};
      state.registrations[registrationId] = {
        id: flowKey,
        teamId: flow.teamId ?? "",
        format: flow.format,
        captainId: flow.captainId,
        playerIds: flow.playerIds ?? [],
        squads: flow.squads ?? [],
        benchIds: flow.benchIds ?? [],
        checkIn: {},
        status: "registered",
        createdAt: new Date().toISOString(),
      };
    });

    let roleAssigned = false;
    const captainRoleId = this.config.captainRoleId || "1514983622778687669";

    try {
      const member = await guild.members.fetch(flow.captainId).catch(() => null);
      if (member && captainRoleId) {
        await member.roles.add(captainRoleId);
        roleAssigned = true;
      }
    } catch (err) {
      this.logger.error({ err, captainId: flow.captainId }, "Erreur lors de l'attribution du rôle Capitaine");
    }

    this.pendingRegistrations.delete(flowKey);

    await interaction.update({
      content: `✅ **Inscription confirmée !**\n` +
               `• Capitaine : <@${flow.captainId}>\n` +
               `• Format : **${flow.format}**\n` +
               (roleAssigned ? `• Le rôle Capitaine t'a été attribué.` : `⚠️ *Impossible d'attribuer le rôle Capitaine.*`),
      components: [],
    });
  }

  private async finish(interaction: ButtonInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild) return;

    if (!isStaff(interaction, this.config)) {
      return safeReply(interaction, { content: "Seul le Staff peut terminer le tournoi.", ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const state = this.store.getGuild(guild.id);
    const captainIds = new Set<string>();

    if (state.registrations) {
      for (const reg of Object.values(state.registrations)) {
        if (reg.captainId) captainIds.add(reg.captainId);
      }
    }

    if (state.teams) {
      for (const team of Object.values(state.teams)) {
        if (team.captainId) captainIds.add(team.captainId);
      }
    }

    let removedCount = 0;
    const captainRoleId = this.config.captainRoleId || "1514983622778687669";

    for (const captainId of captainIds) {
      try {
        const member = guild.members.cache.get(captainId) ?? await guild.members.fetch(captainId).catch(() => null);
        if (member && member.roles.cache.has(captainRoleId)) {
          await member.roles.remove(captainRoleId);
          removedCount++;
        }
      } catch (err) {
        this.logger.error({ err, captainId }, "Erreur lors du retrait du rôle Capitaine");
      }
    }

    await this.store.mutateGuild(guild.id, (current) => {
      current.status = "finished";
    });

    await interaction.editReply({
      content: `🏁 **Le tournoi est désormais terminé !**\n` +
               `• Statut : \`FINISHED\`\n` +
               `• Rôles Capitaine retirés : **${removedCount}**`,
      components: [],
    });
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

  // ==================== TEAM CREATION & PICKERS ====================

  private async showCaptainPicker(interaction: ButtonInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild) return;

    const flowKey = `${guild.id}:${userId(interaction)}`;
    const flow = this.pendingTeams.get(flowKey);
    if (!flow) {
      return safeReply(interaction, { content: "Session de création expirée.", ephemeral: true });
    }

    const select = new UserSelectMenuBuilder()
      .setCustomId("team-captain-select")
      .setPlaceholder("Sélectionner le capitaine")
      .setMinValues(1)
      .setMaxValues(1);

    await safeReply(interaction, {
      content: `Étape 2/2 : Choisis le capitaine pour la team **${flow.name} [${flow.tag}]** :`,
      components: [new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(select)],
      ephemeral: true,
    });
  }

  private async createTeam(interaction: ButtonInteraction | UserSelectMenuInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild) return;

    const flowKey = `${guild.id}:${userId(interaction)}`;
    const flow = this.pendingTeams.get(flowKey);
    if (!flow) {
      return safeReply(interaction, { content: "Aucune création en cours.", ephemeral: true });
    }

    const teamId = `team_${Date.now()}`;
    const captainId = flow.captainId ?? userId(interaction);

    await interaction.deferReply({ ephemeral: true });

    let roleId = "";
    let categoryId = "";

    try {
      const role = await guild.roles.create({
        name: `Team ${flow.name}`,
        color: 0x3b82f6,
        reason: `Création de team par ${interaction.user.tag}`,
      });
      roleId = role.id;

      const category = await guild.channels.create({
        name: `🏆 ${flow.name}`,
        type: ChannelType.GuildCategory,
        permissionOverwrites: [
          { id: guild.id, deny: ["ViewChannel"] },
          { id: role.id, allow: ["ViewChannel", "SendMessages", "Connect"] },
        ],
      });
      categoryId = category.id;

      await guild.channels.create({
        name: `💬-chat-${flow.tag.toLowerCase()}`,
        type: ChannelType.GuildText,
        parent: category.id,
      });

      await guild.channels.create({
        name: `🔊 Vocal ${flow.tag}`,
        type: ChannelType.GuildVoice,
        parent: category.id,
      });
    } catch (err) {
      this.logger.error({ err }, "Erreur lors de la création des salons/rôles de team");
    }

    const newTeam: Team = {
      id: teamId,
      name: flow.name,
      tag: flow.tag,
      captainId,
      memberIds: Array.from(new Set([captainId, ...flow.memberIds])),
      roleId,
      categoryId,
      createdAt: new Date().toISOString(),
    };

    await this.store.mutateGuild(guild.id, (state) => {
      state.teams[teamId] = newTeam;
    });

    this.pendingTeams.delete(flowKey);

    await interaction.editReply({
      content: `✅ **Team ${newTeam.name} [${newTeam.tag}] créée avec succès !**\nCapitaine : <@${captainId}>\nSalon et catégorie générés.`,
    });
  }

  private async showMemberPicker(interaction: ButtonInteraction, teamId: string, customId: string): Promise<void> {
    const select = new UserSelectMenuBuilder()
      .setCustomId(`${customId}:${teamId}`)
      .setPlaceholder("Sélectionner un ou plusieurs membres")
      .setMinValues(1)
      .setMaxValues(10);

    await safeReply(interaction, {
      content: "Choisis les membres à ajouter :",
      components: [new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(select)],
      ephemeral: true,
    });
  }

  private async showRemoveMemberPicker(interaction: ButtonInteraction, teamId: string): Promise<void> {
    const guild = interaction.guild;
    if (!guild) return;

    const state = this.store.getGuild(guild.id);
    const team = state.teams[teamId];
    if (!team) return safeReply(interaction, { content: "Team introuvable.", ephemeral: true });

    const select = new StringSelectMenuBuilder()
      .setCustomId(`team-remove-members:${teamId}`)
      .setPlaceholder("Sélectionner les membres à retirer")
      .setMinValues(1)
      .setMaxValues(Math.min(team.memberIds.length, 10))
      .addOptions(
        team.memberIds.map((mId) => ({
          label: `Membre ID: ${mId}`,
          value: mId,
        }))
      );

    await safeReply(interaction, {
      content: "Sélectionne le ou les membres à retirer :",
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
      ephemeral: true,
    });
  }

  private async createVoice(interaction: ButtonInteraction, teamId: string): Promise<void> {
    const guild = interaction.guild;
    if (!guild) return;

    const state = this.store.getGuild(guild.id);
    const team = state.teams[teamId];
    if (!team) return safeReply(interaction, { content: "Team introuvable.", ephemeral: true });

    try {
      const channel = await guild.channels.create({
        name: `🔊 Vocal Extra - ${team.tag}`,
        type: ChannelType.GuildVoice,
        parent: team.categoryId || undefined,
      });

      await safeReply(interaction, {
        content: `✅ Salon vocal supplémentaire créé : <#${channel.id}>`,
        ephemeral: true,
      });
    } catch (err) {
      await safeReply(interaction, {
        content: `❌ Erreur lors de la création du salon vocal : ${String(err).slice(0, 100)}`,
        ephemeral: true,
      });
    }
  }

  // ==================== REGISTRATION FLOW ====================

  private async startRegistration(interaction: ButtonInteraction, format: Format): Promise<void> {
    const guild = interaction.guild;
    if (!guild) return;

    const flowKey = `${guild.id}:${userId(interaction)}`;
    this.pendingRegistrations.set(flowKey, {
      guildId: guild.id,
      ownerId: userId(interaction),
      format,
      squads: [],
      playerIds: [],
    });

    await this.showSquadPicker(interaction, 1);
  }

  private async showSquadPicker(interaction: ButtonInteraction | UserSelectMenuInteraction, squadIndex: number): Promise<void> {
    const select = new UserSelectMenuBuilder()
      .setCustomId(`registration-squad-select:${squadIndex}`)
      .setPlaceholder(`Sélectionner les joueurs de la Squad ${squadIndex}`)
      .setMinValues(1)
      .setMaxValues(8);

    await safeReply(interaction, {
      content: `Sélectionne les joueurs titulaires pour la **Squad ${squadIndex}** :`,
      components: [new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(select)],
      ephemeral: true,
    });
  }

  private async showAdditionalSquadPicker(interaction: ButtonInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild) return;

    const flowKey = `${guild.id}:${userId(interaction)}`;
    const flow = this.pendingRegistrations.get(flowKey);
    const nextSquad = (flow?.squads?.length ?? 0) + 1;

    await this.showSquadPicker(interaction, nextSquad);
  }

  private async showBenchPicker(interaction: ButtonInteraction): Promise<void> {
    const select = new UserSelectMenuBuilder()
      .setCustomId("registration-bench-select")
      .setPlaceholder("Sélectionner les remplaçants (optionnel)")
      .setMinValues(1)
      .setMaxValues(5);

    await safeReply(interaction, {
      content: "Sélectionne les joueurs remplaçants ou clique sur 'Aucun remplaçant' :",
      components: [
        new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(select),
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          button("registration-no-bench", "Abonder sans remplaçants", ButtonStyle.Secondary)
        ),
      ],
      ephemeral: true,
    });
  }

  private async showRegistrationCaptainPicker(interaction: ButtonInteraction | UserSelectMenuInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild) return;

    const flowKey = `${guild.id}:${userId(interaction)}`;
    const flow = this.pendingRegistrations.get(flowKey);
    if (!flow) {
      return safeReply(interaction, { content: "Session d'inscription expirée.", ephemeral: true });
    }

    const select = new UserSelectMenuBuilder()
      .setCustomId("registration-captain-select")
      .setPlaceholder("Choisir le capitaine")
      .setMinValues(1)
      .setMaxValues(1);

    await safeReply(interaction, {
      content: "Sélectionne le capitaine de l'inscription parmi les titulaires :",
      components: [new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(select)],
      ephemeral: true,
    });
  }

  // ==================== STAFF MANAGEMENT ACTIONS ====================

  private async replyRegistrations(interaction: ButtonInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild) return;

    const state = this.store.getGuild(guild.id);
    const regs = Object.values(state.registrations ?? {});

    if (regs.length === 0) {
      return safeReply(interaction, { content: "Aucune inscription enregistrée.", ephemeral: true });
    }

    const embed = new EmbedBuilder()
      .setTitle(`📋 Inscriptions (${regs.length})`)
      .setColor(0x10b981)
      .setDescription(
        regs
          .slice(0, 20)
          .map((r, i) => `${i + 1}. Capitaine: <@${r.captainId}> | Format: **${r.format}** | Statut: ${r.status}`)
          .join("\n")
      );

    await safeReply(interaction, { embeds: [embed], ephemeral: true });
  }

  private async sendStaffRegistrationFormatPicker(interaction: ButtonInteraction): Promise<void> {
    const select = new StringSelectMenuBuilder()
      .setCustomId("staff-publish-format-select")
      .setPlaceholder("Choisir le format à publier")
      .addOptions([
        { label: "1v1", value: "1v1" },
        { label: "2v2", value: "2v2" },
        { label: "3v3", value: "3v3" },
        { label: "4v4", value: "4v4" },
      ]);

    await safeReply(interaction, {
      content: "Sélectionne le format du panel d'inscription à publier :",
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
      ephemeral: true,
    });
  }

  private async publishRegistrationPanel(interaction: ButtonInteraction, format: Format): Promise<void> {
    const channel = interaction.channel;
    if (!channel || channel.type !== ChannelType.GuildText) {
      return safeReply(interaction, { content: "Impossible de publier dans ce salon.", ephemeral: true });
    }

    const embed = new EmbedBuilder()
      .setTitle(`📝 INSCRIPTIONS TOURNOI — ${format.toUpperCase()}`)
      .setDescription("Clique sur le bouton ci-dessous pour inscrire ton équipe.")
      .setColor(0x2563eb);

    const btn = button(`format:${format}`, `Inscrire une team (${format})`, ButtonStyle.Success);

    await channel.send({ embeds: [embed], components: [new ActionRowBuilder<ButtonBuilder>().addComponents(btn)] });
    await safeReply(interaction, { content: `Panel ${format} publié avec succès.`, ephemeral: true });
  }

  private async startCheckIn(interaction: ButtonInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild) return;

    await this.store.mutateGuild(guild.id, (state) => {
      state.status = "checkin";
    });

    await safeReply(interaction, { content: "🟢 **Check-in ouvert !** Les joueurs peuvent valider leur présence." });
  }

  private async closeCheckIn(interaction: ButtonInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild) return;

    await this.store.mutateGuild(guild.id, (state) => {
      state.status = "draft";
    });

    await safeReply(interaction, { content: "🔴 **Check-in fermé !** Préparation du tirage au sort." });
  }

  private async draw(interaction: ButtonInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild) return;

    await interaction.deferReply();

    const state = this.store.getGuild(guild.id);
    const teamsList = Object.values(state.teams);

    if (teamsList.length < 2) {
      return safeReply(interaction, { content: "Il faut au moins 2 teams pour générer un tirage.", ephemeral: true });
    }

    const result = createBracket(teamsList);
    await this.store.mutateGuild(guild.id, (current) => {
      current.matches = result.matches;
      current.status = "draw-done";
    });

    await interaction.editReply({ content: `🎲 **Tirage au sort effectué avec succès !** (${Object.keys(result.matches).length} matchs générés)` });
  }

  private async confirmLaunch(interaction: ButtonInteraction): Promise<void> {
    await safeReply(interaction, {
      content: "🚀 **Lancer le tournoi ?** Les premiers matchs passeront au statut *en cours*.",
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          button("staff-launch-confirm", "🚀 Confirmer le lancement", ButtonStyle.Success),
          button("staff-cancel", "Annuler", ButtonStyle.Secondary)
        ),
      ],
      ephemeral: true,
    });
  }

  private async launch(interaction: ButtonInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild) return;

    await this.store.mutateGuild(guild.id, (state) => {
      state.status = "in-progress";
      activateAvailableMatches(state);
    });

    await safeReply(interaction, { content: "🚀 **Tournoi officiellement lancé !** Bonne chance à tous les participants." });
  }

  private async pause(interaction: ButtonInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild) return;

    await this.store.mutateGuild(guild.id, (state) => {
      state.status = "paused";
    });

    await safeReply(interaction, { content: "⏸️ **Tournoi mis en pause par le Staff.**" });
  }

  private async resume(interaction: ButtonInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild) return;

    await this.store.mutateGuild(guild.id, (state) => {
      state.status = "in-progress";
    });

    await safeReply(interaction, { content: "▶️ **Tournoi repris !**" });
  }

  private async confirmFinish(interaction: ButtonInteraction): Promise<void> {
    await safeReply(interaction, {
      content: "🏁 **Terminer le tournoi ?** Tous les rôles capitaines seront retirés et le tournoi clôturé.",
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          button("staff-finish-confirm", "🏁 Confirmer la fin du tournoi", ButtonStyle.Danger),
          button("staff-cancel", "Annuler", ButtonStyle.Secondary)
        ),
      ],
      ephemeral: true,
    });
  }

  private async confirmTournamentDeletion(interaction: ButtonInteraction): Promise<void> {
    await safeReply(interaction, {
      content: "⚠️ **RÉINITIALISATION TOTALE DANGER**\n\nVeux-tu supprimer l'intégralité des données du tournoi courant (matchs, tirages, inscriptions) ?",
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          button("staff-delete-tournament-confirm", "💥 SUPPRIMER TOUT LE TOURNOI", ButtonStyle.Danger),
          button("staff-cancel", "Annuler", ButtonStyle.Secondary)
        ),
      ],
      ephemeral: true,
    });
  }

  private async deleteTournament(interaction: ButtonInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild) return;

    await this.store.resetGuild(guild.id);
    await safeReply(interaction, { content: "💥 **Données du tournoi réinitialisées.**" });
  }

  private async showStaffTeamDeletePicker(interaction: ButtonInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild) return;

    const state = this.store.getGuild(guild.id);
    const teams = Object.values(state.teams);

    if (teams.length === 0) {
      return safeReply(interaction, { content: "Aucune team à supprimer.", ephemeral: true });
    }

    const select = new StringSelectMenuBuilder()
      .setCustomId("staff-team-delete-select")
      .setPlaceholder("Choisir une team à supprimer par le Staff")
      .addOptions(teams.slice(0, 25).map((t) => ({ label: `${t.name} [${t.tag}]`, value: t.id })));

    await safeReply(interaction, {
      content: "Sélectionne la team à supprimer :",
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
      ephemeral: true,
    });
  }

  private async showStaffMemberPicker(interaction: ButtonInteraction): Promise<void> {
    const select = new UserSelectMenuBuilder()
      .setCustomId("staff-member-delete-select")
      .setPlaceholder("Sélectionner un membre à retirer d'une team")
      .setMinValues(1)
      .setMaxValues(1);

    await safeReply(interaction, {
      content: "Sélectionne le membre à retirer :",
      components: [new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(select)],
      ephemeral: true,
    });
  }

  private async deleteStaffMember(interaction: ButtonInteraction, targetUserId: string): Promise<void> {
    const guild = interaction.guild;
    if (!guild) return;

    let modified = false;

    await this.store.mutateGuild(guild.id, (state) => {
      for (const team of Object.values(state.teams)) {
        if (team.memberIds.includes(targetUserId)) {
          team.memberIds = team.memberIds.filter((id) => id !== targetUserId);
          modified = true;
        }
      }
    });

    if (modified) {
      await safeReply(interaction, { content: `✅ Membre <@${targetUserId}> retiré de son équipe par le Staff.`, ephemeral: true });
    } else {
      await safeReply(interaction, { content: "Membre introuvable dans les équipes actives.", ephemeral: true });
    }
  }

  // ==================== CHECKIN & DISPUTES ====================

  private async confirmPresence(interaction: ButtonInteraction, all: boolean): Promise<void> {
    const guild = interaction.guild;
    if (!guild) return;

    const uid = userId(interaction);
    const state = this.store.getGuild(guild.id);
    const myTeam = Object.values(state.teams).find((t) => t.memberIds.includes(uid));

    if (!myTeam) {
      return safeReply(interaction, { content: "Tu ne fais partie d'aucune team.", ephemeral: true });
    }

    await this.store.mutateGuild(guild.id, (current) => {
      if (!current.checkIns) current.checkIns = {};
      if (all && current.teams[myTeam.id]) {
        for (const mId of current.teams[myTeam.id].memberIds) {
          current.checkIns[mId] = true;
        }
      } else {
        current.checkIns[uid] = true;
      }
    });

    await safeReply(interaction, {
      content: all ? `✅ **Check-in validé pour toute l'équipe ${myTeam.name} !**` : `✅ **Ton check-in est validé !**`,
      ephemeral: true,
    });
  }

  private async openDispute(interaction: ButtonInteraction, matchId: string): Promise<void> {
    const guild = interaction.guild;
    if (!guild) return;

    await this.store.mutateGuild(guild.id, (state) => {
      const match = state.matches[matchId];
      if (match) {
        match.status = "disputed";
      }
    });

    await safeReply(interaction, {
      content: `⚠️ **Litige ouvert sur le Match ${matchId} !** Un arbitre ou un membre du Staff a été notifié.`,
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          button(`dispute-call:${matchId}`, "🔔 Appeler un arbitre", ButtonStyle.Danger),
          button(`dispute-resolve:${matchId}`, "⚖️ Résoudre le litige (Staff)", ButtonStyle.Primary)
        ),
      ],
    });
  }

  private async callArbiter(interaction: ButtonInteraction, matchId: string): Promise<void> {
    await safeReply(interaction, {
      content: `📢 **Arbitre appelé pour le match ${matchId} !** Merci de patienter.`,
    });
  }

  private async showDisputeResolution(interaction: ButtonInteraction, matchId: string): Promise<void> {
        if (!isStaff(interaction, this.config) && !isArbiter(interaction, this.config)) {
      return safeReply(interaction, { content: "Accès réservé aux arbitres et au staff.", ephemeral: true });
    }

    const guild = interaction.guild;
    if (!guild) return;

    const state = this.store.getGuild(guild.id);
    const match = state.matches[matchId];
    if (!match) return safeReply(interaction, { content: "Match introuvable.", ephemeral: true });

    const teamA = match.teamAId ? state.teams[match.teamAId] : undefined;
    const teamB = match.teamBId ? state.teams[match.teamBId] : undefined;

    const select = new StringSelectMenuBuilder()
      .setCustomId(`dispute-winner-select:${matchId}`)
      .setPlaceholder("Désigner le vainqueur du litige")
      .addOptions([
        { label: `Vainqueur : ${teamA?.name ?? match.teamAId ?? "Team A"}`, value: match.teamAId ?? "" },
        { label: `Vainqueur : ${teamB?.name ?? match.teamBId ?? "Team B"}`, value: match.teamBId ?? "" },
      ]);

    await safeReply(interaction, {
      content: `Arbitrage du **Match ${matchId}** :`,
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
      ephemeral: true,
    });
  }
}

// ==================== HELPER FUNCTIONS & UI BUILDERS ====================

function button(customId: string, label: string, style: ButtonStyle = ButtonStyle.Primary): ButtonBuilder {
  return new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style);
}

async function safeReply(interaction: ReplyableInteraction, options: InteractionReplyOptions): Promise<void> {
  if (interaction.replied || interaction.deferred) {
    await interaction.followUp(options);
  } else {
    await interaction.reply(options);
  }
}

function teamPanel() {
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle("🛡️ Gestion Équipe")
        .setDescription("Crée ton équipe, gère tes joueurs ou configure tes salons vocaux.")
        .setColor(0x3b82f6),
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        button("team-create", "➕ Créer une Team", ButtonStyle.Success),
        button("team-manage", "⚙️ Gérer ma Team", ButtonStyle.Primary),
        button("team-delete", "🗑️ Supprimer ma Team", ButtonStyle.Danger)
      ),
    ],
  };
}

function registrationPanel() {
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle("📝 Panel Inscription")
        .setDescription("Inscris ton équipe aux formats disponibles.")
        .setColor(0x10b981),
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        button("format:1v1", "1v1", ButtonStyle.Secondary),
        button("format:2v2", "2v2", ButtonStyle.Secondary),
        button("format:3v3", "3v3", ButtonStyle.Secondary),
        button("format:4v4", "4v4", ButtonStyle.Secondary)
      ),
    ],
  };
}

function staffPanel() {
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle("🛠️ Administration Tournoi")
        .setDescription("Gestion du tournoi, check-in, tirage et clôture.")
        .setColor(0xef4444),
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        button("staff-start-checkin", "🟢 Ouvrir Check-in", ButtonStyle.Success),
        button("staff-close-checkin", "🔴 Fermer Check-in", ButtonStyle.Secondary),
        button("staff-draw", "🎲 Tirage au sort", ButtonStyle.Primary),
        button("staff-launch", "🚀 Lancer", ButtonStyle.Success)
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        button("staff-pause", "⏸️ Pause", ButtonStyle.Secondary),
        button("staff-resume", "▶️ Reprendre", ButtonStyle.Secondary),
        button("staff-finish", "🏁 Terminer Tournoi", ButtonStyle.Danger),
        button("staff-moderation", "⚙️ Modération / Suppressions", ButtonStyle.Danger)
      ),
    ],
  };
}

function staffModerationPanel() {
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle("⚙️ Panel Modération / Suppressions")
        .setDescription("Actions de suppression d'urgence pour le Staff.")
        .setColor(0xd97706),
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        button("staff-delete-team", "🗑️ Supprimer une Team", ButtonStyle.Danger),
        button("staff-delete-member", "👤 Retirer un Membre", ButtonStyle.Danger),
        button("staff-delete-tournament", "💥 Réinitialiser Tournoi", ButtonStyle.Danger)
      ),
    ],
  };
}

function scorePanel() {
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle("⚽ Saisie des Scores")
        .setDescription("Propose un score pour tes matchs ou consulte tes rencontres.")
        .setColor(0x8b5cf6),
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        button("score-enter", "✏️ Saisir un Score", ButtonStyle.Primary),
        button("score-my-matches", "📅 Mes Matchs", ButtonStyle.Secondary)
      ),
    ],
  };
}

function teamManagementPanel(team: Team) {
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle(`⚙️ Gestion : ${team.name} [${team.tag}]`)
        .setDescription(`Capitaine : <@${team.captainId}>\nMembres (${team.memberIds.length}) : ${team.memberIds.map((id) => `<@${id}>`).join(", ")}`)
        .setColor(0x3b82f6),
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        button(`team-manage-add:${team.id}`, "➕ Ajouter Joueurs", ButtonStyle.Success),
        button(`team-manage-remove:${team.id}`, "➖ Retirer Joueurs", ButtonStyle.Danger),
        button(`team-manage-voice:${team.id}`, "🔊 Créer Vocal", ButtonStyle.Secondary)
      ),
    ],
  };
}

function teamCreationModal(): ModalBuilder {
  const modal = new ModalBuilder().setCustomId("team-create-modal").setTitle("Création d'Équipe");

  const nameInput = new TextInputBuilder()
    .setCustomId("team-name")
    .setLabel("Nom de l'équipe")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const tagInput = new TextInputBuilder()
    .setCustomId("team-tag")
    .setLabel("Tag / Trigramme (ex: OT)")
    .setStyle(TextInputStyle.Short)
    .setMaxLength(5)
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(tagInput)
  );

  return modal;
        }
