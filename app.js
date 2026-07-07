// ============================================================
// WC26 Betting Pool - Application Logic
// ============================================================

const DATA_URL = 'https://raw.githubusercontent.com/openfootball/world-cup.json/master/2026/worldcup.json';
const CACHE_KEY = 'wc26_matches';
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const JST_TZ = 'Asia/Tokyo';

let allMatches = [];
const VALID_TABS = ['leaderboard', 'players', 'results', 'upcoming', 'groups', 'bracket', 'charts', 'teams'];
let activeTab = 'leaderboard';
let filterStage = 'all';
let filterPlayer = 'all';
let expandedTeams = new Set();
let autoRefreshInterval = null;
let teamSortCol = 'totalPoints';
let teamSortAsc = false;

// ============================================================
// Data Fetching
// ============================================================

async function fetchMatches() {
  const cached = localStorage.getItem(CACHE_KEY);
  if (cached) {
    const { data, timestamp } = JSON.parse(cached);
    if (Date.now() - timestamp < CACHE_TTL) {
      return data;
    }
  }

  try {
    showLoading(true);
    const res = await fetch(DATA_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const matches = json.matches || [];

    localStorage.setItem(CACHE_KEY, JSON.stringify({
      data: matches,
      timestamp: Date.now()
    }));

    return matches;
  } catch (err) {
    console.error('Fetch error:', err);
    showError('Failed to fetch match data. Using cached data if available.');
    return cached ? JSON.parse(cached).data : [];
  } finally {
    showLoading(false);
  }
}

// ============================================================
// Date/Time Helpers (JST)
// ============================================================

// Parse match date + time string (e.g. "2026-06-11" + "13:00 UTC-6") into a Date object
function parseMatchDateTime(dateStr, timeStr) {
  if (!timeStr) return new Date(dateStr + 'T00:00:00+09:00'); // default to JST midnight
  // Parse "HH:MM UTC-N" or "HH:MM UTC+N"
  const m = timeStr.match(/^(\d{1,2}):(\d{2})\s*UTC([+-]\d+)$/);
  if (!m) return new Date(dateStr + 'T00:00:00+09:00');
  const hours = parseInt(m[1]);
  const minutes = m[2];
  const utcOffset = parseInt(m[3]);
  // Build ISO string with the given offset (UTC-6 → -06:00)
  const sign = utcOffset >= 0 ? '+' : '-';
  const absOffset = Math.abs(utcOffset);
  const offsetStr = `${sign}${String(absOffset).padStart(2, '0')}:00`;
  return new Date(`${dateStr}T${String(hours).padStart(2, '0')}:${minutes}:00${offsetStr}`);
}

// Format a Date to JST time string like "4:00 AM"
function formatTimeJST(date) {
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: JST_TZ });
}

// Format a Date to JST date string like "Thu, Jun 12"
function formatDateJST(date) {
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: JST_TZ });
}

// Format a Date to JST date string for grouping like "Thu, Jun 12, 2026"
function formatDateGroupJST(date) {
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: JST_TZ });
}

// Format a Date to short JST date like "Jun 12"
function formatDateShortJST(date) {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: JST_TZ });
}

// ============================================================
// Match Data Normalization
// ============================================================

function isRealTeam(name) {
  // Knockout placeholders like "W74", "L101", "W-E1" are not real teams
  return name && !/^[WL]\d+$/.test(name) && !/^[WL]-[A-L]\d$/.test(name);
}

function isFinished(match) {
  return match.score && match.score.ft && match.score.ft.length === 2;
}

function getMatchWinner(match) {
  if (!isFinished(match)) return null;

  // For knockout matches, check penalties first, then extra time, then full time
  if (match.score.p) {
    if (match.score.p[0] > match.score.p[1]) return 'team1';
    if (match.score.p[1] > match.score.p[0]) return 'team2';
  }
  if (match.score.et) {
    if (match.score.et[0] > match.score.et[1]) return 'team1';
    if (match.score.et[1] > match.score.et[0]) return 'team2';
  }

  const [h, a] = match.score.ft;
  if (h > a) return 'team1';
  if (a > h) return 'team2';
  return 'draw';
}

function getDisplayScore(match) {
  if (!isFinished(match)) return null;
  // Show the final result including extra time if applicable
  if (match.score.et) {
    return { home: match.score.et[0], away: match.score.et[1], penalties: match.score.p || null };
  }
  return { home: match.score.ft[0], away: match.score.ft[1], penalties: null };
}

function getStageFromRound(round) {
  if (!round) return 'GROUP_STAGE';
  const r = round.toLowerCase();
  if (r.includes('matchday')) return 'GROUP_STAGE';
  if (r.includes('round of 32')) return 'LAST_32';
  if (r.includes('round of 16')) return 'LAST_16';
  if (r.includes('quarter')) return 'QUARTER_FINALS';
  if (r.includes('semi')) return 'SEMI_FINALS';
  if (r.includes('third') || r.includes('3rd') || r.includes('match for third')) return 'THIRD_PLACE';
  if (r === 'final') return 'FINAL';
  return 'GROUP_STAGE';
}

function formatStage(stage) {
  const map = {
    'GROUP_STAGE': 'Group Stage',
    'LAST_32': 'Round of 32',
    'LAST_16': 'Round of 16',
    'QUARTER_FINALS': 'Quarter-Finals',
    'SEMI_FINALS': 'Semi-Finals',
    'THIRD_PLACE': '3rd Place',
    'FINAL': 'Final',
  };
  return map[stage] || stage;
}

// ============================================================
// Scoring Engine
// ============================================================

function calculateTeamPoints(matches, teamName) {
  let wins = 0, draws = 0, losses = 0, goalsFor = 0, goalsAgainst = 0;
  const teamMatches = [];

  for (const match of matches) {
    if (!isFinished(match)) continue;

    const home = normalizeTeamName(match.team1);
    const away = normalizeTeamName(match.team2);
    const isHome = home === teamName;
    const isAway = away === teamName;

    if (!isHome && !isAway) continue;

    const [hGoals, aGoals] = match.score.ft;
    const gf = isHome ? hGoals : aGoals;
    const ga = isHome ? aGoals : hGoals;
    goalsFor += gf;
    goalsAgainst += ga;

    const winner = getMatchWinner(match);
    let result, points;

    if (winner === 'draw') {
      // True draw (group stage). In knockouts, winner is decided by ET/pens
      result = 'D';
      points = 1;
      draws++;
    } else if (
      (isHome && winner === 'team1') ||
      (isAway && winner === 'team2')
    ) {
      result = 'W';
      points = 3;
      wins++;
    } else {
      result = 'L';
      points = 0;
      losses++;
    }

    teamMatches.push({
      ...match,
      result,
      points,
      gf,
      ga,
      opponent: isHome ? away : home,
      stage: getStageFromRound(match.round)
    });
  }

  return {
    wins, draws, losses,
    goalsFor, goalsAgainst,
    points: wins * 3 + draws,
    matches: teamMatches
  };
}

