import type {
  Format,
  GuildTournamentState,
  Match,
  Registration,
} from "./types";

export const FORMAT_LABELS: Record<Format, string> = {
  4: "4v4",
  5: "5v5",
  6: "6v6",
};

export function formatFromValue(value: string): Format | null {
  const parsed = Number(value);
  return parsed === 4 || parsed === 5 || parsed === 6 ? parsed : null;
}

export function registrationsForTeam(
  guild: GuildTournamentState,
  teamId: string,
): Registration | undefined {
  return Object.values(guild.registrations).find(
    (registration) => registration.teamId === teamId,
  );
}

export function registrationIsComplete(
  registration: Registration,
): { valid: boolean; reason?: string } {
  if (registration.playerIds.length < registration.format) {
    return { valid: false, reason: `Il faut au moins ${registration.format} joueurs.` };
  }
  if (!registration.playerIds.includes(registration.captainId)) {
    return { valid: false, reason: "Le capitaine doit faire partie des joueurs inscrits." };
  }
  if (registration.squads.some((squad) => squad.length !== registration.format)) {
    return { valid: false, reason: "Chaque squad doit contenir le nombre de joueurs du format." };
  }
  if (!registration.playerIds.every((playerId) => registration.checkIn[playerId] === true)) {
    return { valid: false, reason: "Tous les joueurs inscrits doivent être présents." };
  }
  return { valid: true };
}

export function createBracket(guild: GuildTournamentState, teamIds: string[]): void {
  guild.matches = {};
  guild.bracketVersion += 1;
  const shuffled = [...teamIds].sort(() => Math.random() - 0.5);
  const firstRoundCount = Math.max(1, Math.ceil(shuffled.length / 2));
  const rounds = Math.max(1, Math.ceil(Math.log2(Math.max(2, shuffled.length))));
  const roundIds: string[][] = [];

  for (let round = 1; round <= rounds; round += 1) {
    const count = round === 1 ? firstRoundCount : Math.ceil(firstRoundCount / 2 ** (round - 1));
    const ids: string[] = [];
    for (let position = 0; position < count; position += 1) {
      const id = `match-${guild.bracketVersion}-${round}-${position + 1}`;
      const match: Match = {
        id,
        round,
        position,
        status: "pending",
      };
      if (round === 1) {
        match.teamAId = shuffled[position * 2];
        match.teamBId = shuffled[position * 2 + 1];
        if (!match.teamBId && match.teamAId) {
          match.winnerId = match.teamAId;
          match.status = "completed";
        }
      }
      guild.matches[id] = match;
      ids.push(id);
    }
    roundIds.push(ids);
  }

  for (let round = 1; round < roundIds.length; round += 1) {
    const current = roundIds[round - 1];
    const next = roundIds[round];
    current.forEach((matchId, index) => {
      guild.matches[matchId].nextMatchId = next[Math.floor(index / 2)];
    });
  }

  for (const match of Object.values(guild.matches)) {
    if (match.status === "completed" && match.winnerId) {
      advanceWinner(guild, match);
    }
  }
  guild.status = "drawn";
}

export function activateAvailableMatches(guild: GuildTournamentState): void {
  for (const match of Object.values(guild.matches)) {
    if (
      match.status === "pending" &&
      match.teamAId &&
      match.teamBId &&
      !match.winnerId
    ) {
      match.status = "active";
    }
  }
}

export function submitScore(
  match: Match,
  scoreA: number,
  scoreB: number,
  captainId: string,
): { ok: boolean; error?: string } {
  if (match.status !== "active") return { ok: false, error: "Ce match n'est pas actif." };
  if (!Number.isInteger(scoreA) || !Number.isInteger(scoreB) || scoreA < 0 || scoreB < 0) {
    return { ok: false, error: "Les scores doivent être des entiers positifs ou nuls." };
  }
  if (scoreA === scoreB) return { ok: false, error: "Un match nul n'est pas accepté." };
  match.scoreA = scoreA;
  match.scoreB = scoreB;
  match.proposedBy = captainId;
  match.submittedAt = new Date().toISOString();
  match.status = "awaiting-confirmation";
  return { ok: true };
}

export function confirmScore(
  guild: GuildTournamentState,
  match: Match,
  confirmerId: string,
): { ok: boolean; error?: string; winnerId?: string } {
  if (match.status !== "awaiting-confirmation") {
    return { ok: false, error: "Ce score ne peut plus être confirmé." };
  }
  if (match.proposedBy === confirmerId) {
    return { ok: false, error: "Le capitaine adverse doit confirmer le score." };
  }
  if (match.scoreA === undefined || match.scoreB === undefined) {
    return { ok: false, error: "Le score proposé est incomplet." };
  }

  match.winnerId = match.scoreA > match.scoreB ? match.teamAId : match.teamBId;
  match.status = "completed";
  if (match.winnerId) advanceWinner(guild, match);
  return { ok: true, winnerId: match.winnerId };
}

export function resolveScore(
  guild: GuildTournamentState,
  match: Match,
  scoreA: number,
  scoreB: number,
): { ok: boolean; error?: string; winnerId?: string } {
  if (scoreA < 0 || scoreB < 0 || scoreA === scoreB) {
    return { ok: false, error: "Le score arbitré doit être valide et sans égalité." };
  }
  match.scoreA = scoreA;
  match.scoreB = scoreB;
  match.winnerId = scoreA > scoreB ? match.teamAId : match.teamBId;
  match.status = "completed";
  if (match.winnerId) advanceWinner(guild, match);
  return { ok: true, winnerId: match.winnerId };
}

function advanceWinner(guild: GuildTournamentState, match: Match): void {
  if (!match.nextMatchId || !match.winnerId) return;
  const next = guild.matches[match.nextMatchId];
  if (!next) return;
  if (match.position % 2 === 0) next.teamAId = match.winnerId;
  else next.teamBId = match.winnerId;
  if (next.teamAId && next.teamBId && guild.status === "live") {
    next.status = "active";
  }
}

export function isTournamentComplete(guild: GuildTournamentState): boolean {
  const matches = Object.values(guild.matches);
  return matches.length > 0 && matches.every((match) => match.status === "completed");
}

export function calculateRanking(guild: GuildTournamentState): string[] {
  const completed = Object.values(guild.matches)
    .filter((match) => match.status === "completed" && match.winnerId)
    .sort((a, b) => b.round - a.round || a.position - b.position);
  const ranking: string[] = [];
  for (const match of completed) {
    if (match.winnerId && !ranking.includes(match.winnerId)) ranking.push(match.winnerId);
    const loser =
      match.teamAId === match.winnerId ? match.teamBId : match.teamAId;
    if (loser && !ranking.includes(loser)) ranking.push(loser);
  }
  return ranking;
}