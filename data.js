// ============================================================
// WC26 Betting Pool - Data Layer
// ============================================================

const PLAYERS = [
  {
    id: 'alex',
    name: 'Alex',
    initials: 'A',
    color: '#3B82F6',
    teams: ['USA', 'DR Congo', 'Canada', 'New Zealand', 'France', 'Japan']
  },
  {
    id: 'david',
    name: 'David R.',
    initials: 'DR',
    color: '#10B981',
    teams: ['Germany', 'Brazil', 'Jordan', 'Uzbekistan', 'Australia', 'South Africa', 'Mexico', 'Egypt', 'Austria', 'Iran', 'Qatar', 'Paraguay', 'Curaçao']
  },
  {
    id: 'julian',
    name: 'Jules/Tak',
    initials: 'JT',
    color: '#8B5CF6',
    teams: ['Ivory Coast', 'Norway', 'Ecuador', 'Belgium', 'Senegal', 'Turkey', 'Uruguay']
  },
  {
    id: 'matt',
    name: 'Matt',
    initials: 'M',
    color: '#F59E0B',
    teams: ['South Korea', 'Netherlands', 'Portugal', 'Croatia', 'Switzerland', 'Tunisia']
  },
  {
    id: 'dsk',
    name: 'DSK',
    initials: 'DSK',
    color: '#EF4444',
    teams: ['Panama', 'Saudi Arabia', 'England', 'Haiti', 'Argentina', 'Bosnia']
  },
  {
    id: 'patrick',
    name: 'Patrick',
    initials: 'P',
    color: '#EC4899',
    teams: ['Algeria', 'Scotland', 'Cape Verde', 'Sweden', 'Colombia', 'Morocco', 'Spain', 'Ghana', 'Iraq', 'Czech Republic']
  }
];

// Map from API team names to our display names
const API_TO_DISPLAY = {
  'Korea Republic': 'South Korea',
  'IR Iran': 'Iran',
  'Cabo Verde': 'Cape Verde',
  'Congo DR': 'DR Congo',
  "Côte d'Ivoire": 'Ivory Coast',
  'Czechia': 'Czech Republic',
  'Türkiye': 'Turkey',
  'Bosnia and Herzegovina': 'Bosnia',
  'Bosnia & Herzegovina': 'Bosnia',
  'Korea, Republic of': 'South Korea',
  'Iran, Islamic Republic of': 'Iran',
  'Cape Verde Islands': 'Cape Verde',
  'Congo, Democratic Republic of': 'DR Congo',
  'Ivory Coast': 'Ivory Coast',
  'Czech Republic': 'Czech Republic',
  'Curacao': 'Curaçao',
  'United States': 'USA',
  'United States of America': 'USA',
};

// ISO 3166-1 alpha-2 codes for flags (flagcdn.com)
const FLAG_CODES = {
  'USA': 'us',
  'DR Congo': 'cd',
  'Canada': 'ca',
  'New Zealand': 'nz',
  'France': 'fr',
  'Japan': 'jp',
  'Germany': 'de',
  'Brazil': 'br',
  'Jordan': 'jo',
  'Uzbekistan': 'uz',
  'Australia': 'au',
  'South Africa': 'za',
  'Mexico': 'mx',
  'Egypt': 'eg',
  'Austria': 'at',
  'Iran': 'ir',
  'Qatar': 'qa',
  'Paraguay': 'py',
  'Curaçao': 'cw',
  'Ivory Coast': 'ci',
  'Norway': 'no',
  'Ecuador': 'ec',
  'Belgium': 'be',
  'Senegal': 'sn',
  'Turkey': 'tr',
  'Uruguay': 'uy',
  'South Korea': 'kr',
  'Netherlands': 'nl',
  'Portugal': 'pt',
  'Croatia': 'hr',
  'Switzerland': 'ch',
  'Tunisia': 'tn',
  'Panama': 'pa',
  'Saudi Arabia': 'sa',
  'England': 'gb-eng',
  'Haiti': 'ht',
  'Argentina': 'ar',
  'Bosnia': 'ba',
  'Algeria': 'dz',
  'Scotland': 'gb-sct',
  'Cape Verde': 'cv',
  'Sweden': 'se',
  'Colombia': 'co',
  'Morocco': 'ma',
  'Spain': 'es',
  'Ghana': 'gh',
  'Iraq': 'iq',
  'Czech Republic': 'cz',
};

// Team prices (in yen)
const TEAM_PRICES = {
  'USA': 1000,
  'DR Congo': 300,
  'Canada': 1000,
  'New Zealand': 500,
  'France': 3900,
  'Japan': 1700,
  'Germany': 1300,
  'Brazil': 2000,
  'Jordan': 200,
  'Uzbekistan': 400,
  'Australia': 1100,
  'South Africa': 600,
  'Mexico': 1400,
  'Egypt': 800,
  'Austria': 500,
  'Iran': 400,
  'Qatar': 300,
  'Paraguay': 500,
  'Curaçao': 300,
  'Ivory Coast': 700,
  'Norway': 2400,
  'Ecuador': 1000,
  'Belgium': 2200,
  'Senegal': 1100,
  'Turkey': 1000,
  'Uruguay': 1700,
  'South Korea': 1000,
  'Netherlands': 2600,
  'Portugal': 3000,
  'Croatia': 1100,
  'Switzerland': 800,
  'Tunisia': 1500,
  'Panama': 500,
  'Saudi Arabia': 600,
  'England': 4000,
  'Haiti': 500,
  'Argentina': 3000,
  'Bosnia': 400,
  'Algeria': 400,
  'Scotland': 400,
  'Cape Verde': 300,
  'Sweden': 700,
  'Colombia': 1400,
  'Morocco': 1700,
  'Spain': 3300,
  'Ghana': 500,
  'Iraq': 300,
  'Czech Republic': 1000,
};

// Calculate EFF (Points Per Thousand Yen) - points / price * 1000
function calcEFF(points, price) {
  if (!price || points === 0) return 0;
  return points / price * 1000;
}

function formatEFF(ppky) {
  if (ppky === 0) return '0';
  const rounded = Math.round(ppky * 10) / 10;
  return rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1);
}

// Build reverse lookup: team name → player
const TEAM_TO_PLAYER = {};
for (const player of PLAYERS) {
  for (const team of player.teams) {
    TEAM_TO_PLAYER[team] = player;
  }
}

// Normalize an API team name to our display name
function normalizeTeamName(apiName) {
  return API_TO_DISPLAY[apiName] || apiName;
}

// Get flag image URL
function getFlagUrl(teamName, size = 'w40') {
  const code = FLAG_CODES[teamName];
  if (!code) return '';
  return `https://flagcdn.com/${size}/${code}.png`;
}

// Get flag HTML img element
function getFlagImg(teamName, cssClass = 'inline-block w-6 h-4 object-cover rounded-sm') {
  const url = getFlagUrl(teamName);
  if (!url) return '';
  return `<img src="${url}" alt="${teamName}" class="${cssClass}" loading="lazy" onerror="this.style.display='none'">`;
}