function getChampion(matches) {
  const final = matches.find(m => {
    const stage = getStageFromRound(m.round);
    return stage === 'FINAL' && isFinished(m);
  });
  if (!final) return null;

  const winner = getMatchWinner(final);
  if (winner === 'team1') return normalizeTeamName(final.team1);
  if (winner === 'team2') return normalizeTeamName(final.team2);
  return null;
}

function calculatePlayerScores(matches) {
  const champion = getChampion(matches);

  return PLAYERS.map(player => {
    let totalPoints = 0;
    const teamResults = [];

    for (const team of player.teams) {
      const stats = calculateTeamPoints(matches, team);
      const isChampion = champion === team;
      const bonusPoints = isChampion ? 3 : 0;
      const teamTotal = stats.points + bonusPoints;
      totalPoints += teamTotal;

      teamResults.push({
        name: team,
        ...stats,
        bonusPoints,
        totalPoints: teamTotal,
        isChampion
      });
    }

    teamResults.sort((a, b) => b.totalPoints - a.totalPoints);

    return {
      ...player,
      totalPoints,
      teamResults,
      totalWins: teamResults.reduce((s, t) => s + t.wins, 0),
      totalDraws: teamResults.reduce((s, t) => s + t.draws, 0),
      totalLosses: teamResults.reduce((s, t) => s + t.losses, 0),
    };
  }).sort((a, b) => b.totalPoints - a.totalPoints || b.totalWins - a.totalWins);
}

// ============================================================
// Rendering
// ============================================================

function renderApp() {
  const scores = calculatePlayerScores(allMatches);
  renderLeaderboard(scores);
  renderPlayerCards(scores);
  renderMatches();
  renderGroups();
  renderBracket();
  renderCharts();
  renderTeamStandings(scores);
  updateLastRefresh();
  setActiveTab(activeTab);
}

function renderLeaderboard(scores) {
  const container = document.getElementById('leaderboard-content');
  const maxPoints = scores[0]?.totalPoints || 1;

  // Calculate ranks with ties
  const ranks = [];
  let currentRank = 1;
  for (let i = 0; i < scores.length; i++) {
    if (i > 0 && scores[i].totalPoints < scores[i - 1].totalPoints) {
      currentRank = i + 1;
    }
    ranks.push(currentRank);
  }

  container.innerHTML = scores.map((player, i) => {
    const rank = ranks[i];
    const barWidth = maxPoints > 0 ? (player.totalPoints / maxPoints) * 100 : 0;
    const rankBadge = rank <= 3
      ? `<span class="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white ${rank === 1 ? 'bg-yellow-500' : rank === 2 ? 'bg-gray-400' : 'bg-amber-700'}">${rank}</span>`
      : `<span class="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-gray-400 bg-gray-100">${rank}</span>`;

    return `
      <div class="flex items-center gap-4 p-4 bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
        ${rankBadge}
        <div class="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0" style="background-color: ${player.color}">
          ${player.initials}
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <span class="font-semibold text-gray-900">${player.name}</span>
            <span class="text-xs text-gray-400">${player.teams.length} teams</span>
          </div>
          <div class="mt-1 w-full bg-gray-100 rounded-full h-2">
            <div class="h-2 rounded-full transition-all duration-700" style="width: ${barWidth}%; background-color: ${player.color}"></div>
          </div>
        </div>
        <div class="text-right shrink-0">
          <div class="text-2xl font-bold text-gray-900">${player.totalPoints}</div>
          <div class="text-xs text-gray-400">${player.totalWins}W ${player.totalDraws}D ${player.totalLosses}L</div>
        </div>
      </div>
    `;
  }).join('');
}

