import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  Guild,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  TextChannel,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  UserSelectMenuInteraction,
  type ChatInputCommandInteraction,
  type InteractionReplyOptions,
  type ModalSubmitInteraction,
} from "discord.js";
import type { Logger } from "pino";
import type { DiscordConfig } from "./config";
import {
  canManageTeam,
  isArbiter,
  isCaptain,
  isStaff,
  memberOf,
  userId,
} from "./permissions";
import { TournamentStore } from "./store";
import {
  activateAvailableMatches,
  calculateRanking,
  confirmScore,
  createBracket,
  FORMAT_LABELS,
  formatFromValue,
  isTournamentComplete,
  registrationIsComplete,
  registrationsForTeam,
  resolveScore,
  submitScore,
} from "./tournament";
import type {
  Dispute,
  Format,
  GuildTournamentState,
  Match,
  Registration,
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

  public async handleButton(interaction: ButtonInteraction): Promise<void> {
    const [action, id] = interaction.customId.split(":");
    switch (action) {
      case "team-create":
        await interaction.showModal(teamCreationModal());
        return;
      case "team-create-continue":
        await this.showCaptainPicker(interaction, "team-create");
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
      case "team-add-members":
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
        await this.confirmProposedScore(interaction, id);
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

  public async handleUserSelect(interaction: UserSelectMenuInteraction): Promise<void> {
    const [action, id] = interaction.customId.split(":");
    switch (action) {
      case "team-create-members":
        await this.selectTeamMembers(interaction);
        return;
      case "team-create-captain":
        await this.selectTeamCaptain(interaction);
        return;
      case "team-add-members":
        await this.addMembers(interaction, id);
        return;
      case "registration-members":
        await this.selectRegistrationMembers(interaction);
        return;
      default:
        await safeReply(interaction, { content: "Menu expiré.", ephemeral: true });
    }
  }

  public async handleStringSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const [action, id] = interaction.customId.split(":");
    switch (action) {
      case "registration-team":
        await this.selectRegistrationTeam(interaction);
        return;
      case "registration-captain":
        await this.selectRegistrationCaptain(interaction);
        return;
      case "registration-members":
        await this.selectRegistrationMembers(interaction);
        return;
      case "registration-squad-members":
        await this.selectAdditionalSquadMembers(interaction);
        return;
      case "registration-bench-members":
        await this.selectBenchMembers(interaction);
        return;
      case "staff-registration-format":
        await this.publishRegistrationPanel(interaction, formatFromValue(interaction.values[0] ?? ""));
        return;
      case "score-match":
        await this.selectScoreMatch(interaction);
        return;
      default:
        await safeReply(interaction, { content: "Menu expiré.", ephemeral: true });
    }
  }

  public async handleModal(interaction: ModalSubmitInteraction): Promise<void> {
    const [action, id] = interaction.customId.split(":");
    switch (action) {
      case "team-create-modal":
        await this.receiveTeamDetails(interaction);
        return;
      case "score-modal":
        await this.receiveScore(interaction, id);
        return;
      case "dispute-resolve-modal":
        await this.resolveDispute(interaction, id);
        return;
      default:
        await safeReply(interaction, { content: "Formulaire expiré.", ephemeral: true });
    }
  }

  private async receiveTeamDetails(interaction: ModalSubmitInteraction): Promise<void> {
    if (!interaction.guild) return safeReply(interaction, { content: "Cette action doit être faite sur un serveur.", ephemeral: true });
    const name = interaction.fields.getTextInputValue("team-name").trim();
    const tag = interaction.fields.getTextInputValue("team-tag").trim().toUpperCase();
    if (!/^[\p{L}\p{N} _-]{2,32}$/u.test(name) || !/^[A-Z0-9_-]{2,8}$/.test(tag)) {
      await safeReply(interaction, { content: "Nom : 2–32 caractères. Tag : 2–8 lettres/chiffres.", ephemeral: true });
      return;
    }
    this.pendingTeams.set(flowKey(interaction.guild.id, interaction.user.id), {
      guildId: interaction.guild.id,
      ownerId: interaction.user.id,
      name,
      tag,
      memberIds: [interaction.user.id],
    });
    await interaction.reply({
      content: "Étape 2/3 — sélectionne les joueurs. Le créateur est ajouté automatiquement.",
      components: [
        new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
          new UserSelectMenuBuilder()
            .setCustomId("team-create-members")
            .setPlaceholder("Sélectionner les joueurs de la team")
            .setMinValues(0)
            .setMaxValues(25),
        ),
      ],
      ephemeral: true,
    });
  }

  private async selectTeamMembers(interaction: UserSelectMenuInteraction): Promise<void> {
    const pending = this.pendingTeams.get(flowKey(interaction.guildId ?? "", interaction.user.id));
    if (!pending) return safeReply(interaction, { content: "Création expirée, recommence avec /cree-ma-team.", ephemeral: true });
    pending.memberIds = [...new Set([pending.ownerId, ...interaction.values])];
    await interaction.reply({
      content: `Étape 3/3 — ${pending.memberIds.length} joueur(s) sélectionné(s). Désigne le capitaine.`,
      components: [
        new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
          new UserSelectMenuBuilder()
            .setCustomId("team-create-captain")
            .setPlaceholder("Désigner le capitaine/responsable")
            .setMinValues(1)
            .setMaxValues(1),
        ),
      ],
      ephemeral: true,
    });
  }

  private async selectTeamCaptain(interaction: UserSelectMenuInteraction): Promise<void> {
    const pending = this.pendingTeams.get(flowKey(interaction.guildId ?? "", interaction.user.id));
    const captainId = interaction.values[0];
    if (!pending || !captainId || !pending.memberIds.includes(captainId)) {
      await safeReply(interaction, { content: "Le capitaine doit être un joueur sélectionné.", ephemeral: true });
      return;
    }
    pending.captainId = captainId;
    await interaction.reply({
      content: `Récapitulatif : **${pending.name}** [${pending.tag}] — ${pending.memberIds.length} joueur(s), capitaine <@${captainId}>.`,
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          button("team-create-confirm", "🏆 Confirmer la création", ButtonStyle.Success),
          button("staff-cancel", "Annuler", ButtonStyle.Secondary),
        ),
      ],
      ephemeral: true,
    });
  }

  private async createTeam(interaction: ButtonInteraction): Promise<void> {
    const guild = interaction.guild;
    const pending = guild ? this.pendingTeams.get(flowKey(guild.id, interaction.user.id)) : undefined;
    if (!guild || !pending || !pending.captainId) {
      await safeReply(interaction, { content: "Création expirée, recommence avec /cree-ma-team.", ephemeral: true });
      return;
    }
    const state = this.store.getGuild(guild.id);
    if (Object.values(state.teams).some((team) => team.memberIds.includes(interaction.user.id))) {
      await safeReply(interaction, { content: "Tu appartiens déjà à une team.", ephemeral: true });
      return;
    }
    if (Object.values(state.teams).some((team) => team.tag === pending.tag)) {
      await safeReply(interaction, { content: "Ce tag est déjà utilisé sur ce serveur.", ephemeral: true });
      return;
    }

    await interaction.deferUpdate();
    let roleId: string | undefined;
    let categoryId: string | undefined;
    let createdTeamId: string | undefined;
    try {
      const role = await guild.roles.create({ name: `${pending.name} | ${pending.tag}`, reason: "Création de team tournoi" });
      roleId = role.id;
      const overwrites = teamOverwrites(guild, role.id, this.config);
      const category = await guild.channels.create({
        name: `📁 TEAM | ${pending.tag}`,
        type: ChannelType.GuildCategory,
        permissionOverwrites: overwrites,
        reason: "Catégorie privée de team tournoi",
      });
      categoryId = category.id;
      const teamChannel = await guild.channels.create({
        name: "💬・ma-team",
        type: ChannelType.GuildText,
        parent: category.id,
        permissionOverwrites: overwrites,
      });
      const checkinChannel = await guild.channels.create({
        name: "🔔・check-in",
        type: ChannelType.GuildText,
        parent: category.id,
        permissionOverwrites: overwrites,
      });
      const tournamentChannel = await guild.channels.create({
        name: "🏆・tournoi",
        type: ChannelType.GuildText,
        parent: category.id,
        permissionOverwrites: overwrites,
      });
      const team: Team = {
        id: `team-${guild.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        guildId: guild.id,
        name: pending.name,
        tag: pending.tag,
        captainId: pending.captainId,
        memberIds: pending.memberIds,
        roleId,
        categoryId,
        baseChannelIds: { team: teamChannel.id, checkin: checkinChannel.id, tournament: tournamentChannel.id },
        voiceChannelIds: [],
        createdAt: new Date().toISOString(),
      };
      createdTeamId = team.id;
      await this.store.mutateGuild(guild.id, (current) => {
        current.teams[team.id] = team;
      });
      await Promise.all(pending.memberIds.map(async (memberId) => {
        const member = await guild.members.fetch(memberId);
        await member.roles.add(role.id, "Ajout automatique à la team");
      }));
      await teamChannel.send(teamManagementPanel(team));
      await checkinChannel.send(checkInPanel(team, this.store.getGuild(guild.id)));
      await tournamentChannel.send(tournamentInfoPanel());
      this.pendingTeams.delete(flowKey(guild.id, interaction.user.id));
      await interaction.editReply({ content: `Team **${team.name}** [${team.tag}] créée avec ses 3 salons de base.`, components: [] });
    } catch (error) {
      this.logger.error({ err: error, guildId: guild.id }, "Unable to create team resources");
      if (createdTeamId) {
        await this.store.mutateGuild(guild.id, (current) => {
          delete current.teams[createdTeamId!];
          delete current.registrations[createdTeamId!];
        });
      }
      if (categoryId) await guild.channels.delete(categoryId, "Nettoyage après échec de création").catch(() => undefined);
      if (roleId) await guild.roles.delete(roleId, "Nettoyage après échec de création").catch(() => undefined);
      await interaction.editReply({ content: "Impossible de créer toutes les ressources Discord. Vérifie les permissions du bot.", components: [] });
    }
  }

  private async showCaptainPicker(interaction: ButtonInteraction, kind: string): Promise<void> {
    await safeReply(interaction, {
      content: kind === "team-create" ? "Sélectionne le capitaine parmi les joueurs ajoutés." : "Sélectionne le capitaine.",
      components: [
        new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
          new UserSelectMenuBuilder().setCustomId("team-create-captain").setPlaceholder("Choisir le capitaine").setMinValues(1).setMaxValues(1),
        ),
      ],
      ephemeral: true,
    });
  }

  private async openMyTeamManagement(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.guild) return safeReply(interaction, { content: "Serveur introuvable.", ephemeral: true });
    const team = Object.values(this.store.getGuild(interaction.guild.id).teams).find((candidate) => candidate.memberIds.includes(interaction.user.id));
    if (!team) return safeReply(interaction, { content: "Tu n’appartiens à aucune team.", ephemeral: true });
    await safeReply(interaction, { content: "Voici le panel de ta team. Les actions sensibles revérifient le capitaine à chaque clic.", ...teamManagementPanel(team), ephemeral: true });
  }

  private async openMyTeamDeletion(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.guild) return safeReply(interaction, { content: "Serveur introuvable.", ephemeral: true });
    const team = Object.values(this.store.getGuild(interaction.guild.id).teams).find((candidate) => candidate.memberIds.includes(interaction.user.id));
    if (!team) return safeReply(interaction, { content: "Tu n’appartiens à aucune team.", ephemeral: true });
    await this.confirmTeamDeletion(interaction, team.id);
  }

  private async showMemberPicker(interaction: ButtonInteraction, teamId: string | undefined, customId: string): Promise<void> {
    if (!teamId || !interaction.guild) return safeReply(interaction, { content: "Team introuvable.", ephemeral: true });
    const team = this.store.getGuild(interaction.guild.id).teams[teamId];
    if (!team || !canManageTeam(interaction, team, this.config)) {
      return safeReply(interaction, { content: "Seul le capitaine ou le Staff peut gérer cette team.", ephemeral: true });
    }
    await safeReply(interaction, {
      content: "Sélectionne jusqu’à 25 membres par ajout. Il n’y a pas de limite globale de membres.",
      components: [
        new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
          new UserSelectMenuBuilder().setCustomId(`${customId}:${teamId}`).setPlaceholder("Ajouter des membres").setMinValues(1).setMaxValues(25),
        ),
      ],
      ephemeral: true,
    });
  }

  private async addMembers(interaction: UserSelectMenuInteraction, teamId: string | undefined): Promise<void> {
    if (!interaction.guild || !teamId) return safeReply(interaction, { content: "Team introuvable.", ephemeral: true });
    const discordGuild = interaction.guild;
    const current = this.store.getGuild(discordGuild.id).teams[teamId];
    if (!current || !canManageTeam(interaction, current, this.config)) return safeReply(interaction, { content: "Permission refusée.", ephemeral: true });
    const accepted = interaction.values.filter((memberId) => !Object.values(this.store.getGuild(discordGuild.id).teams).some((team) => team.id !== teamId && team.memberIds.includes(memberId)));
    await this.store.mutateGuild(discordGuild.id, (guild) => {
      const team = guild.teams[teamId];
      if (team) team.memberIds = [...new Set([...team.memberIds, ...accepted])];
    });
    await Promise.all(accepted.map(async (memberId) => discordGuild.members.fetch(memberId).then((member) => member.roles.add(current.roleId, "Ajout à la team"))));
    await safeReply(interaction, { content: `${accepted.length} membre(s) ajouté(s).`, ephemeral: true });
  }

  private async createVoice(interaction: ButtonInteraction, teamId: string | undefined): Promise<void> {
    if (!interaction.guild || !teamId) return safeReply(interaction, { content: "Team introuvable.", ephemeral: true });
    const team = this.store.getGuild(interaction.guild.id).teams[teamId];
    if (!team || !canManageTeam(interaction, team, this.config)) return safeReply(interaction, { content: "Permission refusée.", ephemeral: true });
    const voice = await interaction.guild.channels.create({
      name: `🔊・${team.tag}-vocal-${team.voiceChannelIds.length + 1}`,
      type: ChannelType.GuildVoice,
      parent: team.categoryId,
      permissionOverwrites: teamOverwrites(interaction.guild, team.roleId, this.config, true),
    });
    await this.store.mutateGuild(interaction.guild.id, (guild) => {
      guild.teams[teamId]?.voiceChannelIds.push(voice.id);
    });
    await safeReply(interaction, { content: `Vocal ${voice} créé dans la catégorie de la team.`, ephemeral: true });
  }

  private async confirmTeamDeletion(interaction: ButtonInteraction, teamId: string | undefined): Promise<void> {
    if (!interaction.guild || !teamId) return safeReply(interaction, { content: "Team introuvable.", ephemeral: true });
    const team = this.store.getGuild(interaction.guild.id).teams[teamId];
    if (!team || !isCaptain(interaction, team) && !isStaff(interaction, this.config)) return safeReply(interaction, { content: "Suppression réservée au capitaine ou au Staff.", ephemeral: true });
    await safeReply(interaction, {
      content: `Supprimer **${team.name}** et tous ses salons/rôle ? Cette action nettoie aussi les inscriptions.`,
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(button(`team-delete-confirm:${teamId}`, "🗑️ Confirmer", ButtonStyle.Danger), button("staff-cancel", "Annuler", ButtonStyle.Secondary))],
      ephemeral: true,
    });
  }

  private async deleteTeam(interaction: ButtonInteraction, teamId: string | undefined): Promise<void> {
    if (!interaction.guild || !teamId) return safeReply(interaction, { content: "Team introuvable.", ephemeral: true });
    const team = this.store.getGuild(interaction.guild.id).teams[teamId];
    if (!team || !isCaptain(interaction, team) && !isStaff(interaction, this.config)) return safeReply(interaction, { content: "Permission refusée.", ephemeral: true });
    await interaction.deferUpdate();
    const category = interaction.guild.channels.cache.get(team.categoryId);
    if (category) await category.delete("Suppression de team tournoi").catch(() => undefined);
    else {
      for (const channelId of [...Object.values(team.baseChannelIds), ...team.voiceChannelIds]) {
        await interaction.guild.channels.delete(channelId, "Nettoyage de team tournoi").catch(() => undefined);
      }
    }
    await interaction.guild.roles.delete(team.roleId, "Suppression de team tournoi").catch(() => undefined);
    await this.store.mutateGuild(interaction.guild.id, (guild) => {
      delete guild.teams[teamId];
      delete guild.registrations[teamId];
      Object.values(guild.disputes).forEach((dispute) => {
        if (guild.matches[dispute.matchId]?.teamAId === teamId || guild.matches[dispute.matchId]?.teamBId === teamId) delete guild.disputes[dispute.id];
      });
    });
    await interaction.editReply({ content: "Team, salons, vocaux, rôle et données liés supprimés.", components: [] });
  }

  private async confirmPresence(interaction: ButtonInteraction, all: boolean): Promise<void> {
    if (!interaction.guild) return safeReply(interaction, { content: "Serveur introuvable.", ephemeral: true });
    const guild = this.store.getGuild(interaction.guild.id);
    const team = Object.values(guild.teams).find((candidate) => candidate.memberIds.includes(interaction.user.id));
    const registration = team ? registrationsForTeam(guild, team.id) : undefined;
    if (!team || !registration || guild.status !== "checkin" || !guild.checkInOpen) return safeReply(interaction, { content: "Le check-in n’est pas ouvert pour ta team.", ephemeral: true });
    if (all && !isCaptain(interaction, team) && !isStaff(interaction, this.config)) return safeReply(interaction, { content: "Seul le capitaine peut confirmer toute la team.", ephemeral: true });
    await this.store.mutateGuild(interaction.guild.id, (current) => {
      const target = current.registrations[registration.id];
      if (!target) return;
      const ids = all ? target.playerIds : [interaction.user.id];
      ids.forEach((id) => { target.checkIn[id] = true; });
    });
    await interaction.update(checkInPanel(team, this.store.getGuild(interaction.guild.id)));
  }

  private async startRegistration(interaction: ButtonInteraction, format: Format | null): Promise<void> {
    if (!interaction.guild || !format) return safeReply(interaction, { content: "Format invalide.", ephemeral: true });
    const teams = Object.values(this.store.getGuild(interaction.guild.id).teams).filter((team) => team.captainId === interaction.user.id);
    if (teams.length === 0) return safeReply(interaction, { content: "Tu dois être capitaine d’une team pour l’inscrire.", ephemeral: true });
    this.pendingRegistrations.set(flowKey(interaction.guild.id, interaction.user.id), { guildId: interaction.guild.id, ownerId: interaction.user.id, format });
    await safeReply(interaction, { content: `Format **${FORMAT_LABELS[format]}** — sélectionne la team.`, components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId("registration-team").setPlaceholder("Sélectionner la team").addOptions(teams.map((team) => ({ label: `${team.name} [${team.tag}]`, value: team.id }))))], ephemeral: true });
  }

  private async selectRegistrationTeam(interaction: StringSelectMenuInteraction): Promise<void> {
    const pending = this.pendingRegistrations.get(flowKey(interaction.guildId ?? "", interaction.user.id));
    const teamId = interaction.values[0];
    const guild = interaction.guild;
    const team = guild ? this.store.getGuild(guild.id).teams[teamId] : undefined;
    if (!pending || !guild || !team || team.captainId !== interaction.user.id) return safeReply(interaction, { content: "Sélection expirée ou team non autorisée.", ephemeral: true });
    pending.teamId = teamId;
    const options = await this.registrationMemberOptions(guild, team.memberIds);
    if (options.length < pending.format) return safeReply(interaction, { content: `Cette team doit avoir au moins ${pending.format} membres disponibles pour créer une squad ${FORMAT_LABELS[pending.format]}.`, ephemeral: true });
    await interaction.reply({ content: `Crée la Squad 1 en sélectionnant exactement ${pending.format} joueurs de ta team.`, components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId("registration-members").setPlaceholder(`Joueurs de la Squad 1 (${FORMAT_LABELS[pending.format]})`).setMinValues(pending.format).setMaxValues(pending.format).addOptions(options))], ephemeral: true });
  }

  private async registrationMemberOptions(guild: Guild, memberIds: string[]) {
    const members = await Promise.all(memberIds.map((memberId) => guild.members.fetch(memberId).catch(() => undefined)));
    return members
      .filter((member): member is NonNullable<typeof member> => Boolean(member))
      .slice(0, 25)
      .map((member) => ({ label: member.displayName.slice(0, 100), value: member.id, description: "Membre de ta team" }));
  }

  private async selectRegistrationMembers(interaction: UserSelectMenuInteraction | StringSelectMenuInteraction): Promise<void> {
    const pending = this.pendingRegistrations.get(flowKey(interaction.guildId ?? "", interaction.user.id));
    const team = pending?.teamId && interaction.guild ? this.store.getGuild(interaction.guild.id).teams[pending.teamId] : undefined;
    const selected = [...new Set(interaction.values)];
    if (!pending || !team || selected.length !== pending.format || selected.some((id) => !team.memberIds.includes(id))) {
      return safeReply(interaction, { content: `Une squad doit contenir exactement ${pending?.format ?? "le nombre prévu"} joueurs de cette team.`, ephemeral: true });
    }
    pending.squads = [selected];
    pending.playerIds = selected;
    pending.benchIds = [];
    await this.replySquadBuilder(interaction, pending, team);
  }

  private async selectAdditionalSquadMembers(interaction: StringSelectMenuInteraction): Promise<void> {
    const pending = this.pendingRegistrations.get(flowKey(interaction.guildId ?? "", interaction.user.id));
    const team = pending?.teamId && interaction.guild ? this.store.getGuild(interaction.guild.id).teams[pending.teamId] : undefined;
    const selected = [...new Set(interaction.values)];
    const used = new Set(pending?.squads?.flat() ?? []);
    if (!pending || !team || selected.length !== pending.format || selected.some((id) => !team.memberIds.includes(id) || used.has(id))) {
      return safeReply(interaction, { content: `Cette squad doit contenir exactement ${pending?.format ?? "le nombre prévu"} nouveaux joueurs de ta team.`, ephemeral: true });
    }
    pending.squads = [...(pending.squads ?? []), selected];
    pending.playerIds = pending.squads.flat();
    await this.replySquadBuilder(interaction, pending, team);
  }

  private async showAdditionalSquadPicker(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.guild) return safeReply(interaction, { content: "Serveur introuvable.", ephemeral: true });
    const pending = this.pendingRegistrations.get(flowKey(interaction.guild.id, interaction.user.id));
    const team = pending?.teamId ? this.store.getGuild(interaction.guild.id).teams[pending.teamId] : undefined;
    if (!pending || !team || !pending.squads?.length) return safeReply(interaction, { content: "Inscription expirée, recommence.", ephemeral: true });
    const used = new Set(pending.squads.flat());
    const options = await this.registrationMemberOptions(interaction.guild, team.memberIds.filter((id) => !used.has(id)));
    if (options.length < pending.format) return safeReply(interaction, { content: "Il n’y a pas assez de nouveaux joueurs disponibles pour créer une squad complète.", ephemeral: true });
    await safeReply(interaction, {
      content: `Sélectionne exactement ${pending.format} joueurs pour la Squad ${(pending.squads.length + 1)}.`,
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId("registration-squad-members").setPlaceholder(`Joueurs de la Squad ${pending.squads.length + 1}`).setMinValues(pending.format).setMaxValues(pending.format).addOptions(options))],
      ephemeral: true,
    });
  }

  private async replySquadBuilder(interaction: UserSelectMenuInteraction | StringSelectMenuInteraction, pending: PendingRegistrationFlow, team: Team): Promise<void> {
    const squads = pending.squads ?? [];
    await safeReply(interaction, {
      content: registrationSquadBuilderSummary(team, pending.format, squads),
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
        button("registration-squad-add", "➕ Ajouter une squad", ButtonStyle.Primary),
        button("registration-squad-finish", "✅ Finir les squads", ButtonStyle.Success),
      )],
      ephemeral: true,
    });
  }

  private async showBenchPicker(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.guild) return safeReply(interaction, { content: "Serveur introuvable.", ephemeral: true });
    const pending = this.pendingRegistrations.get(flowKey(interaction.guild.id, interaction.user.id));
    const team = pending?.teamId ? this.store.getGuild(interaction.guild.id).teams[pending.teamId] : undefined;
    if (!pending || !team || !pending.squads?.length) return safeReply(interaction, { content: "Inscription expirée, recommence.", ephemeral: true });
    const activeIds = new Set(pending.squads.flat());
    const options = await this.registrationMemberOptions(interaction.guild, team.memberIds.filter((id) => !activeIds.has(id)));
    if (!options.length) {
      pending.benchIds = [];
      return this.showRegistrationCaptainPicker(interaction);
    }
    await safeReply(interaction, {
      content: "Sélectionne les remplaçants parmi les membres restants, ou passe cette étape.",
      components: [
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId("registration-bench-members").setPlaceholder("Choisir les remplaçants").setMinValues(1).setMaxValues(options.length).addOptions(options)),
        new ActionRowBuilder<ButtonBuilder>().addComponents(button("registration-no-bench", "Aucun remplaçant", ButtonStyle.Secondary)),
      ],
      ephemeral: true,
    });
  }

  private async selectBenchMembers(interaction: StringSelectMenuInteraction): Promise<void> {
    const pending = this.pendingRegistrations.get(flowKey(interaction.guildId ?? "", interaction.user.id));
    const team = pending?.teamId && interaction.guild ? this.store.getGuild(interaction.guild.id).teams[pending.teamId] : undefined;
    const activeIds = new Set(pending?.squads?.flat() ?? []);
    if (!pending || !team || interaction.values.some((id) => !team.memberIds.includes(id) || activeIds.has(id))) {
      return safeReply(interaction, { content: "Les remplaçants doivent être des membres non titulaires de cette team.", ephemeral: true });
    }
    pending.benchIds = [...new Set(interaction.values)];
    pending.playerIds = [...activeIds, ...pending.benchIds];
    await this.showRegistrationCaptainPicker(interaction);
  }

  private async showRegistrationCaptainPicker(interaction: ButtonInteraction | StringSelectMenuInteraction): Promise<void> {
    if (!interaction.guild) return safeReply(interaction, { content: "Serveur introuvable.", ephemeral: true });
    const pending = this.pendingRegistrations.get(flowKey(interaction.guild.id, interaction.user.id));
    const activeIds = pending?.squads?.flat() ?? [];
    if (!pending || !activeIds.length) return safeReply(interaction, { content: "Inscription expirée, recommence.", ephemeral: true });
    pending.playerIds = [...activeIds, ...(pending.benchIds ?? [])];
    const options = await this.registrationMemberOptions(interaction.guild, activeIds);
    await safeReply(interaction, {
      content: "Sélectionne le capitaine de l’inscription parmi les joueurs titulaires.",
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId("registration-captain").setPlaceholder("Capitaine").setMinValues(1).setMaxValues(1).addOptions(options))],
      ephemeral: true,
    });
  }

  private async selectRegistrationCaptain(interaction: StringSelectMenuInteraction): Promise<void> {
    const pending = this.pendingRegistrations.get(flowKey(interaction.guildId ?? "", interaction.user.id));
    const captainId = interaction.values[0];
    const activeIds = pending?.squads?.flat() ?? [];
    if (!pending || !pending.teamId || !activeIds.includes(captainId)) return safeReply(interaction, { content: "Le capitaine doit être un joueur titulaire de l’inscription.", ephemeral: true });
    pending.captainId = captainId;
    const format = pending.format;
    const squads = pending.squads ?? [];
    const bench = pending.benchIds ?? [];
    const team = interaction.guild ? this.store.getGuild(interaction.guild.id).teams[pending.teamId] : undefined;
    if (!team) return safeReply(interaction, { content: "Team introuvable, recommence l’inscription.", ephemeral: true });
    await interaction.reply({ content: registrationSummary(format, team, captainId, squads, bench), components: [new ActionRowBuilder<ButtonBuilder>().addComponents(button("registration-confirm", "✅ Confirmer l’inscription", ButtonStyle.Success), button("staff-cancel", "Annuler", ButtonStyle.Secondary))], ephemeral: true });
  }

  private async confirmRegistration(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.guild) return safeReply(interaction, { content: "Serveur introuvable.", ephemeral: true });
    const key = flowKey(interaction.guild.id, interaction.user.id);
    const pending = this.pendingRegistrations.get(key);
    if (!pending?.teamId || !pending.captainId || !pending.squads?.length) return safeReply(interaction, { content: "Inscription expirée.", ephemeral: true });
    const team = this.store.getGuild(interaction.guild.id).teams[pending.teamId];
    if (!team || team.captainId !== interaction.user.id) return safeReply(interaction, { content: "Seul le capitaine peut confirmer.", ephemeral: true });
    if (this.store.getGuild(interaction.guild.id).status === "live" || this.store.getGuild(interaction.guild.id).status === "finished") return safeReply(interaction, { content: "Le tournoi ne prend plus d’inscriptions.", ephemeral: true });
    const squads = pending.squads;
    const bench = [...new Set(pending.benchIds ?? [])];
    const activePlayers = squads.flat();
    const playerIds = [...new Set([...activePlayers, ...bench])];
    const activeSet = new Set(activePlayers);
    if (squads.some((squad) => squad.length !== pending.format) || activePlayers.length !== new Set(activePlayers).size || bench.some((id) => activeSet.has(id)) || playerIds.some((id) => !team.memberIds.includes(id)) || !activeSet.has(pending.captainId)) {
      return safeReply(interaction, { content: "Les squads ou les remplaçants ne sont pas valides. Recommence l’inscription.", ephemeral: true });
    }
    const registration: Registration = { id: pending.teamId, teamId: pending.teamId, format: pending.format, captainId: pending.captainId, playerIds, squads, benchIds: bench, checkIn: Object.fromEntries(playerIds.map((id) => [id, false])), status: "registered", createdAt: new Date().toISOString() };
    await this.store.mutateGuild(interaction.guild.id, (guild) => { guild.registrations[registration.id] = registration; });
    this.pendingRegistrations.delete(key);
    await safeReply(interaction, { content: `Inscription confirmée pour **${team.name}** [${team.tag}] en ${FORMAT_LABELS[pending.format]}.`, components: [] });
  }

  private async startCheckIn(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.guild || !isStaff(interaction, this.config)) return safeReply(interaction, { content: "Permission Staff requise.", ephemeral: true });
    const state = this.store.getGuild(interaction.guild.id);
    if (state.status === "live" || state.status === "paused" || state.status === "finished") return safeReply(interaction, { content: "Le check-in ne peut pas être rouvert à ce stade du tournoi.", ephemeral: true });
    await this.store.mutateGuild(interaction.guild.id, (guild) => { guild.status = "checkin"; guild.checkInOpen = true; guild.checkInClosedAt = undefined; });
    await safeReply(interaction, { content: "🔔 Check-in ouvert pour les teams inscrites.", ephemeral: true });
  }

  private async closeCheckIn(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.guild || !isStaff(interaction, this.config)) return safeReply(interaction, { content: "Permission Staff requise.", ephemeral: true });
    await this.store.mutateGuild(interaction.guild.id, (guild) => { guild.checkInOpen = false; guild.checkInClosedAt = new Date().toISOString(); });
    const guild = this.store.getGuild(interaction.guild.id);
    const lines = Object.values(guild.registrations).map((registration) => {
      const team = guild.teams[registration.teamId];
      const complete = registrationIsComplete(registration).valid;
      return `${complete ? "✅" : "❌"} ${team?.name ?? registration.teamId} [${team?.tag ?? "?"}] — ${registration.playerIds.filter((id) => registration.checkIn[id]).length}/${registration.playerIds.length}`;
    });
    await safeReply(interaction, { content: `⏹️ Check-in fermé.\n${lines.join("\n") || "Aucune inscription."}`, ephemeral: true });
  }

  private async draw(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.guild || !isStaff(interaction, this.config)) return safeReply(interaction, { content: "Permission Staff requise.", ephemeral: true });
    if (this.store.getGuild(interaction.guild.id).checkInOpen) return safeReply(interaction, { content: "Ferme d’abord le check-in avant le tirage.", ephemeral: true });
    let count = 0;
    await this.store.mutateGuild(interaction.guild.id, (guild) => {
      count = 0;
      for (const registration of Object.values(guild.registrations)) {
        const check = registrationIsComplete(registration);
        if (!check.valid) { registration.status = "excluded"; registration.excludedReason = check.reason; }
        else { registration.status = "registered"; count += 1; }
      }
      if (count < 2) return;
      createBracket(guild, Object.values(guild.registrations).filter((registration) => registration.status === "registered").map((registration) => registration.teamId));
      guild.checkInOpen = false;
    });
    if (count < 2) return safeReply(interaction, { content: `Tirage impossible : ${count} team(s) valide(s), 2 minimum.`, ephemeral: true });
    await safeReply(interaction, { content: `🎲 Tirage effectué : ${count} teams valides, bracket généré. Le tournoi n’est pas encore lancé.`, ephemeral: true });
  }

  private async replyRegistrations(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.guild || !isStaff(interaction, this.config)) return safeReply(interaction, { content: "Permission Staff requise.", ephemeral: true });
    const guild = this.store.getGuild(interaction.guild.id);
    const lines = Object.values(guild.registrations).map((registration) => {
      const team = guild.teams[registration.teamId];
      const checkin = registration.playerIds.filter((id) => registration.checkIn[id]).length;
      return `**${team?.name ?? "?"}** [${team?.tag ?? "?"}] · ${FORMAT_LABELS[registration.format]} · Capitaine <@${registration.captainId}> · ${checkin}/${registration.playerIds.length} présents\nSquads : ${registration.squads.map((squad, index) => `S${index + 1} (${squad.length})`).join(", ")}`;
    });
    await safeReply(interaction, { content: lines.join("\n\n") || "Aucune inscription.", ephemeral: true });
  }

  private async sendStaffRegistrationFormatPicker(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.guild || !isStaff(interaction, this.config)) return safeReply(interaction, { content: "Permission Staff requise.", ephemeral: true });
    await safeReply(interaction, {
      content: "Choisis le format du salon d’inscription à publier. Les autres panels restent inchangés.",
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          button("staff-format:4", "4️⃣ Publier 4v4", ButtonStyle.Primary),
          button("staff-format:5", "5️⃣ Publier 5v5", ButtonStyle.Primary),
          button("staff-format:6", "6️⃣ Publier 6v6", ButtonStyle.Primary),
        ),
      ],
      ephemeral: true,
    });
  }

  private async publishRegistrationPanel(
    interaction: ButtonInteraction | StringSelectMenuInteraction,
    format: Format | null,
  ): Promise<void> {
    if (!interaction.guild || !isStaff(interaction, this.config) || !format) {
      return safeReply(interaction, { content: "Format invalide ou permission Staff requise.", ephemeral: true });
    }

    const channelName = registrationChannelName(format);
    let channel = interaction.guild.channels.cache.find(
      (candidate) => candidate.type === ChannelType.GuildText && candidate.name === channelName,
    ) as TextChannel | undefined;

    if (!channel) {
      channel = await interaction.guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        reason: `Publication du panel d’inscription ${FORMAT_LABELS[format]}`,
      }).catch(() => undefined);
    }

    if (!channel) {
      return safeReply(interaction, { content: "Impossible de créer le salon d’inscription. Vérifie les permissions du bot.", ephemeral: true });
    }

    await channel.send({
      content: `Panel Staff publié pour le format **${FORMAT_LABELS[format]}**.`,
      ...registrationPanel(format),
    });
    await safeReply(interaction, {
      content: `Panel **${FORMAT_LABELS[format]}** publié dans <#${channel.id}>. Les panels des autres formats n’ont pas été modifiés.`,
      ephemeral: true,
    });
  }

  private async confirmLaunch(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.guild || !isStaff(interaction, this.config)) return safeReply(interaction, { content: "Permission Staff requise.", ephemeral: true });
    await safeReply(interaction, { content: "Le tirage existe déjà. Lancer officiellement le tournoi maintenant ?", components: [new ActionRowBuilder<ButtonBuilder>().addComponents(button("staff-launch-confirm", "▶️ Confirmer le lancement", ButtonStyle.Success), button("staff-cancel", "Annuler", ButtonStyle.Secondary))], ephemeral: true });
  }

  private async launch(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.guild || !isStaff(interaction, this.config)) return safeReply(interaction, { content: "Permission Staff requise.", ephemeral: true });
    await this.store.mutateGuild(interaction.guild.id, (guild) => { if (Object.keys(guild.matches).length > 0) { guild.status = "live"; activateAvailableMatches(guild); } });
    const guild = this.store.getGuild(interaction.guild.id);
    if (guild.status !== "live") return safeReply(interaction, { content: "Impossible de lancer : effectue d’abord un tirage valide.", ephemeral: true });
    await this.notifyParticipants(interaction.guild, guild);
    await safeReply(interaction, { content: "🟢 TOURNOI EN COURS — les matchs actifs acceptent maintenant les scores.", ephemeral: true });
  }

  private async pause(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.guild || !isStaff(interaction, this.config)) return safeReply(interaction, { content: "Permission Staff requise.", ephemeral: true });
    await this.store.mutateGuild(interaction.guild.id, (guild) => { if (guild.status === "live") guild.status = "paused"; });
    await safeReply(interaction, { content: "🟡 TOURNOI EN PAUSE — les actions de match sont suspendues.", ephemeral: true });
  }

  private async resume(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.guild || !isStaff(interaction, this.config)) return safeReply(interaction, { content: "Permission Staff requise.", ephemeral: true });
    await this.store.mutateGuild(interaction.guild.id, (guild) => { if (guild.status === "paused") { guild.status = "live"; activateAvailableMatches(guild); } });
    await safeReply(interaction, { content: "🟢 TOURNOI REPRIS.", ephemeral: true });
  }

  private async confirmFinish(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.guild || !isStaff(interaction, this.config)) return safeReply(interaction, { content: "Permission Staff requise.", ephemeral: true });
    await safeReply(interaction, { content: "Terminer le tournoi et figer le classement final ?", components: [new ActionRowBuilder<ButtonBuilder>().addComponents(button("staff-finish-confirm", "⏹️ Confirmer la fin", ButtonStyle.Danger), button("staff-cancel", "Annuler", ButtonStyle.Secondary))], ephemeral: true });
  }

  private async finish(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.guild || !isStaff(interaction, this.config)) return safeReply(interaction, { content: "Permission Staff requise.", ephemeral: true });
    if (Object.keys(this.store.getGuild(interaction.guild.id).matches).length === 0) {
      return safeReply(interaction, { content: "Aucun tournoi à terminer : le bracket n’a pas encore été généré.", ephemeral: true });
    }
    let ranking: string[] = [];
    await this.store.mutateGuild(interaction.guild.id, (guild) => { guild.status = "finished"; ranking = calculateRanking(guild); guild.finalRanking = ranking; guild.winnerId = ranking[0]; });
    await safeReply(interaction, { content: `🔴 TOURNOI TERMINÉ.\nClassement sauvegardé : ${ranking.map((id, index) => `${index + 1}. ${guildTeamName(this.store.getGuild(interaction.guild!.id), id)}`).join(" · ") || "aucun résultat"}`, ephemeral: true });
  }

  private async replyBracket(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.guild) return safeReply(interaction, { content: "Serveur introuvable.", ephemeral: true });
    const guild = this.store.getGuild(interaction.guild.id);
    await safeReply(interaction, { content: bracketText(guild), ephemeral: true });
  }

  private async replyMyMatch(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.guild) return safeReply(interaction, { content: "Serveur introuvable.", ephemeral: true });
    const guild = this.store.getGuild(interaction.guild.id);
    const team = Object.values(guild.teams).find((candidate) => candidate.memberIds.includes(interaction.user.id));
    const matches = team ? Object.values(guild.matches).filter((match) => match.teamAId === team.id || match.teamBId === team.id) : [];
    await safeReply(interaction, { content: matches.length ? matches.map((match) => matchText(guild, match)).join("\n") : "Aucun match pour ta team.", ephemeral: true });
  }

  private async showScoreMatchPicker(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.guild || (this.store.getGuild(interaction.guild.id).status !== "live")) return safeReply(interaction, { content: "Les scores sont disponibles uniquement quand le tournoi est en cours.", ephemeral: true });
    const guild = this.store.getGuild(interaction.guild.id);
    const matches = Object.values(guild.matches).filter((match) => (match.status === "active" || match.status === "awaiting-confirmation") && isCaptainOfMatch(guild, match, interaction.user.id));
    if (!matches.length) return safeReply(interaction, { content: "Tu n’as aucun match actif.", ephemeral: true });
    await safeReply(interaction, { content: "Sélectionne ton match.", components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId("score-match").setPlaceholder("Match à scorer").addOptions(matches.map((match) => ({ label: `${teamLabel(guild, match.teamAId)} vs ${teamLabel(guild, match.teamBId)}`, value: match.id }))))], ephemeral: true });
  }

  private async selectScoreMatch(interaction: StringSelectMenuInteraction): Promise<void> {
    const matchId = interaction.values[0];
    const guild = interaction.guild ? this.store.getGuild(interaction.guild.id) : undefined;
    const match = guild?.matches[matchId];
    if (!guild || !match || !isCaptainOfMatch(guild, match, interaction.user.id)) return safeReply(interaction, { content: "Match non autorisé.", ephemeral: true });
    await interaction.showModal(scoreModal(matchId, guild, match));
  }

  private async receiveScore(interaction: ModalSubmitInteraction, matchId: string | undefined): Promise<void> {
    if (!interaction.guild || !matchId) return safeReply(interaction, { content: "Match invalide.", ephemeral: true });
    const guild = this.store.getGuild(interaction.guild.id);
    const match = guild.matches[matchId];
    if (!match || !isCaptainOfMatch(guild, match, interaction.user.id) || guild.status !== "live") return safeReply(interaction, { content: "Permission refusée ou match inactif.", ephemeral: true });
    const scoreA = Number(interaction.fields.getTextInputValue("score-a"));
    const scoreB = Number(interaction.fields.getTextInputValue("score-b"));
    let result: { ok: boolean; error?: string } = { ok: false };
    await this.store.mutateGuild(interaction.guild.id, (current) => { const target = current.matches[matchId]; if (target) result = submitScore(target, scoreA, scoreB, interaction.user.id); });
    if (!result.ok) return safeReply(interaction, { content: result.error ?? "Score invalide.", ephemeral: true });
    const updated = this.store.getGuild(interaction.guild.id).matches[matchId];
    await this.sendScoreConfirmation(interaction.guild, this.store.getGuild(interaction.guild.id), updated);
    await safeReply(interaction, { content: "Score envoyé au capitaine adverse pour confirmation.", ephemeral: true });
  }

  private async confirmProposedScore(interaction: ButtonInteraction, matchId: string | undefined): Promise<void> {
    if (!interaction.guild || !matchId) return safeReply(interaction, { content: "Match invalide.", ephemeral: true });
    let result: { ok: boolean; error?: string } = { ok: false };
    await this.store.mutateGuild(interaction.guild.id, (guild) => { const match = guild.matches[matchId]; if (match && isCaptainOfMatch(guild, match, interaction.user.id)) result = confirmScore(guild, match, interaction.user.id); else result = { ok: false, error: "Seul le capitaine adverse peut confirmer." }; });
    if (!result.ok) return safeReply(interaction, { content: result.error ?? "Confirmation refusée.", ephemeral: true });
    const guild = this.store.getGuild(interaction.guild.id);
    if (isTournamentComplete(guild)) await this.store.mutateGuild(interaction.guild.id, (current) => { current.status = "finished"; current.finalRanking = calculateRanking(current); current.winnerId = current.finalRanking[0]; });
    await safeReply(interaction, { content: `✅ Score officiel. ${guild.status === "live" ? "Le bracket est mis à jour." : "Le tournoi est terminé."}`, ephemeral: true });
  }

  private async openDispute(interaction: ButtonInteraction, matchId: string | undefined): Promise<void> {
    if (!interaction.guild || !matchId) return safeReply(interaction, { content: "Match invalide.", ephemeral: true });
    const state = this.store.getGuild(interaction.guild.id);
    const match = state.matches[matchId];
    if (!match || match.status !== "awaiting-confirmation" || !isCaptainOfMatch(state, match, interaction.user.id) || match.proposedBy === interaction.user.id) return safeReply(interaction, { content: "Seul le capitaine adverse peut ouvrir ce litige.", ephemeral: true });
    const dispute: Dispute = { id: `dispute-${matchId}-${Date.now()}`, matchId, guildId: interaction.guild.id, openedBy: interaction.user.id, proposedScoreA: match.scoreA ?? 0, proposedScoreB: match.scoreB ?? 0, status: "open", createdAt: new Date().toISOString() };
    await this.store.mutateGuild(interaction.guild.id, (guild) => { guild.disputes[dispute.id] = dispute; guild.matches[matchId].status = "disputed"; });
    const channel = interaction.guild.channels.cache.get(state.teams[match.teamAId ?? ""]?.baseChannelIds.tournament) as TextChannel | undefined;
    if (!channel) return safeReply(interaction, { content: "Litige enregistré, mais le salon tournoi est introuvable.", ephemeral: true });
    const thread = await channel.threads.create({ name: `⚖️ litige-${matchId}`, type: ChannelType.PrivateThread, autoArchiveDuration: 10080, invitable: false, reason: "Litige de score tournoi" });
    await addAuthorizedMembers(thread, interaction.guild, this.config);
    await thread.send({ content: "⚖️ Litige réservé au Staff/Arbitres.", embeds: [new EmbedBuilder().setTitle("Litige de score").setDescription(`${matchText(state, match)}\nScore proposé : ${dispute.proposedScoreA} – ${dispute.proposedScoreB}\nOuvert par <@${interaction.user.id}>`).setColor(0xf59e0b)], components: [new ActionRowBuilder<ButtonBuilder>().addComponents(button(`dispute-call:${dispute.id}`, "📞 Appeler un arbitre", ButtonStyle.Primary), button(`dispute-resolve:${dispute.id}`, "Valider/modifier", ButtonStyle.Success))] });
    await this.store.mutateGuild(interaction.guild.id, (guild) => { guild.disputes[dispute.id].threadId = thread.id; });
    await safeReply(interaction, { content: "⚖️ Litige ouvert dans une procédure privée Staff/Arbitres.", ephemeral: true });
  }

  private async callArbiter(interaction: ButtonInteraction, disputeId: string | undefined): Promise<void> {
    if (!interaction.guild || !disputeId || !isArbiter(interaction, this.config)) return safeReply(interaction, { content: "Action réservée aux arbitres/Staff.", ephemeral: true });
    await this.store.mutateGuild(interaction.guild.id, (guild) => { if (guild.disputes[disputeId]) guild.disputes[disputeId].status = "claimed"; });
    await safeReply(interaction, { content: "📞 Litige pris en charge par un arbitre.", ephemeral: true });
  }

  private async showDisputeResolution(interaction: ButtonInteraction, disputeId: string | undefined): Promise<void> {
    if (!disputeId || !isArbiter(interaction, this.config)) return safeReply(interaction, { content: "Action réservée aux arbitres/Staff.", ephemeral: true });
    await interaction.showModal(disputeModal(disputeId));
  }

  private async resolveDispute(interaction: ModalSubmitInteraction, disputeId: string | undefined): Promise<void> {
    if (!interaction.guild || !disputeId || !isArbiter(interaction, this.config)) return safeReply(interaction, { content: "Action réservée aux arbitres/Staff.", ephemeral: true });
    const dispute = this.store.getGuild(interaction.guild.id).disputes[disputeId];
    if (!dispute) return safeReply(interaction, { content: "Litige introuvable.", ephemeral: true });
    const scoreA = Number(interaction.fields.getTextInputValue("arbiter-score-a"));
    const scoreB = Number(interaction.fields.getTextInputValue("arbiter-score-b"));
    let result: { ok: boolean; error?: string } = { ok: false };
    await this.store.mutateGuild(interaction.guild.id, (guild) => { const match = guild.matches[dispute.matchId]; if (match) result = resolveScore(guild, match, scoreA, scoreB); if (result.ok) guild.disputes[disputeId].status = "resolved"; });
    if (!result.ok) return safeReply(interaction, { content: result.error ?? "Score arbitré invalide.", ephemeral: true });
    await safeReply(interaction, { content: "✅ Litige clôturé, score officiel enregistré et bracket mis à jour.", ephemeral: true });
  }

  private async notifyParticipants(guild: Guild, state: GuildTournamentState): Promise<void> {
    for (const team of Object.values(state.teams)) {
      const registration = registrationsForTeam(state, team.id);
      if (!registration || registration.status !== "registered") continue;
      const match = Object.values(state.matches).find((candidate) => candidate.status === "active" && (candidate.teamAId === team.id || candidate.teamBId === team.id));
      const channel = guild.channels.cache.get(team.baseChannelIds.tournament) as TextChannel | undefined;
      if (channel) await channel.send({ content: "🟢 TOURNOI EN COURS", embeds: [new EmbedBuilder().setTitle("Confirmation d’inscription").setDescription(`Team **${team.name}** [${team.tag}]\nFormat : ${FORMAT_LABELS[registration.format]}\nJoueurs inscrits : ${registration.playerIds.map((id) => `<@${id}>`).join(", ")}\nPremier match : ${match ? matchText(state, match) : "en attente"}`).setColor(0x22c55e)], components: [new ActionRowBuilder<ButtonBuilder>().addComponents(button("bracket", "📊 Voir le bracket", ButtonStyle.Primary), button("my-match", "🎮 Voir mon match", ButtonStyle.Secondary))] });
    }
  }

  private async sendScoreConfirmation(guild: Guild, state: GuildTournamentState, match: Match): Promise<void> {
    const opponentId = match.teamAId && captainOf(state, match.teamAId) === match.proposedBy ? captainOf(state, match.teamBId) : captainOf(state, match.teamAId);
    if (!opponentId) return;
    const payload = { content: "⚠️ SCORE À CONFIRMER", embeds: [new EmbedBuilder().setTitle("Score à confirmer").setDescription(`${teamLabel(state, match.teamAId)} ${match.scoreA} / ${teamLabel(state, match.teamBId)} ${match.scoreB}`).setColor(0xf59e0b)], components: [new ActionRowBuilder<ButtonBuilder>().addComponents(button(`score-confirm:${match.id}`, "✅ Confirmer le score", ButtonStyle.Success), button(`score-dispute:${match.id}`, "❌ Signaler un problème", ButtonStyle.Danger))] };
    const member = await guild.members.fetch(opponentId).catch(() => undefined);
    if (member) await member.send(payload).catch(async () => {
      const team = Object.values(state.teams).find((candidate) => candidate.captainId === opponentId);
      const channel = team ? guild.channels.cache.get(team.baseChannelIds.tournament) as TextChannel | undefined : undefined;
      if (channel) await channel.send(payload);
    });
  }
}

