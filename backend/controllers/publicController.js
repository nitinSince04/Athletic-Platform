const mongoose = require('mongoose');
const Opportunity = require('../models/Opportunity.js');

// // Simple in-memory cache to respect external rate limits and keep public endpoints lightning fast
// const newsCache = { data: null, timestamp: 0 };
// const scoresCache = { data: null, timestamp: 0 };

// const NEWS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
// const SCORES_CACHE_TTL_MS = 45 * 1000;    // 45 seconds

// /**
//  * @desc    Get Latest Cricket Sports News (World & Indian/Domestic)
//  * @route   GET /api/public/cricket/news
//  * @access  Public
//  */
// const getCricketNews = async (req, res) => {
//   try {
//     const now = Date.now();
//     if (newsCache.data && (now - newsCache.timestamp) < NEWS_CACHE_TTL_MS) {
//       return res.status(200).json({ success: true, cached: true, news: newsCache.data });
//     }

//     // High quality real cricket news articles (World & Domestic)
//     const newsArticles = [
//       {
//         id: 'news-1',
//         title: 'Pakistan docked 11 points in WTC table following England Test series slow over-rate penalty',
//         category: 'WORLD CRICKET',
//         summary: 'Pakistan has been penalized 11 crucial World Test Championship points for maintaining a slow over-rate during their recent Test series against England, impacting their standing in the WTC finals race.',
//         source: 'Reuters / ICC',
//         publishedAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
//         image: 'https://images.unsplash.com/photo-1540747913346-19e32dc3e97e?auto=format&fit=crop&w=800&q=80',
//         url: 'https://www.icc-cricket.com',
//       },
//       {
//         id: 'news-2',
//         title: 'Ranji Trophy 2026: Elite openers dazzle in opening round with century-making performances',
//         category: 'INDIAN / DOMESTIC CRICKET',
//         summary: 'State opening batters produced remarkable long-innings batting performances across Delhi, Mumbai, and Karnataka fixtures, staking strong claims for upcoming India A red-ball selection.',
//         source: 'PTI / BCCI',
//         publishedAt: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
//         image: 'https://images.unsplash.com/photo-1531415074968-036ba1b575da?auto=format&fit=crop&w=800&q=80',
//         url: 'https://www.bcci.tv',
//       },
//       {
//         id: 'news-3',
//         title: 'Australia & England lock in squad rotation ahead of high-stakes T20 World Cup Warm-Up',
//         category: 'WORLD CRICKET',
//         summary: 'Both selection panels have announced balanced squads prioritizing aggressive top-order power hitters and death-overs batting specialists for the upcoming international T20 series.',
//         source: 'ESPNCricinfo',
//         publishedAt: new Date(Date.now() - 12 * 3600 * 1000).toISOString(),
//         image: 'https://images.unsplash.com/photo-1512719994953-eabf50895df7?auto=format&fit=crop&w=800&q=80',
//         url: 'https://www.espncricinfo.com',
//       },
//       {
//         id: 'news-4',
//         title: 'Irani Cup & Duleep Trophy: Middle-order power hitters showcase spin-bowling counterattacks',
//         category: 'INDIAN / DOMESTIC CRICKET',
//         summary: 'Rising domestic middle-order batters demonstrated exceptional strike rates against quality spin attacks, highlighting tactical batting development in death overs.',
//         source: 'CricketNext / Sportsstar',
//         publishedAt: new Date(Date.now() - 18 * 3600 * 1000).toISOString(),
//         image: 'https://images.unsplash.com/photo-1587280501635-68a0e82cd5ff?auto=format&fit=crop&w=800&q=80',
//         url: 'https://sportstar.thehindu.com',
//       },
//     ];

//     newsCache.data = newsArticles;
//     newsCache.timestamp = now;

//     return res.status(200).json({ success: true, news: newsArticles });
//   } catch (error) {
//     console.error('getCricketNews error:', error);
//     return res.status(500).json({ success: false, message: 'Unable to load cricket news right now.' });
//   }
// };

// /**
//  * @desc    Get Live Cricket Scores & Recent Matches
//  * @route   GET /api/public/cricket/live
//  * @access  Public
//  */
// const getCricketLiveScores = async (req, res) => {
//   try {
//     const now = Date.now();
//     if (scoresCache.data && (now - scoresCache.timestamp) < SCORES_CACHE_TTL_MS) {
//       return res.status(200).json({ success: true, cached: true, matches: scoresCache.data });
//     }

//     const matches = [
//       {
//         id: 'match-1',
//         statusTag: 'LIVE',
//         isLive: true,
//         matchType: 'T20I',
//         series: 'International T20 Championship 2026',
//         venue: 'Arun Jaitley Stadium, Delhi',
//         team1: { name: 'Afghanistan', score: '156/8', overs: '20.0' },
//         team2: { name: 'India', score: '157/3', overs: '13.4' },
//         resultText: 'INDIA WON BY 7 WICKETS (38 BALLS REMAINING)',
//       },
//       {
//         id: 'match-2',
//         statusTag: 'LIVE',
//         isLive: true,
//         matchType: 'Test Match',
//         series: 'World Test Championship 2026',
//         venue: 'MCG, Melbourne',
//         team1: { name: 'Australia', score: '384 & 210/4 d', overs: '62.0' },
//         team2: { name: 'England', score: '298 & 142/3', overs: '44.2' },
//         resultText: 'DAY 4 • ENGLAND NEED 155 RUNS TO WIN',
//       },
//       {
//         id: 'match-3',
//         statusTag: 'RECENT RESULT',
//         isLive: false,
//         matchType: 'Ranji Trophy',
//         series: 'Ranji Trophy Elite Group 2026',
//         venue: 'Wankhede Stadium, Mumbai',
//         team1: { name: 'Mumbai', score: '412 & 180/2 d', overs: '48.0' },
//         team2: { name: 'Karnataka', score: '320 & 195', overs: '58.4' },
//         resultText: 'MUMBAI WON BY 77 RUNS',
//       },
//     ];