function renderPlayerCards(scores) {
  const container = document.getElementById('players-content');

  container.innerHTML = scores.map(player => {
    const teamsHtml = player.teamResults.map(team => {
      const flag = getFlagImg(team.name);
      const champBadge = team.isChampion ? '<span class="ml-1 text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded-full font-medium">Champion +3</span>' : '';
      const record = team.matches.length > 0
        ? `<span class="text-xs text-gray-400">${team.wins}W ${team.draws}D ${team.losses}L</span>`
        : '<span class="text-xs text-gray-300">No matches yet</span>';
      const price = TEAM_PRICES[team.name] || 0;

      return `
        <div class="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-gray-50 transition-colors">
          <div class="flex items-center gap-2">
            ${flag}
            <span class="text-sm font-medium text-gray-700">${team.name}</span>
            <span class="text-xs text-gray-400">&yen;${price.toLocaleString()}</span>
            ${champBadge}
          </div>
          <div class="flex items-center gap-3">
            ${record}
            <span class="font-bold text-sm ${team.totalPoints > 0 ? 'text-gray-900' : 'text-gray-300'}">${team.totalPoints}</span>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div class="p-4 border-b border-gray-50 flex items-center gap-3">
          <div class="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold" style="background-color: ${player.color}">
            ${player.initials}
          </div>
          <div>
            <div class="font-bold text-gray-900">${player.name}</div>
            <div class="text-sm text-gray-500">${player.teams.length} teams</div>
          </div>
          <div class="ml-auto text-right">
            <div class="text-2xl font-bold text-gray-900">${player.totalPoints}</div>
            <div class="text-xs text-gray-400">${player.totalWins}W ${player.totalDraws}D ${player.totalLosses}L</div>
          </div>
        </div>
        <div class="p-3 divide-y divide-gray-50">
          ${teamsHtml}
        </div>
      </div>
    `;
  }).join('');
}

function renderMatches() {
  renderMatchList('results-content', 'finished');
  renderMatchList('upcoming-content', 'upcoming');
}

function renderMatchList(containerId, type) {
  const container = document.getElementById(containerId);
  if (!container) return;

  let filtered = allMatches.filter(m => {
    if (type === 'finished') return isFinished(m);
    return !isFinished(m) && isRealTeam(m.team1) && isRealTeam(m.team2);
  });

  // Apply stage filter
  if (filterStage !== 'all') {
    filtered = filtered.filter(m => getStageFromRound(m.round) === filterStage);
  }

  // Apply player filter
  if (filterPlayer !== 'all') {
    const player = PLAYERS.find(p => p.id === filterPlayer);
    if (player) {
      filtered = filtered.filter(m => {
        const home = normalizeTeamName(m.team1);
        const away = normalizeTeamName(m.team2);
        return player.teams.includes(home) || player.teams.includes(away);
      });
    }
  }

  // Sort: finished = most recent first, upcoming = soonest first
  filtered.sort((a, b) => {
    const dateA = parseMatchDateTime(a.date, a.time);
    const dateB = parseMatchDateTime(b.date, b.time);
    return type === 'finished' ? dateB - dateA : dateA - dateB;
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="text-center py-12 text-gray-400">
        <div class="text-4xl mb-2">&#9917;</div>
        <div>${type === 'finished' ? 'No completed matches yet' : 'No upcoming matches scheduled'}</div>
      </div>
    `;
    return;
  }

  // Group by date (JST)
  const grouped = {};
  for (const match of filtered) {
    const matchDate = parseMatchDateTime(match.date, match.time);
    const date = formatDateGroupJST(matchDate);
    if (!grouped[date]) grouped[date] = [];
    grouped[date].push(match);
  }

  container.innerHTML = Object.entries(grouped).map(([date, matches]) => {
    const matchCards = matches.map(m => renderMatchCard(m, type)).join('');
    return `
      <div class="mb-6">
        <div class="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3 px-1">${date}</div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          ${matchCards}
        </div>
      </div>
    `;
  }).join('');
}

function renderMatchCard(match, type) {
  const home = normalizeTeamName(match.team1);
  const away = normalizeTeamName(match.team2);
  const homeFlag = getFlagImg(home, 'inline-block w-8 h-6 object-cover rounded');
  const awayFlag = getFlagImg(away, 'inline-block w-8 h-6 object-cover rounded');
  const homePlayer = TEAM_TO_PLAYER[home];
  const awayPlayer = TEAM_TO_PLAYER[away];

  const homePlayerBadge = homePlayer
    ? `<span class="text-xs px-1.5 py-0.5 rounded-full text-white" style="background-color: ${homePlayer.color}">${homePlayer.initials}</span>`
    : '';
  const awayPlayerBadge = awayPlayer
    ? `<span class="text-xs px-1.5 py-0.5 rounded-full text-white" style="background-color: ${awayPlayer.color}">${awayPlayer.initials}</span>`
    : '';

  const stage = getStageFromRound(match.round);
  const stageLabel = formatStage(stage);
  const groupLabel = match.group ? ` &middot; ${match.group}` : '';
  const groundLabel = match.ground ? ` &middot; ${match.ground}` : '';
  const matchDate = parseMatchDateTime(match.date, match.time);
  const time = match.time ? formatTimeJST(matchDate) : '';

  if (type === 'finished') {
    const display = getDisplayScore(match);
    const winner = getMatchWinner(match);
    const homeWin = winner === 'team1';
    const awayWin = winner === 'team2';
    const isDraw = winner === 'draw';
    const penaltyLabel = display.penalties
      ? `<span class="text-xs text-gray-400">(pens ${display.penalties[0]}-${display.penalties[1]})</span>`
      : '';
    const etLabel = match.score.et && !display.penalties
      ? '<span class="text-xs text-gray-400">(aet)</span>'
      : '';

    return `
      <div class="bg-white rounded-xl border border-gray-100 shadow-sm p-4 hover:shadow-md transition-shadow">
        <div class="flex items-center justify-between mb-3">
          <span class="text-xs font-medium text-gray-400 uppercase">${stageLabel}${groupLabel}</span>
          <span class="text-xs text-gray-400">${match.ground || ''}</span>
        </div>
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2 flex-1 min-w-0">
            ${homeFlag}
            <span class="font-medium text-sm ${homeWin ? 'text-gray-900 font-bold' : 'text-gray-500'} truncate">${home}</span>
            ${homePlayerBadge}
          </div>
          <div class="px-3 flex flex-col items-center shrink-0">
            <div class="flex items-center gap-1.5">
              <span class="text-xl font-bold ${homeWin ? 'text-gray-900' : 'text-gray-400'}">${display.home}</span>
              <span class="text-gray-300">-</span>
              <span class="text-xl font-bold ${awayWin ? 'text-gray-900' : 'text-gray-400'}">${display.away}</span>
            </div>
            ${penaltyLabel}${etLabel}
          </div>
          <div class="flex items-center gap-2 flex-1 min-w-0 justify-end">
            ${awayPlayerBadge}
            <span class="font-medium text-sm ${awayWin ? 'text-gray-900 font-bold' : 'text-gray-500'} truncate">${away}</span>
            ${awayFlag}
          </div>
        </div>
        ${isDraw ? '<div class="text-center mt-2"><span class="text-xs bg-yellow-50 text-yellow-600 px-2 py-0.5 rounded-full">Draw</span></div>' : ''}
      </div>
    `;
  } else {
    return `
      <div class="bg-white rounded-xl border border-gray-100 shadow-sm p-4 hover:shadow-md transition-shadow">
        <div class="flex items-center justify-between mb-3">
          <span class="text-xs font-medium text-gray-400 uppercase">${stageLabel}${groupLabel}</span>
          <span class="text-xs font-medium text-blue-500">${time || match.ground || ''}</span>
        </div>
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2 flex-1 min-w-0">
            ${homeFlag}
            <span class="font-medium text-sm text-gray-700 truncate">${home}</span>
            ${homePlayerBadge}
          </div>
          <div class="px-4 shrink-0">
            <span class="text-sm font-medium text-gray-400">vs</span>
          </div>
          <div class="flex items-center gap-2 flex-1 min-w-0 justify-end">
            ${awayPlayerBadge}
            <span class="font-medium text-sm text-gray-700 truncate">${away}</span>
            ${awayFlag}
          </div>
        </div>
      </div>
    `;
  }
}

function renderTeamStandings(scores) {
  const container = document.getElementById('teams-content');
  if (!container) return;

  const allTeams = [];
  for (const player of scores) {
    for (const team of player.teamResults) {
      allTeams.push({
        ...team,
        player: { name: player.name, initials: player.initials, color: player.color, id: player.id }
      });
    }
  }

  // Sort teams
  allTeams.sort((a, b) => {
    let va, vb;
    switch (teamSortCol) {
      case 'name': va = a.name; vb = b.name; return teamSortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
      case 'player': va = a.player.name; vb = b.player.name; return teamSortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
      case 'played': va = a.matches.length; vb = b.matches.length; break;
      case 'wins': va = a.wins; vb = b.wins; break;
      case 'draws': va = a.draws; vb = b.draws; break;
      case 'losses': va = a.losses; vb = b.losses; break;
      case 'gf': va = a.goalsFor; vb = b.goalsFor; break;
      case 'ga': va = a.goalsAgainst; vb = b.goalsAgainst; break;
      case 'gd': va = a.goalsFor - a.goalsAgainst; vb = b.goalsFor - b.goalsAgainst; break;
      case 'price': va = TEAM_PRICES[a.name] || 0; vb = TEAM_PRICES[b.name] || 0; break;
      case 'eff': va = calcEFF(a.totalPoints, TEAM_PRICES[a.name] || 0); vb = calcEFF(b.totalPoints, TEAM_PRICES[b.name] || 0); break;
      default: va = a.totalPoints; vb = b.totalPoints; break;
    }
    const diff = teamSortAsc ? va - vb : vb - va;
    return diff || b.totalPoints - a.totalPoints || b.wins - a.wins;
  });

  const tableRows = allTeams.map((team, i) => {
    const flag = getFlagImg(team.name);
    const expanded = expandedTeams.has(team.name);
    const champBadge = team.isChampion ? ' <span class="text-yellow-500">&#9733;</span>' : '';
    const gd = team.goalsFor - team.goalsAgainst;
    const chevron = `<span class="text-gray-300 text-xs">${expanded ? '&#9660;' : '&#9654;'}</span>`;
    const price = TEAM_PRICES[team.name] || 0;
    const ppky = calcEFF(team.totalPoints, price);

    let matchHistory = '';
    if (expanded) {
      matchHistory = `
        <tr><td colspan="14" class="px-6 py-3 bg-gray-50 border-l-4" style="border-left-color: ${team.player.color}">
          ${renderTeamMatchHistory(team)}
        </td></tr>
      `;
    }

    return `
      <tr class="hover:bg-gray-50 cursor-pointer transition-colors" onclick="toggleTeamHistory('${team.name.replace(/'/g, "\\'")}')">
        <td class="py-3 px-3 text-sm text-gray-400 w-8">${chevron}</td>
        <td class="py-3 px-2 text-sm text-gray-400">${i + 1}</td>
        <td class="py-3 px-3">
          <div class="flex items-center gap-2">
            ${flag}
            <span class="text-sm font-medium text-gray-900">${team.name}</span>
            ${champBadge}
          </div>
        </td>
        <td class="py-3 px-3">
          <span class="text-xs px-2 py-1 rounded-full text-white" style="background-color: ${team.player.color}">${team.player.initials}</span>
        </td>
        <td class="text-center py-3 px-2 text-sm text-gray-700">${team.matches.length}</td>
        <td class="text-center py-3 px-2 text-sm text-gray-700">${team.wins}</td>
        <td class="text-center py-3 px-2 text-sm text-gray-700">${team.draws}</td>
        <td class="text-center py-3 px-2 text-sm text-gray-700">${team.losses}</td>
        <td class="text-center py-3 px-2 text-sm text-gray-700">${team.goalsFor}</td>
        <td class="text-center py-3 px-2 text-sm text-gray-700">${team.goalsAgainst}</td>
        <td class="text-center py-3 px-2 text-sm font-medium ${gd > 0 ? 'text-green-600' : gd < 0 ? 'text-red-500' : 'text-gray-400'}">${gd > 0 ? '+' : ''}${gd}</td>
        <td class="text-right py-3 px-2 text-sm font-bold text-gray-900">${team.totalPoints}</td>
        <td class="text-right py-3 px-2 text-sm text-gray-500">&yen;${price.toLocaleString()}</td>
        <td class="text-right py-3 px-4 text-sm font-medium ${ppky > 0 ? 'text-blue-600' : 'text-gray-300'}">${formatEFF(ppky)}</td>
      </tr>
      ${matchHistory}
    `;
  }).join('');

  container.innerHTML = `
    <div class="bg-white rounded-xl border border-gray-100 shadow-sm overflow-x-auto">
      <table class="w-full min-w-[850px]">
        <thead>
          <tr class="bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wider">
            <th class="py-3 px-3 w-8"></th>
            <th class="text-left py-3 px-2">#</th>
            ${sortableHeader('name', 'Team', 'text-left py-3 px-3')}
            ${sortableHeader('player', 'Player', 'text-left py-3 px-3')}
            ${sortableHeader('played', 'P', 'text-center py-3 px-2')}
            ${sortableHeader('wins', 'W', 'text-center py-3 px-2')}
            ${sortableHeader('draws', 'D', 'text-center py-3 px-2')}
            ${sortableHeader('losses', 'L', 'text-center py-3 px-2')}
            ${sortableHeader('gf', 'GF', 'text-center py-3 px-2')}
            ${sortableHeader('ga', 'GA', 'text-center py-3 px-2')}
            ${sortableHeader('gd', 'GD', 'text-center py-3 px-2')}
            ${sortableHeader('totalPoints', 'Pts', 'text-right py-3 px-2')}
            ${sortableHeader('price', 'Price', 'text-right py-3 px-2')}
            ${sortableHeader('eff', 'Value', 'text-right py-3 px-4')}
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-50">
          ${tableRows}
        </tbody>
      </table>
    </div>
  `;
}

function renderTeamMatchHistory(team) {
  if (team.matches.length === 0) {
    return '<div class="text-sm text-gray-400 text-center py-3">No matches played yet</div>';
  }

  return `<div class="divide-y divide-gray-100">
    ${team.matches.map(m => {
      const opponentFlag = getFlagImg(m.opponent, 'inline-block w-5 h-3.5 object-cover rounded-sm');
      const resultClass = m.result === 'W' ? 'bg-green-100 text-green-700' : m.result === 'D' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-600';
      const dateStr = formatDateShortJST(parseMatchDateTime(m.date, m.time));
      const stageLabel = formatStage(m.stage);

      return `
        <div class="flex items-center justify-between py-2">
          <div class="flex items-center gap-3">
            <span class="text-xs text-gray-400 w-16">${dateStr}</span>
            <span class="text-xs font-bold px-1.5 py-0.5 rounded ${resultClass}">${m.result}</span>
            <div class="flex items-center gap-1.5">
              ${opponentFlag}
              <span class="text-sm text-gray-700">${m.opponent}</span>
            </div>
          </div>
          <div class="flex items-center gap-3">
            <span class="text-xs text-gray-400">${stageLabel}</span>
            <span class="text-sm font-medium text-gray-900">${m.gf} - ${m.ga}</span>
            <span class="text-xs font-medium ${m.points > 0 ? 'text-green-600' : 'text-gray-400'}">+${m.points}</span>
          </div>
        </div>
      `;
    }).join('')}
  </div>`;
}

// ============================================================
// Groups
// ============================================================

function renderGroups() {
  const container = document.getElementById('groups-content');
  if (!container) return;

  // Build group data: teams, standings, matches
  const groupMap = {};
  for (const match of allMatches) {
    if (!match.group) continue;
    if (!groupMap[match.group]) groupMap[match.group] = { matches: [], teams: new Set() };
    groupMap[match.group].matches.push(match);
    if (isRealTeam(match.team1)) groupMap[match.group].teams.add(normalizeTeamName(match.team1));
    if (isRealTeam(match.team2)) groupMap[match.group].teams.add(normalizeTeamName(match.team2));
  }

  const groupNames = Object.keys(groupMap).sort();

  container.innerHTML = `<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
    ${groupNames.map(groupName => {
      const group = groupMap[groupName];
      const teams = [...group.teams];

      // Calculate standings for each team in this group
      const standings = teams.map(team => {
        let w = 0, d = 0, l = 0, gf = 0, ga = 0;
        for (const m of group.matches) {
          if (!isFinished(m)) continue;
          const home = normalizeTeamName(m.team1);
          const away = normalizeTeamName(m.team2);
          const isHome = home === team;
          const isAway = away === team;
          if (!isHome && !isAway) continue;

          const [hg, ag] = m.score.ft;
          gf += isHome ? hg : ag;
          ga += isHome ? ag : hg;

          const winner = getMatchWinner(m);
          if (winner === 'draw') d++;
          else if ((isHome && winner === 'team1') || (isAway && winner === 'team2')) w++;
          else l++;
        }
        return { team, w, d, l, gf, ga, gd: gf - ga, pts: w * 3 + d, played: w + d + l };
      }).sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);

      // Render standings table
      const standingsHtml = standings.map((s, i) => {
        const flag = getFlagImg(s.team, 'inline-block w-5 h-3.5 object-cover rounded-sm');
        const player = TEAM_TO_PLAYER[s.team];
        const playerBadge = player
          ? `<span class="text-xs px-1.5 py-0.5 rounded-full text-white" style="background-color: ${player.color}">${player.initials}</span>`
          : '';
        const qualifiedStyle = i < 2 && s.played === 3 && player ? `border-left: 3px solid ${player.color}` : '';

        return `
          <tr style="${qualifiedStyle}">
            <td class="py-1.5 px-2">
              <div class="flex items-center gap-1.5">
                ${flag}
                <span class="text-sm font-medium text-gray-900">${s.team}</span>
                ${playerBadge}
              </div>
            </td>
            <td class="text-center py-1.5 px-1 text-sm text-gray-600">${s.played}</td>
            <td class="text-center py-1.5 px-1 text-sm text-gray-600">${s.w}</td>
            <td class="text-center py-1.5 px-1 text-sm text-gray-600">${s.d}</td>
            <td class="text-center py-1.5 px-1 text-sm text-gray-600">${s.l}</td>
            <td class="text-center py-1.5 px-1 text-sm text-gray-600">${s.gf}</td>
            <td class="text-center py-1.5 px-1 text-sm text-gray-600">${s.ga}</td>
            <td class="text-center py-1.5 px-1 text-sm font-medium ${s.gd > 0 ? 'text-green-600' : s.gd < 0 ? 'text-red-500' : 'text-gray-400'}">${s.gd > 0 ? '+' : ''}${s.gd}</td>
            <td class="text-center py-1.5 px-1 text-sm font-bold text-gray-900">${s.pts}</td>
          </tr>
        `;
      }).join('');

      // Render matches
      const matchesHtml = group.matches
        .sort((a, b) => new Date(a.date) - new Date(b.date))
        .map(m => {
          const home = normalizeTeamName(m.team1);
          const away = normalizeTeamName(m.team2);
          const hFlag = getFlagImg(home, 'inline-block w-5 h-3.5 object-cover rounded-sm');
          const aFlag = getFlagImg(away, 'inline-block w-5 h-3.5 object-cover rounded-sm');

          if (isFinished(m)) {
            const [hg, ag] = m.score.ft;
            const winner = getMatchWinner(m);
            const homeWin = winner === 'team1';
            const awayWin = winner === 'team2';
            return `
              <div class="flex items-center justify-between py-1.5 text-sm">
                <div class="flex items-center gap-1.5 flex-1">
                  ${hFlag}
                  <span class="${homeWin ? 'font-bold text-gray-900' : 'text-gray-500'}">${home}</span>
                </div>
                <span class="font-bold text-gray-900 px-2">${hg} - ${ag}</span>
                <div class="flex items-center gap-1.5 flex-1 justify-end">
                  <span class="${awayWin ? 'font-bold text-gray-900' : 'text-gray-500'}">${away}</span>
                  ${aFlag}
                </div>
              </div>
            `;
          } else {
            return `
              <div class="flex items-center justify-between py-1.5 text-sm text-gray-400">
                <div class="flex items-center gap-1.5 flex-1">${hFlag} ${home}</div>
                <span class="px-2">vs</span>
                <div class="flex items-center gap-1.5 flex-1 justify-end">${away} ${aFlag}</div>
              </div>
            `;
          }
        }).join('');

      return `
        <div class="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div class="px-4 py-3 bg-gray-50 border-b border-gray-100">
            <h3 class="font-bold text-gray-900">${groupName}</h3>
          </div>
          <div class="px-3 py-2">
            <table class="w-full">
              <thead>
                <tr class="text-xs text-gray-400 uppercase">
                  <th class="text-left py-1 px-2">Team</th>
                  <th class="text-center py-1 px-1">P</th>
                  <th class="text-center py-1 px-1">W</th>
                  <th class="text-center py-1 px-1">D</th>
                  <th class="text-center py-1 px-1">L</th>
                  <th class="text-center py-1 px-1">GF</th>
                  <th class="text-center py-1 px-1">GA</th>
                  <th class="text-center py-1 px-1">GD</th>
                  <th class="text-center py-1 px-1">Pts</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-50">
                ${standingsHtml}
              </tbody>
            </table>
          </div>
          <div class="px-4 py-3 border-t border-gray-100">
            <div class="text-xs font-semibold text-gray-400 uppercase mb-2">Matches</div>
            <div class="divide-y divide-gray-50">
              ${matchesHtml}
            </div>
          </div>
        </div>
      `;
    }).join('')}
  </div>`;
}

// ============================================================
// Bracket
// ============================================================

function orderRoundByFeeders(roundMatches, nextRoundMatches, allMatchesByNum) {
  // Reorder matches in a round so adjacent pairs align with next round matches.
  // For each next-round match, find the two feeder matches from this round.
  const byNum = {};
  for (const m of roundMatches) byNum[m.num] = m;

  const ordered = [];
  const placed = new Set();

  for (const nextMatch of nextRoundMatches) {
    const nextTeams = [normalizeTeamName(nextMatch.team1), normalizeTeamName(nextMatch.team2)];
    const feeders = [];

    // Method 1: match winners to next round team names
    for (const m of roundMatches) {
      if (placed.has(m.num)) continue;
      if (!isFinished(m)) continue;
      const winner = getMatchWinner(m);
      const winnerName = winner === 'team1' ? normalizeTeamName(m.team1) : normalizeTeamName(m.team2);
      if (nextTeams.includes(winnerName)) {
        feeders.push(m);
      }
    }

    // Method 2: placeholder references like "W73"
    if (feeders.length < 2) {
      for (const tName of [nextMatch.team1, nextMatch.team2]) {
        const ref = tName.match(/^W(\d+)$/);
        if (ref) {
          const feeder = byNum[parseInt(ref[1])];
          if (feeder && !feeders.find(f => f.num === feeder.num)) {
            feeders.push(feeder);
          }
        }
      }
    }

    if (feeders.length === 2) {
      feeders.sort((a, b) => a.num - b.num);
      for (const f of feeders) { ordered.push(f); placed.add(f.num); }
    }
  }

  // Add any remaining matches not placed
  for (const m of roundMatches) {
    if (!placed.has(m.num)) ordered.push(m);
  }
  return ordered;
}

function renderBracket() {
  const container = document.getElementById('bracket-content');
  if (!container) return;

  // Organize knockout matches by round
  const rounds = {};
  for (const match of allMatches) {
    const round = match.round;
    if (!round || round.startsWith('Matchday')) continue;
    if (!rounds[round]) rounds[round] = [];
    rounds[round].push(match);
  }
  for (const r in rounds) {
    rounds[r].sort((a, b) => (a.num || 0) - (b.num || 0));
  }

  const r32Raw = rounds['Round of 32'] || [];
  const r16Raw = rounds['Round of 16'] || [];
  const qfRaw = rounds['Quarter-final'] || [];
  const sfRaw = rounds['Semi-final'] || [];
  const final = rounds['Final'] || [];
  const third = rounds['Match for third place'] || [];

  const allByNum = {};
  for (const m of allMatches) if (m.num) allByNum[m.num] = m;

  // Order each round to align with the next round's pairings
  const qf = qfRaw; // QFs already sorted by num
  const r16 = orderRoundByFeeders(r16Raw, qf, allByNum);
  const r32 = orderRoundByFeeders(r32Raw, r16, allByNum);
  const sf = sfRaw;

  // Desktop bracket (horizontal)
  function renderRoundColumn(matches, label) {
    return `
      <div class="bracket-round">
        <div class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 text-center">${label}</div>
        <div class="flex flex-col justify-around flex-1 gap-1">
          ${matches.map(m => `
            <div class="bracket-match-wrapper flex-1 flex items-center">
              <div class="bracket-match">${renderBracketMatch(m)}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  function renderConnectors(count) {
    const pairs = [];
    for (let i = 0; i < count; i++) {
      pairs.push(`
        <div class="bracket-pair flex-1 flex flex-col">
          <div class="flex-1 flex items-center"><div class="bracket-connector-right w-6"></div></div>
          <div class="flex-1 flex items-center"><div class="bracket-connector-right w-6"></div></div>
        </div>
      `);
    }
    return `<div class="flex flex-col justify-around">${pairs.join('')}</div>`;
  }

  function renderLeftConnectors(count) {
    return `<div class="flex flex-col justify-around">
      ${Array(count).fill(`<div class="flex-1 flex items-center"><div class="bracket-connector-left w-6"></div></div>`).join('')}
    </div>`;
  }

  // Mobile bracket (vertical, round by round)
  function renderMobileRound(matches, label) {
    return `
      <div class="mb-6">
        <div class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">${label}</div>
        <div class="grid grid-cols-2 gap-2">
          ${matches.map(m => `<div>${renderBracketMatch(m)}</div>`).join('')}
        </div>
      </div>
    `;
  }

  const desktopBracket = `
    <div class="bracket hidden md:flex pb-4" style="min-height: 900px; min-width: 1400px;">
      ${r32.length > 0 ? renderRoundColumn(r32, 'Round of 32') : ''}
      ${r32.length > 0 && r16.length > 0 ? renderConnectors(8) : ''}
      ${r16.length > 0 && r32.length > 0 ? renderLeftConnectors(8) : ''}
      ${r16.length > 0 ? renderRoundColumn(r16, 'Round of 16') : ''}
      ${r16.length > 0 && qf.length > 0 ? renderConnectors(4) : ''}
      ${qf.length > 0 ? renderLeftConnectors(4) : ''}
      ${qf.length > 0 ? renderRoundColumn(qf, 'Quarter-Finals') : ''}
      ${qf.length > 0 && sf.length > 0 ? renderConnectors(2) : ''}
      ${sf.length > 0 ? renderLeftConnectors(2) : ''}
      ${sf.length > 0 ? renderRoundColumn(sf, 'Semi-Finals') : ''}
      ${sf.length > 0 && final.length > 0 ? renderConnectors(1) : ''}
      ${final.length > 0 ? renderLeftConnectors(1) : ''}
      <div class="bracket-round">
        <div class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 text-center">Final</div>
        <div class="flex flex-col justify-center flex-1 gap-6">
          <div class="flex-1 flex items-center">
            <div class="bracket-match w-full">${final.length > 0 ? renderBracketMatch(final[0]) : ''}</div>
          </div>
          ${third.length > 0 ? `
            <div>
              <div class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 text-center">3rd Place</div>
              <div class="bracket-match">${renderBracketMatch(third[0])}</div>
            </div>
          ` : ''}
        </div>
      </div>
    </div>
  `;

  const mobileBracket = `
    <div class="md:hidden">
      ${r32.length > 0 ? renderMobileRound(r32, 'Round of 32') : ''}
      ${r16.length > 0 ? renderMobileRound(r16, 'Round of 16') : ''}
      ${qf.length > 0 ? renderMobileRound(qf, 'Quarter-Finals') : ''}
      ${sf.length > 0 ? renderMobileRound(sf, 'Semi-Finals') : ''}
      ${final.length > 0 ? `
        <div class="mb-6">
          <div class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Final</div>
          <div>${renderBracketMatch(final[0])}</div>
        </div>
      ` : ''}
      ${third.length > 0 ? `
        <div class="mb-6">
          <div class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">3rd Place</div>
          <div>${renderBracketMatch(third[0])}</div>
        </div>
      ` : ''}
    </div>
  `;

  container.innerHTML = desktopBracket + mobileBracket;
}

function renderBracketMatch(match) {
  const team1 = isRealTeam(match.team1) ? normalizeTeamName(match.team1) : match.team1;
  const team2 = isRealTeam(match.team2) ? normalizeTeamName(match.team2) : match.team2;
  const flag1 = isRealTeam(match.team1) ? getFlagImg(team1, 'inline-block w-5 h-3.5 object-cover rounded-sm') : '';
  const flag2 = isRealTeam(match.team2) ? getFlagImg(team2, 'inline-block w-5 h-3.5 object-cover rounded-sm') : '';
  const player1 = isRealTeam(match.team1) ? TEAM_TO_PLAYER[team1] : null;
  const player2 = isRealTeam(match.team2) ? TEAM_TO_PLAYER[team2] : null;

  const p1Badge = player1 ? `<span class="text-xs px-1 py-0.5 rounded text-white leading-none" style="background-color: ${player1.color}">${player1.initials}</span>` : '';
  const p2Badge = player2 ? `<span class="text-xs px-1 py-0.5 rounded text-white leading-none" style="background-color: ${player2.color}">${player2.initials}</span>` : '';

  const displayName1 = isRealTeam(match.team1) ? team1 : 'TBD';
  const displayName2 = isRealTeam(match.team2) ? team2 : 'TBD';

  if (isFinished(match)) {
    const display = getDisplayScore(match);
    const winner = getMatchWinner(match);
    const t1Win = winner === 'team1';
    const t2Win = winner === 'team2';
    const penLabel = display.penalties ? ` <span class="text-xs text-gray-400">(${display.penalties[0]}-${display.penalties[1]}p)</span>` : '';
    const etLabel = match.score.et && !display.penalties ? ' <span class="text-xs text-gray-400">aet</span>' : '';

    const t1BarStyle = t1Win && player1 ? `border-left: 3px solid ${player1.color}` : '';
    const t2BarStyle = t2Win && player2 ? `border-left: 3px solid ${player2.color}` : '';

    return `
      <div class="bg-white rounded-lg border border-gray-100 shadow-sm overflow-hidden text-sm">
        <div class="flex items-center justify-between px-3 py-2 border-b border-gray-50" style="${t1BarStyle}">
          <div class="flex items-center gap-1.5 flex-1 min-w-0">
            ${flag1}
            <span class="${t1Win ? 'font-bold text-gray-900' : 'text-gray-400'} truncate">${displayName1}</span>
            ${p1Badge}
          </div>
          <span class="font-bold ${t1Win ? 'text-gray-900' : 'text-gray-400'} ml-2">${display.home}</span>
        </div>
        <div class="flex items-center justify-between px-3 py-2" style="${t2BarStyle}">
          <div class="flex items-center gap-1.5 flex-1 min-w-0">
            ${flag2}
            <span class="${t2Win ? 'font-bold text-gray-900' : 'text-gray-400'} truncate">${displayName2}</span>
            ${p2Badge}
          </div>
          <span class="font-bold ${t2Win ? 'text-gray-900' : 'text-gray-400'} ml-2">${display.away}</span>
        </div>
        ${penLabel || etLabel ? `<div class="text-center text-xs text-gray-400 py-0.5 bg-gray-50 border-t border-gray-50">${penLabel}${etLabel}</div>` : ''}
      </div>
    `;
  } else {
    return `
      <div class="bg-white rounded-lg border border-gray-200 border-dashed shadow-sm overflow-hidden text-sm">
        <div class="flex items-center justify-between px-3 py-2 border-b border-gray-50">
          <div class="flex items-center gap-1.5 flex-1 min-w-0">
            ${flag1}
            <span class="text-gray-500 truncate">${displayName1}</span>
            ${p1Badge}
          </div>
        </div>
        <div class="flex items-center justify-between px-3 py-2">
          <div class="flex items-center gap-1.5 flex-1 min-w-0">
            ${flag2}
            <span class="text-gray-500 truncate">${displayName2}</span>
            ${p2Badge}
          </div>
        </div>
      </div>
    `;
  }
}

// ============================================================
// Sortable Table Helpers
// ============================================================

function sortableHeader(col, label, classes) {
  const isActive = teamSortCol === col;
  const arrow = isActive ? (teamSortAsc ? ' &#9650;' : ' &#9660;') : '';
  const activeClass = isActive ? 'text-blue-600' : '';
  return `<th class="${classes} cursor-pointer hover:text-blue-500 select-none ${activeClass}" onclick="sortTeamsBy('${col}')">${label}${arrow}</th>`;
}

function sortTeamsBy(col) {
  if (teamSortCol === col) {
    teamSortAsc = !teamSortAsc;
  } else {
    teamSortCol = col;
    teamSortAsc = col === 'name' || col === 'player'; // default ascending for text, descending for numbers
  }
  const scores = calculatePlayerScores(allMatches);
  renderTeamStandings(scores);
}

// ============================================================
// Charts
// ============================================================

let pointsChart = null;
let positionChart = null;

function buildTimelineData() {
  // Get all unique match dates (finished matches only), sorted chronologically
  const finishedMatches = allMatches.filter(m => isFinished(m));
  const dateSet = new Set();
  for (const m of finishedMatches) {
    dateSet.add(m.date);
  }
  const dates = [...dateSet].sort();

  if (dates.length === 0) return null;

  // For each date, calculate cumulative points for each player
  const playerTimelines = PLAYERS.map(player => {
    const pointsByDate = [];
    let cumulative = 0;

    for (const date of dates) {
      // Get matches on this date involving this player's teams
      const dayMatches = finishedMatches.filter(m => m.date === date);
      let dayPoints = 0;

      for (const match of dayMatches) {
        const home = normalizeTeamName(match.team1);
        const away = normalizeTeamName(match.team2);
        const isHome = player.teams.includes(home);
        const isAway = player.teams.includes(away);
        if (!isHome && !isAway) continue;

        const winner = getMatchWinner(match);
        if (winner === 'draw') {
          dayPoints += 1;
        } else if (
          (isHome && winner === 'team1') ||
          (isAway && winner === 'team2')
        ) {
          dayPoints += 3;
        }
      }

      cumulative += dayPoints;
      pointsByDate.push(cumulative);
    }

    return {
      player,
      points: pointsByDate
    };
  });

  // Calculate positions at each date
  const positionTimelines = PLAYERS.map((_, pi) => []);
  for (let di = 0; di < dates.length; di++) {
    // Get points at this date for all players, sort descending
    const standings = playerTimelines.map((pt, pi) => ({
      pi,
      pts: pt.points[di]
    })).sort((a, b) => b.pts - a.pts);

    // Assign ranks with ties
    let rank = 1;
    for (let i = 0; i < standings.length; i++) {
      if (i > 0 && standings[i].pts < standings[i - 1].pts) {
        rank = i + 1;
      }
      positionTimelines[standings[i].pi].push(rank);
    }
  }

  // Format date labels
  const labels = dates.map(d => {
    const dateObj = new Date(d + 'T12:00:00+09:00');
    return formatDateShortJST(dateObj);
  });

  return { labels, playerTimelines, positionTimelines };
}

function renderCharts() {
  const data = buildTimelineData();
  if (!data) return;

  const { labels, playerTimelines, positionTimelines } = data;

  // Destroy existing charts
  if (pointsChart) { pointsChart.destroy(); pointsChart = null; }
  if (positionChart) { positionChart.destroy(); positionChart = null; }

  const pointsCtx = document.getElementById('points-chart');
  const positionCtx = document.getElementById('position-chart');
  if (!pointsCtx || !positionCtx) return;

  const dark = isDarkMode();
  const tickColor = dark ? '#9ca3af' : undefined;
  const titleColor = dark ? '#d1d5db' : undefined;
  const legendColor = dark ? '#d1d5db' : undefined;

  const commonOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: 'index',
      intersect: false,
    },
    plugins: {
      legend: {
        position: 'bottom',
        labels: {
          usePointStyle: true,
          padding: 16,
          color: legendColor,
          font: { family: 'Inter, system-ui, sans-serif', size: 12 }
        }
      }
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { color: tickColor, font: { family: 'Inter, system-ui, sans-serif', size: 10 }, maxRotation: 45 }
      }
    }
  };

  // Points chart
  pointsChart = new Chart(pointsCtx, {
    type: 'line',
    data: {
      labels,
      datasets: playerTimelines.map(pt => ({
        label: pt.player.name,
        data: pt.points,
        borderColor: pt.player.color,
        backgroundColor: pt.player.color + '20',
        borderWidth: 2.5,
        pointRadius: 0,
        pointHoverRadius: 4,
        tension: 0.3,
        fill: false,
      }))
    },
    options: {
      ...commonOptions,
      scales: {
        ...commonOptions.scales,
        y: {
          beginAtZero: true,
          grid: { color: isDarkMode() ? '#374151' : '#f3f4f6' },
          ticks: {
            stepSize: 3,
            color: tickColor,
            font: { family: 'Inter, system-ui, sans-serif', size: 11 }
          },
          title: {
            display: true,
            text: 'Total Points',
            color: titleColor,
            font: { family: 'Inter, system-ui, sans-serif', size: 12, weight: '600' }
          }
        }
      }
    }
  });

  // Position chart (inverted y-axis: 1st at top)
  positionChart = new Chart(positionCtx, {
    type: 'line',
    data: {
      labels,
      datasets: PLAYERS.map((player, pi) => ({
        label: player.name,
        data: positionTimelines[pi],
        borderColor: player.color,
        backgroundColor: player.color + '20',
        borderWidth: 2.5,
        pointRadius: 0,
        pointHoverRadius: 4,
        tension: 0.3,
        fill: false,
      }))
    },
    options: {
      ...commonOptions,
      scales: {
        ...commonOptions.scales,
        y: {
          reverse: true,
          min: 0.5,
          max: PLAYERS.length + 0.5,
          grid: { color: isDarkMode() ? '#374151' : '#f3f4f6' },
          ticks: {
            stepSize: 1,
            color: tickColor,
            font: { family: 'Inter, system-ui, sans-serif', size: 11 },
            callback: (val) => {
              const suffixes = { 1: 'st', 2: 'nd', 3: 'rd' };
              return val + (suffixes[val] || 'th');
            }
          },
          title: {
            display: true,
            text: 'Position',
            color: titleColor,
            font: { family: 'Inter, system-ui, sans-serif', size: 12, weight: '600' }
          }
        }
      }
    }
  });
}

// ============================================================
// Dark Mode
// ============================================================

function isDarkMode() {
  return document.documentElement.classList.contains('dark');
}

function toggleDarkMode() {
  const dark = !isDarkMode();
  document.documentElement.classList.toggle('dark', dark);
  localStorage.setItem('wc26_theme', dark ? 'dark' : 'light');
  updateDarkModeBtn();
  // Re-render charts with correct colors
  renderCharts();
}

function updateDarkModeBtn() {
  const btn = document.getElementById('dark-mode-btn');
  if (btn) {
    btn.innerHTML = isDarkMode() ? '&#9788;' : '&#9790;';
  }
}

// ============================================================
// UI Helpers
// ============================================================

function setActiveTab(tab, updateHash = true) {
  activeTab = tab;
  if (updateHash) {
    history.replaceState(null, '', '#' + tab);
  }
  document.querySelectorAll('[data-tab]').forEach(el => {
    const isActive = el.dataset.tab === tab;
    el.classList.toggle('border-blue-500', isActive);
    el.classList.toggle('text-blue-600', isActive);
    el.classList.toggle('border-transparent', !isActive);
    el.classList.toggle('text-gray-500', !isActive);
  });
  document.querySelectorAll('[data-section]').forEach(el => {
    el.classList.toggle('hidden', el.dataset.section !== tab);
  });
}

function toggleTeamHistory(teamName) {
  if (expandedTeams.has(teamName)) {
    expandedTeams.delete(teamName);
  } else {
    expandedTeams.add(teamName);
  }
  const scores = calculatePlayerScores(allMatches);
  renderTeamStandings(scores);
}

function showLoading(show) {
  const el = document.getElementById('loading');
  if (el) el.classList.toggle('hidden', !show);
}

function showError(msg) {
  const el = document.getElementById('error-banner');
  if (el) {
    el.textContent = msg;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 8000);
  }
}

function updateLastRefresh() {
  const el = document.getElementById('last-refresh');
  if (el) {
    el.textContent = `Updated ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: JST_TZ })} JST`;
  }
}

function applyFilters() {
  const stageSelect = document.getElementById('filter-stage');
  const playerSelect = document.getElementById('filter-player');
  if (stageSelect) filterStage = stageSelect.value;
  if (playerSelect) filterPlayer = playerSelect.value;
  renderMatches();
}

function toggleAutoRefresh() {
  const btn = document.getElementById('auto-refresh-btn');
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
    if (btn) {
      btn.classList.remove('bg-green-100', 'text-green-700');
      btn.classList.add('bg-gray-100', 'text-gray-600');
      btn.innerHTML = '&#8635; Auto-refresh: Off';
    }
  } else {
    autoRefreshInterval = setInterval(refreshData, CACHE_TTL);
    if (btn) {
      btn.classList.remove('bg-gray-100', 'text-gray-600');
      btn.classList.add('bg-green-100', 'text-green-700');
      btn.innerHTML = '&#8635; Auto-refresh: On';
    }
  }
}

function forceRefresh() {
  localStorage.removeItem(CACHE_KEY);
  refreshData();
}

// ============================================================
// Initialization
// ============================================================

async function refreshData() {
  allMatches = await fetchMatches();
  renderApp();
}

function getTabFromHash() {
  const hash = location.hash.replace('#', '');
  return VALID_TABS.includes(hash) ? hash : 'leaderboard';
}

document.addEventListener('DOMContentLoaded', () => {
  activeTab = getTabFromHash();
  updateDarkModeBtn();
  refreshData();
});

window.addEventListener('hashchange', () => {
  const tab = getTabFromHash();
  if (tab !== activeTab) {
    setActiveTab(tab, false);
  }
});