function button(customId: string, label: string, style: ButtonStyle): ButtonBuilder {
  return new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style);
}

function teamPanel() {
  return { embeds: [new EmbedBuilder().setTitle("🏆 CRÉATION DE TEAM").setDescription("Crée une team, gère ses membres et ses ressources privées.")], components: [new ActionRowBuilder<ButtonBuilder>().addComponents(button("team-create", "🏆 Créer ma team", ButtonStyle.Success), button("team-manage", "👥 Gérer ma team", ButtonStyle.Primary), button("team-delete", "🗑️ Supprimer ma team", ButtonStyle.Danger))] };
}

function registrationPanel(format?: Format) {
  if (format) {
    return {
      embeds: [new EmbedBuilder().setTitle(`📝 INSCRIPTION AU TOURNOI — ${FORMAT_LABELS[format]}`).setDescription(`Panel dédié au **${FORMAT_LABELS[format]}**.\nUne team reste une seule équipe dans le tournoi, même avec plusieurs squads.`)],
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(button(`format:${format}`, `✅ S’inscrire en ${FORMAT_LABELS[format]}`, ButtonStyle.Primary))],
    };
  }
  return { embeds: [new EmbedBuilder().setTitle("📝 INSCRIPTION AU TOURNOI").setDescription("Une team reste une seule équipe dans le tournoi, même avec plusieurs squads.")], components: [new ActionRowBuilder<ButtonBuilder>().addComponents(button("format:4", "4️⃣ 4v4", ButtonStyle.Primary), button("format:5", "5️⃣ 5v5", ButtonStyle.Primary), button("format:6", "6️⃣ 6v6", ButtonStyle.Primary))] };
}

