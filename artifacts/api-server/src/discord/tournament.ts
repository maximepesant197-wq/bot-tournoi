import type {
  BracketLane,
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
    return {
      valid: false,
      reason: `Il faut au moins ${registration.format} joueurs.`,
    };
  }

  if (!registration.playerIds.includes(registration.captainId)) {
    return {
      valid: false,
      reason: "Le capitaine doit faire partie des joueurs inscrits.",
    };
  }

  if (
    registration.squads.some(
      (squad) => squad.length !== registration.format,
    )
  ) {
    return {
      valid: false,
      reason:
        "Chaque squad doit contenir le nombre de joueurs du format.",
    };
  }

  if (
    !registration.playerIds.every(
      (playerId) => registration.checkIn[playerId] === true,
    )
  ) {
    return {
      valid: false,
      reason: "Tous les joueurs inscrits doivent être présents.",
    };
  }

  return { valid: true };
}

export function createBracket(
  guild: GuildTournamentState,
  teamIds: string[],
): void {
  guild.matches = {};
  guild.bracketVersion += 1;

  const shuffled = [...teamIds].sort(() => Math.random() - 0.5);

  const totalSlots = Math.max(
    2,
    Math.pow(
      2,
      Math.ceil(Math.log2(Math.max(2, shuffled.length))),
    ),
  );

  const firstRoundCount = totalSlots / 2;
  const winnersRoundCount = Math.log2(totalSlots);

  const winnersRounds: Match[][] = [];

  for (let round = 1; round <= winnersRoundCount; round += 1) {
    const count = totalSlots / Math.pow(2, round);
    const matches: Match[] = [];

    for (let position = 0; position < count; position += 1) {
      const id = `match-${guild.bracketVersion}-w${round}-${position + 1}`;

      const match: Match = {
        id,
        bracket: "winners",
        round,
        position,
        status: "pending",
      };

      if (round === 1) {
        match.teamAId = shuffled[position * 2];
        match.teamBId = shuffled[position * 2 + 1];

        // Bye = victoire automatique
        if (match.teamAId && !match.teamBId) {
          match.winnerId = match.teamAId;
          match.status = "completed";
        } else if (!match.teamAId && match.teamBId) {
          match.winnerId = match.teamBId;
          match.status = "completed";
        } else if (!match.teamAId && !match.teamBId) {
          // Match complètement vide
          match.status = "completed";
        }
      }

      guild.matches[id] = match;
      matches.push(match);
    }

    winnersRounds.push(matches);
  }

  const losersRounds: Match[][] = [];

  const loserRoundTotal = Math.max(
    1,
    (winnersRoundCount - 1) * 2,
  );

  for (
    let round = 1;
    round <= loserRoundTotal;
    round += 1
  ) {
    const count = Math.max(
      1,
      Math.ceil(
        firstRoundCount /
          Math.pow(2, Math.ceil(round / 2)),
      ),
    );

    const matches: Match[] = [];

    for (let position = 0; position < count; position += 1) {
      const id = `match-${guild.bracketVersion}-l${round}-${position + 1}`;

      const match: Match = {
        id,
        bracket: "losers",
        round,
        position,
        status: "pending",
      };

      guild.matches[id] = match;
      matches.push(match);
    }

    losersRounds.push(matches);
  }

  const grandFinal: Match = {
    id: `match-${guild.bracketVersion}-gf`,
    bracket: "grand-final",
    round: 1,
    position: 0,
    status: "pending",
  };

  guild.matches[grandFinal.id] = grandFinal;

  // Connexions Winners
  for (
    let round = 0;
    round < winnersRounds.length;
    round += 1
  ) {
    winnersRounds[round].forEach((match, index) => {
      if (round < winnersRounds.length - 1) {
        match.nextMatchId =
          winnersRounds[round + 1][
            Math.floor(index / 2)
          ]?.id;
      } else {
        match.nextMatchId = grandFinal.id;
      }

      const loserRound =
        round === 0
          ? 0
          : round * 2 - 1;

      match.loserNextMatchId =
        losersRounds.length === 0
          ? grandFinal.id
          : losersRounds[loserRound]?.[
              round === 0
                ? Math.floor(index / 2)
                : index
            ]?.id ?? grandFinal.id;
    });
  }

  // Connexions Losers
  for (
    let round = 0;
    round < losersRounds.length;
    round += 1
  ) {
    losersRounds[round].forEach((match, index) => {
      if (round < losersRounds.length - 1) {
        const nextRound = losersRounds[round + 1];

        match.nextMatchId =
          nextRound[
            round % 2 === 0
              ? index
              : Math.floor(index / 2)
          ]?.id;
      } else {
        match.nextMatchId = grandFinal.id;
      }
    });
  }

  // Propagation des BYE
  for (const match of winnersRounds[0]) {
    if (
      match.status === "completed" &&
      match.winnerId
    ) {
      advanceWinner(guild, match);
    }
  }

  guild.status = "drawn";
}

