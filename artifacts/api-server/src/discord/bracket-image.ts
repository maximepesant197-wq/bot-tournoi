import sharp from "sharp";
import type { GuildTournamentState, Match } from "./types";

const WIDTH = 2000;
const HEIGHT = 1300;
const CARD_WIDTH = 230;
const CARD_HEIGHT = 54;
const COLUMN_STEP = 270;
const GRAND_FINAL_X = 1705;

type Lane = "winners" | "losers" | "grand-final";

interface Rect {
  x: number;
  y: number;
}

export async function renderBracketImage(state: GuildTournamentState): Promise<Buffer> {
  return renderSvgToPng(buildBracketSvg(state));
}

function buildBracketSvg(state: GuildTournamentState): string {
  const matches = Object.values(state.matches).filter(m => {
    // Ne pas afficher les matchs vides Bye vs Bye
    if (!m.teamAId && !m.teamBId && !m.winnerId && m.bracket === "winners" && m.round === 1) return false;
    return true;
  });
  const winners = matches
    .filter((match) => (match.bracket ?? "winners") === "winners")
    .sort(matchOrder);
  const losers = matches
    .filter((match) => match.bracket === "losers")
    .sort(matchOrder);
  const grandFinal = matches.find((match) => match.bracket === "grand-final");
  const positions = new Map<string, Rect>();

  const winnerRounds = roundGroups(winners);
  const loserRounds = roundGroups(losers);
  const winnerArea = { top: 164, height: 420 };
  const loserArea = { top: 690, height: 420 };

  for (const [round, roundMatches] of winnerRounds) {
    placeRound(roundMatches, round - 1, winnerArea.top, winnerArea.height, positions);
  }
  for (const [round, roundMatches] of loserRounds) {
    placeRound(roundMatches, round - 1, loserArea.top, loserArea.height, positions);
  }
  if (grandFinal) positions.set(grandFinal.id, { x: GRAND_FINAL_X, y: 480 });

  const connectorSvg = matches
    .map((match) => connector(match, positions))
    .filter(Boolean)
    .join("");
  const winnerCards = winners.map((match) => matchCard(state, match, positions.get(match.id)!, "winners")).join("");
  const loserCards = losers.map((match) => matchCard(state, match, positions.get(match.id)!, "losers")).join("");
  const finalCard = grandFinal ? matchCard(state, grandFinal, positions.get(grandFinal.id)!, "grand-final") : emptyFinalCard();

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <linearGradient id="background" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#020617"/>
      <stop offset="0.48" stop-color="#07112a"/>
      <stop offset="1" stop-color="#18060d"/>
    </linearGradient>
    <radialGradient id="blueGlow" cx="0.05" cy="0.28" r="0.55">
      <stop offset="0" stop-color="#113b91" stop-opacity="0.62"/>
      <stop offset="1" stop-color="#020617" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="redGlow" cx="0.95" cy="0.7" r="0.6">
      <stop offset="0" stop-color="#7f1d35" stop-opacity="0.56"/>
      <stop offset="1" stop-color="#020617" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#7c4a03"/>
      <stop offset="0.5" stop-color="#f8d477"/>
      <stop offset="1" stop-color="#8b5d12"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="5" stdDeviation="7" flood-color="#000" flood-opacity="0.55"/>
    </filter>
    <pattern id="grid" width="56" height="56" patternUnits="userSpaceOnUse">
      <path d="M 56 0 L 0 0 0 56" fill="none" stroke="#94a3b8" stroke-opacity="0.06" stroke-width="1"/>
    </pattern>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#background)"/>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#blueGlow)"/>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#redGlow)"/>
  <rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" fill="url(#grid)"/>
  <path d="M 0 600 L 430 0 M 1220 1300 L 2000 410" stroke="#2563eb" stroke-opacity="0.12" stroke-width="4"/>
  <path d="M 350 1300 L 1050 0 M 1470 1300 L 2000 620" stroke="#ef233c" stroke-opacity="0.1" stroke-width="4"/>

  ${headerSvg(state)}
  ${sectionTitle(40, 108, 1250, "POULE A — BRACKET DES GAGNANTS", "Toutes les équipes commencent ici.", "#1d4ed8")}
  ${sectionTitle(40, 634, 1250, "POULE B — BRACKET DES PERDANTS", "Les équipes qui perdent descendent ici.", "#b91c1c")}
  ${sectionTitle(1650, 370, 300, "GRANDE FINALE", "GAGNANT vs PERDANT", "#a16207")}
  ${stageLabels(winnerRounds, "winners")}
  ${stageLabels(loserRounds, "losers")}
  <g fill="none" stroke="#f8fafc" stroke-opacity="0.75" stroke-width="3">${connectorSvg}</g>
  ${winnerCards}
  ${loserCards}
  ${finalCard}
  ${footerSvg()}
</svg>`;
}

function headerSvg(state: GuildTournamentState): string {
  return `<g>
    <path d="M 52 24 L 98 8 L 144 24 L 136 76 L 98 102 L 60 76 Z" fill="#07111f" stroke="#60a5fa" stroke-width="3"/>
    <path d="M 98 18 L 126 29 L 120 68 L 98 84 L 76 68 L 70 29 Z" fill="none" stroke="#ef233c" stroke-width="3"/>
    <text x="98" y="63" text-anchor="middle" fill="#f8fafc" font-family="Arial, sans-serif" font-size="40" font-weight="900">A</text>
    <text x="180" y="49" fill="#f8fafc" font-family="Arial, sans-serif" font-size="42" font-weight="900" letter-spacing="3">ARENA <tspan fill="#ef233c">FR</tspan></text>
    <text x="182" y="83" fill="#cbd5e1" font-family="Arial, sans-serif" font-size="19" letter-spacing="5">MATCHS &amp; TOURNOIS</text>
    <text x="1950" y="42" text-anchor="end" fill="#94a3b8" font-family="Arial, sans-serif" font-size="18" letter-spacing="2">STATUT : ${xmlText(state.status).toUpperCase()}</text>
    <text x="1950" y="72" text-anchor="end" fill="#64748b" font-family="Arial, sans-serif" font-size="15">BRACKET DOUBLE ÉLIMINATION</text>
  </g>`;
}

function sectionTitle(x: number, y: number, width: number, title: string, subtitle: string, color: string): string {
  return `<g filter="url(#shadow)">
    <rect x="${x}" y="${y}" width="${width}" height="43" rx="7" fill="${color}" fill-opacity="0.72" stroke="${color}" stroke-width="2"/>
    <text x="${x + 20}" y="${y + 27}" fill="#f8fafc" font-family="Arial, sans-serif" font-size="21" font-weight="900" letter-spacing="1">${xmlText(title)}</text>
    <text x="${x + width - 20}" y="${y + 27}" text-anchor="end" fill="#dbeafe" font-family="Arial, sans-serif" font-size="14">${xmlText(subtitle)}</text>
  </g>`;
}

function stageLabels(rounds: Map<number, Match[]>, lane: "winners" | "losers"): string {
  return [...rounds.keys()].map((round, index) => {
    const x = 40 + index * COLUMN_STEP;
    const color = lane === "winners" ? "#2563eb" : "#dc2626";
    const label = round === 1 ? "1/8 FINALE" : round === 2 ? "1/4 FINALE" : round === 3 ? "DEMI-FINALE" : "FINALE";
    return `<g>
      <rect x="${x}" y="${lane === "winners" ? 142 : 668}" width="${CARD_WIDTH}" height="24" rx="4" fill="${color}" fill-opacity="0.82"/>
      <text x="${x + CARD_WIDTH / 2}" y="${lane === "winners" ? 159 : 685}" text-anchor="middle" fill="#fff" font-family="Arial, sans-serif" font-size="13" font-weight="700">${label} (${lane === "winners" ? "GAGNANTS" : "PERDANTS"})</text>
    </g>`;
  }).join("");
}

function roundGroups(matches: Match[]): Map<number, Match[]> {
  const groups = new Map<number, Match[]>();
  for (const match of matches) {
    const existing = groups.get(match.round) ?? [];
    existing.push(match);
    groups.set(match.round, existing);
  }
  return groups;
}

function placeRound(matches: Match[], column: number, top: number, height: number, positions: Map<string, Rect>): void {
  const spacing = height / Math.max(1, matches.length);
  matches.forEach((match, index) => {
    positions.set(match.id, {
      x: 40 + column * COLUMN_STEP,
      y: top + index * spacing + (spacing - CARD_HEIGHT) / 2,
    });
  });
}

function matchCard(state: GuildTournamentState, match: Match, position: Rect, lane: Lane): string {
  const color = lane === "winners" ? "#2563eb" : lane === "losers" ? "#dc2626" : "#a16207";
  const fill = lane === "winners" ? "#071c45" : lane === "losers" ? "#420e18" : "#3b270b";
  const title = lane === "grand-final" ? "GRANDE FINALE" : `MATCH ${match.round}.${match.position + 1}`;
  const status = statusLabel(match.status);
  return `<g filter="url(#shadow)">
    <rect x="${position.x}" y="${position.y}" width="${lane === "grand-final" ? 255 : CARD_WIDTH}" height="${lane === "grand-final" ? 92 : CARD_HEIGHT}" rx="6" fill="${fill}" stroke="${color}" stroke-width="2"/>
    <text x="${position.x + 12}" y="${position.y + 16}" fill="#cbd5e1" font-family="Arial, sans-serif" font-size="11" font-weight="700">${title}</text>
    <text x="${position.x + (lane === "grand-final" ? 243 : 218)}" y="${position.y + 16}" text-anchor="end" fill="${match.status === "active" ? "#4ade80" : "#94a3b8"}" font-family="Arial, sans-serif" font-size="10">${status}</text>
    ${teamRow(state, match.teamAId, match.scoreA, position.x + 12, position.y + 33, color, lane === "grand-final" ? 230 : 205)}
    ${teamRow(state, match.teamBId, match.scoreB, position.x + 12, position.y + 49, color, lane === "grand-final" ? 230 : 205)}
  </g>`;
}

function teamRow(state: GuildTournamentState, teamId: string | undefined, score: number | undefined, x: number, y: number, color: string, width: number): string {
  const label = truncate(teamId ? teamLabel(state, teamId) : "À DÉTERMINER", 25);
  const scoreText = score === undefined ? "—" : String(score);
  return `<text x="${x}" y="${y}" fill="#f8fafc" font-family="Arial, sans-serif" font-size="12">${xmlText(label)}</text>
    <rect x="${x + width - 21}" y="${y - 12}" width="21" height="16" rx="3" fill="${color}" fill-opacity="0.9"/>
    <text x="${x + width - 10.5}" y="${y}" text-anchor="middle" fill="#fff" font-family="Arial, sans-serif" font-size="12" font-weight="900">${scoreText}</text>`;
}

function emptyFinalCard(): string {
  return `<g>
    <rect x="${GRAND_FINAL_X}" y="480" width="255" height="92" rx="6" fill="#3b270b" stroke="#a16207" stroke-width="2"/>
    <text x="${GRAND_FINAL_X + 127}" y="520" text-anchor="middle" fill="#f8fafc" font-family="Arial, sans-serif" font-size="16" font-weight="900">BRACKET NON GÉNÉRÉ</text>
    <text x="${GRAND_FINAL_X + 127}" y="546" text-anchor="middle" fill="#fcd34d" font-family="Arial, sans-serif" font-size="12">Lance le tirage pour commencer</text>
  </g>`;
}

function connector(match: Match, positions: Map<string, Rect>): string {
  if (!match.nextMatchId) return "";
  const from = positions.get(match.id);
  const to = positions.get(match.nextMatchId);
  if (!from || !to) return "";
  const fromX = from.x + CARD_WIDTH;
  const fromY = from.y + CARD_HEIGHT / 2;
  const toX = to.x;
  const toY = to.y + CARD_HEIGHT / 2;
  const middleX = fromX + Math.max(18, (toX - fromX) / 2);
  return `<path d="M ${fromX} ${fromY} H ${middleX} V ${toY} H ${toX}" />`;
}

function footerSvg(): string {
  return `<g>
    <rect x="40" y="1170" width="1920" height="86" rx="8" fill="#020617" fill-opacity="0.86" stroke="#334155" stroke-width="2"/>
    <circle cx="82" cy="1213" r="18" fill="#1d4ed8"/><text x="82" y="1220" text-anchor="middle" fill="#fff" font-family="Arial, sans-serif" font-size="22" font-weight="900">✓</text>
    <text x="115" y="1207" fill="#60a5fa" font-family="Arial, sans-serif" font-size="16" font-weight="900">BRACKET DES GAGNANTS</text>
    <text x="115" y="1231" fill="#cbd5e1" font-family="Arial, sans-serif" font-size="13">Tu gagnes → tu restes ici.</text>
    <circle cx="670" cy="1213" r="18" fill="#b91c1c"/><text x="670" y="1220" text-anchor="middle" fill="#fff" font-family="Arial, sans-serif" font-size="22" font-weight="900">↓</text>
    <text x="703" y="1207" fill="#f87171" font-family="Arial, sans-serif" font-size="16" font-weight="900">BRACKET DES PERDANTS</text>
    <text x="703" y="1231" fill="#cbd5e1" font-family="Arial, sans-serif" font-size="13">Tu perds → tu descends ici.</text>
    <circle cx="1250" cy="1213" r="18" fill="#a16207"/><text x="1250" y="1220" text-anchor="middle" fill="#fff" font-family="Arial, sans-serif" font-size="19" font-weight="900">★</text>
    <text x="1283" y="1207" fill="#fcd34d" font-family="Arial, sans-serif" font-size="16" font-weight="900">GRANDE FINALE</text>
    <text x="1283" y="1231" fill="#cbd5e1" font-family="Arial, sans-serif" font-size="13">Vainqueur des gagnants contre vainqueur des perdants.</text>
    <text x="1940" y="1207" text-anchor="end" fill="#94a3b8" font-family="Arial, sans-serif" font-size="14" font-weight="700">ARENA FR</text>
    <text x="1940" y="1231" text-anchor="end" fill="#64748b" font-family="Arial, sans-serif" font-size="12">Double élimination</text>
  </g>`;
}

function teamLabel(state: GuildTournamentState, teamId: string): string {
  const team = state.teams[teamId];
  return team ? `${team.name} [${team.tag}]` : "Team inconnue";
}

function statusLabel(status: Match["status"]): string {
  if (status === "active") return "ACTIF";
  if (status === "awaiting-confirmation") return "CONFIRMATION";
  if (status === "completed") return "TERMINÉ";
  if (status === "disputed") return "LITIGE";
  return "EN ATTENTE";
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function xmlText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function matchOrder(left: Match, right: Match): number {
  return left.round - right.round || left.position - right.position;
}

// FIX: plus de spawn("convert") qui plante sur Railway
// On utilise sharp qui est natif et déjà dispo
async function renderSvgToPng(svg: string): Promise<Buffer> {
  return await sharp(Buffer.from(svg)).png().toBuffer();
        }