function staffPanel() {
  return { embeds: [new EmbedBuilder().setTitle("🏆 GESTION DU TOURNOI").setDescription("Staff/Admin autorisé uniquement. Tirage et lancement sont deux actions distinctes.")], components: [new ActionRowBuilder<ButtonBuilder>().addComponents(button("staff-registrations", "📝 Inscriptions", ButtonStyle.Secondary), button("staff-publish-registration", "📢 Publier un format", ButtonStyle.Primary), button("staff-start-checkin", "🔔 Lancer check-in", ButtonStyle.Primary), button("staff-close-checkin", "⏹️ Fermer check-in", ButtonStyle.Primary), button("staff-draw", "🎲 Lancer tirage", ButtonStyle.Danger)), new ActionRowBuilder<ButtonBuilder>().addComponents(button("staff-bracket", "📊 Bracket", ButtonStyle.Secondary), button("staff-launch", "▶️ Lancer tournoi", ButtonStyle.Success), button("staff-pause", "⏸️ Pause", ButtonStyle.Secondary), button("staff-resume", "▶️ Reprendre", ButtonStyle.Success), button("staff-finish", "⏹️ Terminer", ButtonStyle.Danger))] };
}

function scorePanel() {
  return { embeds: [new EmbedBuilder().setTitle("🎮 GESTION DU SCORE").setDescription("Les scores sont saisis par les capitaines puis confirmés par l’adversaire.")], components: [new ActionRowBuilder<ButtonBuilder>().addComponents(button("score-enter", "📝 Entrer un score", ButtonStyle.Primary), button("score-my-matches", "📋 Mes matchs", ButtonStyle.Secondary))] };
}

