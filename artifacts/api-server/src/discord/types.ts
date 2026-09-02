export type Format = 4 | 5 | 6;
export type TournamentStatus =
  | "draft"
  | "checkin"
  | "drawn"
  | "live"
  | "paused"
  | "finished";
export type MatchStatus =
  | "pending"
  | "active"
  | "awaiting-confirmation"
  | "completed"
  | "disputed";

export interface Team {
  id: string;
  guildId: string;
  name: string;
  tag: string;
  captainId: string;
  memberIds: string[];
  roleId: string;
  categoryId: string;
  baseChannelIds: {
    team: string;
    checkin: string;
    tournament: string;
  };
  voiceChannelIds: string[];
  createdAt: string;
}

export interface Registration {
  id: string;
  teamId: string;
  format: Format;
  captainId: string;
  playerIds: string[];
  squads: string[][];
  benchIds: string[];
  checkIn: Record<string, boolean>;
  status: "registered" | "excluded";
  excludedReason?: string;
  createdAt: string;
}

export interface Match {
  id: string;
  round: number;
  position: number;
  teamAId?: string;
  teamBId?: string;
  scoreA?: number;
  scoreB?: number;
  proposedBy?: string;
  submittedAt?: string;
  winnerId?: string;
  status: MatchStatus;
  nextMatchId?: string;
}

export interface Dispute {
  id: string;
  matchId: string;
  guildId: string;
  openedBy: string;
  proposedScoreA: number;
  proposedScoreB: number;
  threadId?: string;
  status: "open" | "claimed" | "resolved";
  resolution?: string;
  createdAt: string;
}

export interface GuildTournamentState {
  guildId: string;
  status: TournamentStatus;
  checkInOpen: boolean;
  checkInClosedAt?: string;
  teams: Record<string, Team>;
  registrations: Record<string, Registration>;
  matches: Record<string, Match>;
  disputes: Record<string, Dispute>;
  finalRanking: string[];
  winnerId?: string;
  bracketVersion: number;
}

export interface AppState {
  version: 1;
  guilds: Record<string, GuildTournamentState>;
}

export function emptyGuildState(guildId: string): GuildTournamentState {
  return {
    guildId,
    status: "draft",
    checkInOpen: false,
    teams: {},
    registrations: {},
    matches: {},
    disputes: {},
    finalRanking: [],
    bracketVersion: 0,
  };
}

export function emptyAppState(): AppState {
  return { version: 1, guilds: {} };
}