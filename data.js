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
    name: 'Julian/Takumi',
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
    teams: ['Panama', 'Saudi Arabia', 'England', 'Haiti', 'Argentina', 'Bosnia & Herzegovina']
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
  'Bosnia and Herzegovina': 'Bosnia & Herzegovina',
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
  'Bosnia & Herzegovina': 'ba',
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

// YouTube search name overrides for better results
const YT_SEARCH_NAMES = {
  'USA': 'United States',
  'South Korea': 'Korea Republic',
  'Bosnia & Herzegovina': 'Bosnia',
  'DR Congo': 'DR Congo',
  'Czech Republic': 'Czechia',
  'Ivory Coast': "Côte d'Ivoire",
};

// FIFA YouTube channel ID
const FIFA_CHANNEL_ID = 'UCpcTrCXblq78GZrTUTLWeBw';

// Build a YouTube search URL scoped to the FIFA channel
function getYouTubeSearchUrl(team1, team2, type) {
  const t1 = YT_SEARCH_NAMES[team1] || team1;
  const t2 = YT_SEARCH_NAMES[team2] || team2;
  const suffix = type === 'highlights' ? 'highlights' : 'preview';
  const query = `${t1} vs ${t2} ${suffix} FIFA World Cup 2026`;
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAQ%253D%253D`;
}

// Build a YouTube embed search URL for the modal (uses /embed with search)
function getYouTubeEmbedSearchUrl(team1, team2) {
  const t1 = YT_SEARCH_NAMES[team1] || team1;
  const t2 = YT_SEARCH_NAMES[team2] || team2;
  const query = `${t1} vs ${t2} highlights FIFA World Cup 2026`;
  // Link to YouTube search filtered to videos
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAQ%253D%253D`;
}