function teamManagementPanel(team: Team) {
  return { embeds: [new EmbedBuilder().setTitle("🏆 GESTION DE LA TEAM").setDescription(`Team **${team.name}** [${team.tag}]\nCapitaine : <@${team.captainId}>`)], components: [new ActionRowBuilder<ButtonBuilder>().addComponents(button(`team-manage-add:${team.id}`, "➕ Ajouter des membres", ButtonStyle.Primary), button(`team-manage-voice:${team.id}`, "🔊 Créer vocal", ButtonStyle.Secondary), button(`team-manage-delete:${team.id}`, "🗑️ Supprimer ma team", ButtonStyle.Danger))] };
}

function registrationChannelName(format: Format): string {
  return `📝・inscription-${format}v${format}`;
}

function checkInPanel(team: Team, state: GuildTournamentState) {
  const registration = registrationsForTeam(state, team.id);
  const status = registration ? registration.playerIds.map((id) => `${registration.checkIn[id] ? "✅ Présent" : "❌ Non confirmé"} <@${id}>`).join("\n") : "Team non inscrite.";
  return { embeds: [new EmbedBuilder().setTitle("🔔 CHECK-IN").setDescription(status)], components: [new ActionRowBuilder<ButtonBuilder>().addComponents(button("checkin-self", "✅ Confirmer ma présence", ButtonStyle.Success), button("checkin-all", "👑 Confirmer toute la team", ButtonStyle.Primary))] };
}

