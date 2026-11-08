const Parser = require('rss-parser');

// ---------------- NEWS (free RSS feeds, no API key needed) ----------------
const parser = new Parser({
  timeout: 8000,
  headers: { 'User-Agent': 'Mozilla/5.0 (FieldSignal cricket app)' },
  customFields: {
    item: [
      ['media:thumbnail', 'mediaThumb'],
      ['media:content', 'mediaContent'],
    ],
  },
});

const FEEDS = [
  { name: 'BBC Sport', url: 'https://feeds.bbci.co.uk/sport/cricket/rss.xml', category: 'WORLD CRICKET' },
  { name: 'The Guardian', url: 'https://www.theguardian.com/sport/cricket/rss', category: 'WORLD CRICKET' },
  { name: 'Hindustan Times', url: 'https://www.hindustantimes.com/feeds/rss/cricket/rssfeed.xml', category: 'INDIAN / DOMESTIC CRICKET' },
];

function cleanText(text) {
  return String(text || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstUrl(field) {
  const one = Array.isArray(field) ? field[0] : field;
  return one && one.$ && one.$.url ? one.$.url : null;
}

function getImage(item) {
  if (item.enclosure && item.enclosure.url && /image|jpg|jpeg|png|webp/i.test(item.enclosure.type + item.enclosure.url)) {
    return item.enclosure.url;
  }
  const fromMedia = firstUrl(item.mediaThumb) || firstUrl(item.mediaContent);
  if (fromMedia) return fromMedia;
  const html = item['content:encoded'] || item.content || '';
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return match ? match[1] : null; // null -> frontend shows its default image
}

async function fetchNews() {
  const results = await Promise.allSettled(
    FEEDS.map(async (feed) => {
      const data = await parser.parseURL(feed.url);
      return data.items.slice(0, 6).map((item) => {
        const date = new Date(item.isoDate || item.pubDate || Date.now());
        const summary = cleanText(item.contentSnippet || item.content || item.summary);
        return {
          id: item.guid || item.link,
          title: cleanText(item.title),
          category: feed.category,
          summary: summary.length > 200 ? summary.slice(0, 197) + '...' : summary,
          source: feed.name,
          publishedAt: isNaN(date) ? new Date().toISOString() : date.toISOString(),
          image: getImage(item),
          url: item.link,
        };
      });
    })
  );

  const articles = [];
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') articles.push(...result.value);
    else console.warn(`News feed failed (${FEEDS[i].name}):`, result.reason.message);
  });

  if (articles.length === 0) throw new Error('No news feed could be loaded');

  articles.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  return articles;
}

// ---------------- LIVE SCORES (CricketData.org free API, key needed) ----------------
function teamScore(match, teamName) {
  const innings = (match.score || []).filter((s) => String(s.inning || '').toLowerCase().startsWith(teamName.toLowerCase()));
  if (innings.length === 0) return { score: '-', overs: '' };
  const text = innings.map((s) => `${s.r}/${s.w}`).join(' & ');
  return { score: text, overs: String(innings[innings.length - 1].o) };
}

function makeMatch(m) {
  const isLive = m.matchStarted === true && m.matchEnded !== true;
  const t1 = (m.teams && m.teams[0]) || 'Team 1';
  const t2 = (m.teams && m.teams[1]) || 'Team 2';
  return {
    id: m.id,
    statusTag: isLive ? 'LIVE' : m.matchEnded ? 'RECENT RESULT' : 'UPCOMING',
    isLive: isLive,
    matchType: String(m.matchType || '').toUpperCase(),
    series: m.name,
    venue: m.venue,
    team1: { name: t1, ...teamScore(m, t1) },
    team2: { name: t2, ...teamScore(m, t2) },
    resultText: String(m.status || '').toUpperCase(),
  };
}

async function fetchLiveScores() {
  const key = process.env.CRICKET_API_KEY;
  if (!key) throw new Error('CRICKET_API_KEY is missing in .env');

  const url = `https://api.cricapi.com/v1/currentMatches?apikey=${key}&offset=0`;
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  const data = await response.json();

  if (data.status !== 'success') {
    throw new Error('CricketData API: ' + (data.reason || 'request failed'));
  }

  const matches = (data.data || []).filter((m) => m.name && m.teams && m.teams.length >= 2).map(makeMatch);

  const order = { LIVE: 0, 'RECENT RESULT': 1, UPCOMING: 2 };
  matches.sort((a, b) => order[a.statusTag] - order[b.statusTag]);

  console.log('CricketData hits today:', data.info && data.info.hitsToday);
  return matches.slice(0, 10);
}

module.exports = { fetchNews, fetchLiveScores, FEEDS };