//     scoresCache.data = matches;
//     scoresCache.timestamp = now;

//     return res.status(200).json({ success: true, matches });
//   } catch (error) {
//     console.error('getCricketLiveScores error:', error);
//     return res.status(500).json({ success: false, message: 'Live scores temporarily unavailable.' });
//   }
// };

//CLAUD LIVE CRICKET FIX

const { fetchNews, fetchLiveScores } = require('../services/cricketService.js');

// Cache protects the free API limit (CricketData allows 100 requests/day)
const newsCache = { data: null, timestamp: 0 };
const scoresCache = { data: null, timestamp: 0 };

const NEWS_CACHE_TTL_MS = 30 * 60 * 1000;   // 30 minutes
const SCORES_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes (max 96 API calls/day)

/**
 * @desc    Get Latest Cricket News (real RSS feeds)
 * @route   GET /api/public/cricket/news
 * @access  Public
 */
const getCricketNews = async (req, res) => {
  try {
    const now = Date.now();
    if (newsCache.data && now - newsCache.timestamp < NEWS_CACHE_TTL_MS) {
      return res.status(200).json({ success: true, cached: true, news: newsCache.data });
    }

    const news = await fetchNews();
    newsCache.data = news;
    newsCache.timestamp = now;
    return res.status(200).json({ success: true, news: news });
  } catch (error) {
    console.error('getCricketNews error:', error.message);
    if (newsCache.data) {
      return res.status(200).json({ success: true, cached: true, stale: true, news: newsCache.data });
    }
    return res.status(500).json({ success: false, message: 'Unable to load cricket news right now.' });
  }
};

/**
 * @desc    Get Live Cricket Scores (CricketData.org)
 * @route   GET /api/public/cricket/live
 * @access  Public
 */
const getCricketLiveScores = async (req, res) => {
  try {
    const now = Date.now();
    if (scoresCache.data && now - scoresCache.timestamp < SCORES_CACHE_TTL_MS) {
      return res.status(200).json({ success: true, cached: true, matches: scoresCache.data });
    }

    const matches = await fetchLiveScores();
    scoresCache.data = matches;
    scoresCache.timestamp = now;
    return res.status(200).json({ success: true, matches: matches });
  } catch (error) {
    console.error('getCricketLiveScores error:', error.message);
    if (scoresCache.data) {
      return res.status(200).json({ success: true, cached: true, stale: true, matches: scoresCache.data });
    }
    return res.status(500).json({ success: false, message: 'Live scores temporarily unavailable.' });
  }
};


/**
 * @desc    Get Public Cricket Opportunities Feed (All Active Coach Opportunities)
 * @route   GET /api/public/opportunities
 * @access  Public
 */
const getPublicOpportunities = async (req, res) => {
  try {
    const { search = '', battingRole = 'all' } = req.query;

    if (mongoose.connection.readyState === 1) {
      const filter = { status: { $ne: 'deleted' } };
      const conditions = [];

      const cleanRole = battingRole ? battingRole.toLowerCase().trim() : 'all';
      if (cleanRole && !['all', 'all roles', 'all batters'].includes(cleanRole)) {
        const escapedRole = cleanRole.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        conditions.push({ battingRole: { $regex: escapedRole, $options: 'i' } });
      }

      if (search && search.trim() !== '') {
        const cleanSearch = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        conditions.push({
          $or: [
            { title: { $regex: cleanSearch, $options: 'i' } },
            { location: { $regex: cleanSearch, $options: 'i' } },
            { summary: { $regex: cleanSearch, $options: 'i' } },
            { battingRole: { $regex: cleanSearch, $options: 'i' } },
            { type: { $regex: cleanSearch, $options: 'i' } },
            { creatorName: { $regex: cleanSearch, $options: 'i' } },
            { creatorTeam: { $regex: cleanSearch, $options: 'i' } },
          ],
        });
      }

      if (conditions.length > 0) {
        filter.$and = conditions;
      }

      const opps = await Opportunity.find(filter)
        .sort({ createdAt: -1 })
        .lean();

      // Format opportunities for public view
      const publicOpps = opps.map((opp) => ({
        ...opp,
        feeDisplay: opp.fee === 0 ? 'Free' : `₹${(opp.fee || 2000).toLocaleString('en-IN')}`,
      }));

      return res.status(200).json({ success: true, opportunities: publicOpps });
    } else {
      return res.status(200).json({ success: true, opportunities: [] });
    }
  } catch (error) {
    console.error('getPublicOpportunities error:', error);
    return res.status(500).json({ success: false, message: 'Unable to load public opportunities.' });
  }
};

module.exports = {
  getCricketNews,
  getCricketLiveScores,
  getPublicOpportunities,
};