export function activateAvailableMatches(
  guild: GuildTournamentState,
): void {
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
  if (match.status !== "active") {
    return {
      ok: false,
      error: "Ce match n'est pas actif.",
    };
  }

  if (
    !Number.isInteger(scoreA) ||
    !Number.isInteger(scoreB) ||
    scoreA < 0 ||
    scoreB < 0
  ) {
    return {
      ok: false,
      error:
        "Les scores doivent être des entiers positifs ou nuls.",
    };
  }

  if (scoreA === scoreB) {
    return {
      ok: false,
      error: "Un match nul n'est pas accepté.",
    };
  }

  match.scoreA = scoreA;
  match.scoreB = scoreB;
  match.proposedBy = captainId;
  match.submittedAt = new Date().toISOString();
  match.status = "awaiting-confirmation";

  return { ok: true };
}

/**
 * Confirmation d'un score.
 *
 * RÈGLE :
 * - Le capitaine A propose → capitaine B confirme.
 * - Le capitaine B propose → capitaine A confirme.
 * - Le proposant ne peut jamais confirmer son propre score.
 */
export function confirmScore(
  guild: GuildTournamentState,
  match: Match,
  confirmerId: string,
): {
  ok: boolean;
  error?: string;
  winnerId?: string;
} {
  if (match.status !== "awaiting-confirmation") {
    return {
      ok: false,
      error: "Ce score ne peut plus être confirmé.",
    };
  }

  if (
    match.scoreA === undefined ||
    match.scoreB === undefined
  ) {
    return {
      ok: false,
      error: "Le score proposé est incomplet.",
    };
  }

  if (!match.teamAId || !match.teamBId) {
    return {
      ok: false,
      error: "Les deux équipes du match sont introuvables.",
    };
  }

  const teamA = guild.teams[match.teamAId];
  const teamB = guild.teams[match.teamBId];

  if (!teamA || !teamB) {
    return {
      ok: false,
      error: "Impossible de trouver les deux équipes.",
    };
  }

  const captainA = teamA.captainId;
  const captainB = teamB.captainId;

  if (!captainA || !captainB) {
    return {
      ok: false,
      error:
        "Impossible de trouver les capitaines des équipes.",
    };
  }

  if (
    confirmerId !== captainA &&
    confirmerId !== captainB
  ) {
    return {
      ok: false,
      error:
        "Seul le capitaine de l'équipe adverse peut confirmer.",
    };
  }

  const proposerId = match.proposedBy;

  if (!proposerId) {
    return {
      ok: false,
      error:
        "Impossible de déterminer quelle équipe a proposé le score.",
    };
  }

  /*
   * On ne se base PAS uniquement sur :
   *
   * proposerId === captainA
   *
   * car un ancien état peut contenir l'ID d'un joueur
   * de l'équipe au lieu de celui du capitaine.
   */

  const proposerIsTeamA =
    proposerId === captainA ||
    teamA.memberIds.includes(proposerId);

  const proposerIsTeamB =
    proposerId === captainB ||
    teamB.memberIds.includes(proposerId);

  if (proposerIsTeamA && proposerIsTeamB) {
    return {
      ok: false,
      error:
        "Impossible de déterminer l'équipe du proposant.",
    };
  }

  if (!proposerIsTeamA && !proposerIsTeamB) {
    return {
      ok: false,
      error:
        "Le joueur ayant proposé le score n'appartient plus aux équipes du match.",
    };
  }

  const expectedCaptain = proposerIsTeamA
    ? captainB
    : captainA;

  if (confirmerId !== expectedCaptain) {
    return {
      ok: false,
      error: `Seul le capitaine adverse (<@${expectedCaptain}>) peut confirmer.`,
    };
  }

  match.winnerId =
    match.scoreA > match.scoreB
      ? match.teamAId
      : match.teamBId;

  match.status = "completed";

  if (match.winnerId) {
    advanceWinner(guild, match);
    advanceLoser(guild, match);
  }

  return {
    ok: true,
    winnerId: match.winnerId,
  };
}