function tournamentInfoPanel() {
  return { embeds: [new EmbedBuilder().setTitle("🏆 INFORMATIONS DU TOURNOI").setDescription("Consulte le bracket et ton match dès que le Staff a lancé le tournoi.")], components: [new ActionRowBuilder<ButtonBuilder>().addComponents(button("bracket", "📊 Voir le bracket", ButtonStyle.Primary), button("my-match", "🎮 Voir mon match", ButtonStyle.Secondary))] };
}

function teamCreationModal(): ModalBuilder {
  return new ModalBuilder().setCustomId("team-create-modal").setTitle("Créer ma team").addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("team-name").setLabel("Nom de la team").setStyle(TextInputStyle.Short).setMinLength(2).setMaxLength(32).setRequired(true)), new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("team-tag").setLabel("Tag (2 à 8 caractères)").setStyle(TextInputStyle.Short).setMinLength(2).setMaxLength(8).setRequired(true)));
}

function scoreModal(matchId: string, state: GuildTournamentState, match: Match): ModalBuilder {
  return new ModalBuilder().setCustomId(`score-modal:${matchId}`).setTitle("Entrer un score").addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("score-a").setLabel(`${teamLabel(state, match.teamAId)} — score`).setStyle(TextInputStyle.Short).setRequired(true)), new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("score-b").setLabel(`${teamLabel(state, match.teamBId)} — score`).setStyle(TextInputStyle.Short).setRequired(true)));
}

