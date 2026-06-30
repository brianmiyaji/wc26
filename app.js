// ============================================================
// WC26 Betting Pool - Application Logic
// ============================================================

const DATA_URL = 'https://raw.githubusercontent.com/openfootball/world-cup.json/master/2026/worldcup.json';
const CACHE_KEY = 'wc26_matches';
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

let allMatches = [];
let activeTab = 'leaderboard';
let filterStage = 'all';
let filterPlayer = 'all';
let expandedTeams = new Set();
let autoRefreshInterval = null;

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
  renderTeamStandings(scores);
  updateLastRefresh();
  setActiveTab(activeTab);
}

function renderLeaderboard(scores) {
  const container = document.getElementById('leaderboard-content');
  const maxPoints = scores[0]?.totalPoints || 1;

  container.innerHTML = scores.map((player, i) => {
    const rank = i + 1;
    const barWidth = maxPoints > 0 ? (player.totalPoints / maxPoints) * 100 : 0;
    const crownIcon = rank === 1 && player.totalPoints > 0 ? '<span class="text-yellow-500 mr-1">&#9818;</span>' : '';
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
            ${crownIcon}
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

      return `
        <div class="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-gray-50 transition-colors">
          <div class="flex items-center gap-2">
            ${flag}
            <span class="text-sm font-medium text-gray-700">${team.name}</span>
            ${champBadge}
          </div>
          <div class="flex items-center gap-3">
            ${record}
            <span class="font-bold text-sm ${team.totalPoints > 0 ? 'text-gray-900' : 'text-gray-300'}">${team.totalPoints} pts</span>
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
            <div class="text-xs text-gray-400">points</div>
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
    const dateA = new Date(a.date);
    const dateB = new Date(b.date);
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

  // Group by date
  const grouped = {};
  for (const match of filtered) {
    const dateObj = new Date(match.date + 'T00:00:00');
    const date = dateObj.toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
    });
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
  const time = match.time || '';

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

    const ytUrl = getYouTubeSearchUrl(home, away, 'highlights');

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
        <div class="flex items-center justify-between mt-3 pt-3 border-t border-gray-50">
          ${isDraw ? '<span class="text-xs bg-yellow-50 text-yellow-600 px-2 py-0.5 rounded-full">Draw</span>' : '<span></span>'}
          <a href="${ytUrl}" target="_blank" rel="noopener" class="inline-flex items-center gap-1.5 text-xs font-medium text-red-600 hover:text-red-700 transition-colors">
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814z"/><path fill="#fff" d="M9.545 15.568V8.432L15.818 12z"/></svg>
            Highlights
          </a>
        </div>
      </div>
    `;
  } else {
    const ytUrl = getYouTubeSearchUrl(home, away, 'preview');

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
        <div class="flex justify-end mt-3 pt-3 border-t border-gray-50">
          <a href="${ytUrl}" target="_blank" rel="noopener" class="inline-flex items-center gap-1.5 text-xs font-medium text-red-600 hover:text-red-700 transition-colors">
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814z"/><path fill="#fff" d="M9.545 15.568V8.432L15.818 12z"/></svg>
            Preview
          </a>
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

  allTeams.sort((a, b) => b.totalPoints - a.totalPoints || b.wins - a.wins || (b.goalsFor - b.goalsAgainst) - (a.goalsFor - a.goalsAgainst));

  const tableRows = allTeams.map((team, i) => {
    const flag = getFlagImg(team.name);
    const expanded = expandedTeams.has(team.name);
    const champBadge = team.isChampion ? ' <span class="text-yellow-500">&#9733;</span>' : '';
    const gd = team.goalsFor - team.goalsAgainst;
    const chevron = `<span class="text-gray-300 text-xs">${expanded ? '&#9660;' : '&#9654;'}</span>`;

    let matchHistory = '';
    if (expanded) {
      matchHistory = `
        <tr><td colspan="11" class="px-6 py-3 bg-gray-50 border-l-4" style="border-left-color: ${team.player.color}">
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
        <td class="text-right py-3 px-4 text-sm font-bold text-gray-900">${team.totalPoints}</td>
      </tr>
      ${matchHistory}
    `;
  }).join('');

  container.innerHTML = `
    <div class="bg-white rounded-xl border border-gray-100 shadow-sm overflow-x-auto">
      <table class="w-full min-w-[700px]">
        <thead>
          <tr class="bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wider">
            <th class="py-3 px-3 w-8"></th>
            <th class="text-left py-3 px-2">#</th>
            <th class="text-left py-3 px-3">Team</th>
            <th class="text-left py-3 px-3">Player</th>
            <th class="text-center py-3 px-2">P</th>
            <th class="text-center py-3 px-2">W</th>
            <th class="text-center py-3 px-2">D</th>
            <th class="text-center py-3 px-2">L</th>
            <th class="text-center py-3 px-2">GF</th>
            <th class="text-center py-3 px-2">GA</th>
            <th class="text-center py-3 px-2">GD</th>
            <th class="text-right py-3 px-4">Pts</th>
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
      const dateStr = new Date(m.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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
// UI Helpers
// ============================================================

function setActiveTab(tab) {
  activeTab = tab;
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
    el.textContent = `Updated ${new Date().toLocaleTimeString()}`;
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

document.addEventListener('DOMContentLoaded', () => {
  refreshData();
});