export function resolveScore(
  guild: GuildTournamentState,
  match: Match,
  scoreA: number,
  scoreB: number,
): {
  ok: boolean;
  error?: string;
  winnerId?: string;
} {
  if (
    scoreA < 0 ||
    scoreB < 0 ||
    scoreA === scoreB
  ) {
    return {
      ok: false,
      error:
        "Le score arbitré doit être valide et sans égalité.",
    };
  }

  match.scoreA = scoreA;
  match.scoreB = scoreB;

  match.winnerId =
    scoreA > scoreB
      ? match.teamAId
      : match.teamBId;

  match.status = "completed";

  if (match.winnerId) {
    advanceWinner(guild, match);
    advanceLoser(guild, match);
  }

  return {
    ok: true,
    winnerId: match.winnerId,
  };
}

function advanceWinner(
  guild: GuildTournamentState,
  match: Match,
): void {
  if (
    !match.nextMatchId ||
    !match.winnerId
  ) {
    return;
  }

  const next = guild.matches[match.nextMatchId];

  if (!next) return;

  const slot =
    next.bracket === "grand-final"
      ? match.bracket === "winners"
        ? "teamAId"
        : "teamBId"
      : match.bracket === "losers" &&
          match.round % 2 === 1
        ? "teamAId"
        : match.position % 2 === 0
          ? "teamAId"
          : "teamBId";

  next[slot] = match.winnerId;

  if (
    next.teamAId &&
    next.teamBId &&
    guild.status === "live"
  ) {
    next.status = "active";
  }
}

function advanceLoser(
  guild: GuildTournamentState,
  match: Match,
): void {
  if (
    match.bracket !== "winners" ||
    !match.loserNextMatchId ||
    !match.winnerId
  ) {
    return;
  }

  // Aucun perdant à envoyer dans le bracket losers
  // si le match était un BYE.
  if (
    !match.teamAId ||
    !match.teamBId
  ) {
    return;
  }

  const loserId =
    match.teamAId === match.winnerId
      ? match.teamBId
      : match.teamAId;

  if (!loserId) return;

  const next =
    guild.matches[match.loserNextMatchId];

  if (!next) return;

  const slot =
    next.bracket === "grand-final" ||
    match.round > 1
      ? "teamBId"
      : match.position % 2 === 0
        ? "teamAId"
        : "teamBId";

  next[slot] = loserId;

  if (
    next.teamAId &&
    next.teamBId &&
    guild.status === "live"
  ) {
    next.status = "active";
  }
}

export function isTournamentComplete(
  guild: GuildTournamentState,
): boolean {
  const matches = Object.values(guild.matches);

  return (
    matches.length > 0 &&
    matches.every((match) => {
      if (
        !match.teamAId &&
        !match.teamBId &&
        !match.winnerId
      ) {
        return true;
      }

      return match.status === "completed";
    })
  );
}

export function calculateRanking(
  guild: GuildTournamentState,
): string[] {
  const completed = Object.values(guild.matches)
    .filter(
      (match) =>
        match.status === "completed" &&
        match.winnerId,
    )
    .sort(
      (a, b) =>
        bracketWeight(b.bracket) -
          bracketWeight(a.bracket) ||
        b.round - a.round ||
        a.position - b.position,
    );

  const ranking: string[] = [];

  for (const match of completed) {
    if (
      match.winnerId &&
      !ranking.includes(match.winnerId)
    ) {
      ranking.push(match.winnerId);
    }

    const loser =
      match.teamAId === match.winnerId
        ? match.teamBId
        : match.teamAId;

    if (
      loser &&
      !ranking.includes(loser)
    ) {
      ranking.push(loser);
    }
  }

  return ranking;
}

function bracketWeight(
  bracket: BracketLane | undefined,
): number {
  if (bracket === "grand-final") return 3;
  if (bracket === "winners") return 2;
  return 1;
  }