function disputeModal(disputeId: string): ModalBuilder {
  return new ModalBuilder().setCustomId(`dispute-resolve-modal:${disputeId}`).setTitle("Résoudre le litige").addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("arbiter-score-a").setLabel("Score officiel Team A").setStyle(TextInputStyle.Short).setRequired(true)), new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("arbiter-score-b").setLabel("Score officiel Team B").setStyle(TextInputStyle.Short).setRequired(true)));
}

function teamOverwrites(guild: Guild, roleId: string, config: DiscordConfig, voice = false) {
  const allow = voice ? [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] : [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory];
  return [{ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }, { id: roleId, allow }, ...config.staffRoleIds.map((id) => ({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, ...(voice ? [PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] : [])] }))];
}

async function addAuthorizedMembers(thread: import("discord.js").ThreadChannel, guild: Guild, config: DiscordConfig): Promise<void> {
  const members = await guild.members.fetch();
  for (const member of members.values()) {
    if (member.permissions.has(PermissionFlagsBits.Administrator) || config.staffRoleIds.some((id) => member.roles.cache.has(id)) || config.arbiterRoleIds.some((id) => member.roles.cache.has(id))) {
      await thread.members.add(member.id).catch(() => undefined);
    }
  }
}

function flowKey(guildId: string, userId: string): string {
  return `${guildId}:${userId}`;
}

