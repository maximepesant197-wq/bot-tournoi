import { db, tournamentStateTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { Logger } from "pino";
import {
  emptyAppState,
  emptyGuildState,
  type AppState,
  type GuildTournamentState,
} from "./types";

function isState(value: unknown): value is AppState {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as { version?: unknown }).version === 1 &&
      typeof (value as { guilds?: unknown }).guilds === "object",
  );
}

export class TournamentStore {
  private state: AppState = emptyAppState();
  private mutationQueue: Promise<unknown> = Promise.resolve();

  public constructor(private readonly logger: Logger) {}

  public async init(): Promise<void> {
    const rows = await db
     .select()
     .from(tournamentStateTable)
     .where(eq(tournamentStateTable.id, 1))
     .limit(1);
    const saved = rows[0]?.data;
    if (isState(saved)) {
      this.state = saved;
      let normalized = false;
      for (const guild of Object.values(this.state.guilds)) {
        if (guild.status === "finished" && Object.keys(guild.matches).length === 0) {
          guild.status = "draft";
          guild.checkInOpen = false;
          guild.checkInClosedAt = undefined;
          guild.finalRanking = [];
          delete guild.winnerId;
          normalized = true;
        }
      }
      if (normalized) await this.persist();
      this.logger.info({ guilds: Object.keys(saved.guilds).length }, "Tournament state restored");
      return;
    }

    await this.persist();
    this.logger.info("Tournament state initialized");
  }

  public getGuild(guildId: string): GuildTournamentState {
    const existing = this.state.guilds[guildId];
    if (existing) return existing;
    const created = emptyGuildState(guildId);
    this.state.guilds[guildId] = created;
    return created;
  }

  public findGuildIdByMatch(matchId: string): string | undefined {
    return Object.values(this.state.guilds).find((guild) => Boolean(guild.matches[matchId]))?.guildId;
  }

  public async mutateGuild<T>(
    guildId: string,
    mutation: (guild: GuildTournamentState) => Promise<T> | T,
  ): Promise<T> {
    let result!: T;
    const run = this.mutationQueue.then(async () => {
      result = await mutation(this.getGuild(guildId));
      await this.persist();
    });
    this.mutationQueue = run.catch(() => undefined);
    await run;
    return result;
  }

  public async persist(): Promise<void> {
    await db
     .insert(tournamentStateTable)
     .values({ id: 1, data: this.state })
     .onConflictDoUpdate({
        target: tournamentStateTable.id,
        set: { data: this.state, updatedAt: new Date() },
      });
  }

  // ==================== FIX 1 : SUPPRESSION TOTALE TEAM ====================
  // Avant : tu supprimais seulement le role et la catégorie Discord
  // Les salons ma-team / check-in / tournoi restaient orphelins
  // Maintenant : on supprime tout + on nettoie le state tournoi
  public async deleteTeamFully(guildId: string, teamId: string): Promise<void> {
    await this.mutateGuild(guildId, async (guild) => {
      // Supprime la team du state
      if (guild.teams) {
        delete guild.teams[teamId];
      }

      // Supprime les matchs liés à cette team
      for (const matchId of Object.keys(guild.matches)) {
        const match = guild.matches[matchId];
        if (match.teamAId === teamId || match.teamBId === teamId) {
          delete guild.matches[matchId];
        }
      }

      // Supprime du check-in
      if (guild.checkedTeams) {
        guild.checkedTeams = guild.checkedTeams.filter(id => id!== teamId);
      }

      // Nettoie le ranking
      guild.finalRanking = guild.finalRanking.filter(id => id!== teamId);
    });
  }

  // ==================== FIX 2 : CHECK-IN QUI MELANGE LES JOUEURS ====================
  // Avant : quand une team adverse s'inscrivait, tu mettais tous les joueurs dans le check-in
  // Fix : on isole par teamId
  public async setCheckIn(guildId: string, teamId: string, checked: boolean) {
    return this.mutateGuild(guildId, (guild) => {
      if (!guild.checkedTeams) guild.checkedTeams = [];

      if (checked) {
        // Ajoute seulement cette team, pas les adverses
        if (!guild.checkedTeams.includes(teamId)) {
          guild.checkedTeams.push(teamId);
        }
      } else {
        guild.checkedTeams = guild.checkedTeams.filter(id => id!== teamId);
      }
      return guild.checkedTeams;
    });
  }

  public getCheckInForTeam(guildId: string, teamId: string) {
    const guild = this.getGuild(guildId);
    const team = guild.teams?.[teamId];
    if (!team) return null;

    // Retourne UNIQUEMENT les joueurs de cette team, pas les joueurs d'en face
    return {
      teamId: team.id,
      teamName: team.name,
      players: team.players || [], // Seulement ses joueurs, pas tous
      checkedIn: guild.checkedTeams?.includes(teamId) || false
    };
  }
}