function chunk<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function registrationSummary(format: Format, team: Team, captainId: string, squads: string[][], bench: string[]): string {
  return `Récapitulatif — team **${team.name}** [${team.tag}], format **${FORMAT_LABELS[format]}**, capitaine <@${captainId}>.\n${squads.map((squad, index) => `Squad ${index + 1} : ${squad.map((id) => `<@${id}>`).join(", ")}`).join("\n")}\n${bench.length ? `Remplaçants : ${bench.map((id) => `<@${id}>`).join(", ")}` : "Aucun remplaçant."}`;
}

function registrationSquadBuilderSummary(team: Team, format: Format, squads: string[][]): string {
  return `Team **${team.name}** [${team.tag}] — format **${FORMAT_LABELS[format]}**\n${squads.map((squad, index) => `✅ Squad ${index + 1} : ${squad.map((id) => `<@${id}>`).join(", ")}`).join("\n")}\n\nTu peux ajouter une autre squad complète ou terminer pour choisir les remplaçants.`;
}

function teamLabel(state: GuildTournamentState, teamId: string | undefined): string {
  const team = teamId ? state.teams[teamId] : undefined;
  return team ? `${team.name} [${team.tag}]` : "Bye";
}

function guildTeamName(state: GuildTournamentState, teamId: string): string {
  return teamLabel(state, teamId);
}

function matchText(state: GuildTournamentState, match: Match): string {
  const scores = match.scoreA !== undefined ? ` — ${match.scoreA}/${match.scoreB}` : "";
  const lane = match.bracket === "losers" ? "Perdants" : match.bracket === "grand-final" ? "Grande finale" : "Gagnants";
  return `${lane} R${match.round}.${match.position + 1} : ${teamLabel(state, match.teamAId)} vs ${teamLabel(state, match.teamBId)}${scores} (${match.status})`;
}

function bracketText(state: GuildTournamentState): string {
  const matches = Object.values(state.matches).sort((a, b) => a.round - b.round || a.position - b.position);
  if (!matches.length) return `**Bracket double élimination — statut ${state.status}**\nAucun bracket généré.`;
  const sections: string[] = [];
  for (const section of [
    { title: "🟦 BRACKET DES GAGNANTS", matches: matches.filter((match) => (match.bracket ?? "winners") === "winners") },
    { title: "🟥 BRACKET DES PERDANTS", matches: matches.filter((match) => match.bracket === "losers") },
    { title: "🏆 GRANDE FINALE", matches: matches.filter((match) => match.bracket === "grand-final") },
  ]) {
    if (section.matches.length > 0) {
      sections.push(`**${section.title}**\n${section.matches.map((match) => matchText(state, match)).join("\n")}`);
    }
  }
  return `**Bracket double élimination — statut ${state.status}**\n\n${sections.join("\n\n")}`;
}

function captainOf(state: GuildTournamentState, teamId: string | undefined): string | undefined {
  return teamId ? state.teams[teamId]?.captainId : undefined;
}

function isCaptainOfMatch(state: GuildTournamentState, match: Match, userId: string): boolean {
  return captainOf(state, match.teamAId) === userId || captainOf(state, match.teamBId) === userId;
}

async function safeReply(interaction: ReplyableInteraction, payload: InteractionReplyOptions): Promise<void> {
  if (interaction.isRepliable() && interaction.replied) {
    await interaction.followUp(payload).catch(() => undefined);
  } else if (interaction.isRepliable() && interaction.deferred) {
    await interaction.editReply({
      content: payload.content,
      embeds: payload.embeds,
      components: payload.components,
    }).catch(() => undefined);
  } else if (interaction.isRepliable()) {
    await interaction.reply(payload).catch(() => undefined);
  }
}