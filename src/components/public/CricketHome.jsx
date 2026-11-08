import React, { useState, useEffect, useMemo } from 'react';
import {
  Newspaper,
  Radio,
  Target,
  Search,
  MapPin,
  Users,
  ExternalLink,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Trophy,
  Calendar,
  Globe,
  Award,
} from 'lucide-react';
import Card from '../ui/Card.jsx';
import Badge from '../ui/Badge.jsx';
import Button from '../ui/Button.jsx';
import { LoadingBlock } from '../ui/LoadingState.jsx';
import { getPublicNewsApi, getPublicLiveScoresApi, getPublicOpportunitiesApi } from '../../api/publicApi.js';
import { applyToOpportunityApi, getAthleteApplicationsApi } from '../../api/coachApi.js';
import { useAuth } from '../../context/AuthContext.jsx';
import './CricketHome.css';

const BATTING_ROLE_OPTIONS = [
  'All Roles',
  'Opening Batter',
  'Top-Order Batter',
  'Middle-Order Batter',
  'Wicketkeeper-Batter',
  'Finisher',
  'Batting All-Rounder',
];

const TYPE_TONE = {
  recruitment: 'teal',
  trial: 'coral',
  tournament: 'amber',
  camp: 'teal',
  workshop: 'amber',
};

// Clean fallback cricket image placeholder if network or external image fails
const DEFAULT_CRICKET_IMAGE = 'https://images.unsplash.com/photo-1540747913346-19e32dc3e97e?auto=format&fit=crop&w=800&q=80';

export default function CricketHome({ onOpenAuthModal, activeTabFilter = 'all' }) {
  const { isAuthenticated, user } = useAuth();

  // News State
  const [newsList, setNewsList] = useState([]);
  const [isNewsLoading, setIsNewsLoading] = useState(true);
  const [newsError, setNewsError] = useState(null);
  const [selectedNewsCategory, setSelectedNewsCategory] = useState('ALL');

  // Live Scores State
  const [scoresList, setScoresList] = useState([]);
  const [isScoresLoading, setIsScoresLoading] = useState(true);
  const [scoresError, setScoresError] = useState(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState(null);

  // Opportunities State
  const [oppList, setOppList] = useState([]);
  const [isOppLoading, setIsOppLoading] = useState(true);
  const [oppError, setOppError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRole, setSelectedRole] = useState('All Roles');

  // Application State for Logged-In Athletes
  const [appliedMap, setAppliedMap] = useState({});
  const [applyingId, setApplyingId] = useState(null);
  const [appMessage, setAppMessage] = useState(null);

  // 1. Fetch Cricket News
  const fetchNews = async () => {
    setIsNewsLoading(true);
    setNewsError(null);
    try {
      const res = await getPublicNewsApi();
      if (res && res.news) {
        setNewsList(res.news);
      }
    } catch (err) {
      console.error('Error fetching public news:', err);
      setNewsError('Unable to load cricket news right now.');
    } finally {
      setIsNewsLoading(false);
    }
  };

  // 2. Fetch Live Cricket Scores
  const fetchScores = async (showLoading = true) => {
    if (showLoading) setIsScoresLoading(true);
    setScoresError(null);
    try {
      const res = await getPublicLiveScoresApi();
      if (res && res.matches) {
        setScoresList(res.matches);
        setLastRefreshedAt(new Date());
      }
    } catch (err) {
      console.error('Error fetching live scores:', err);
      setScoresError('Live scores temporarily unavailable.');
    } finally {
      setIsScoresLoading(false);
    }
  };

  // 3. Fetch Public Opportunities
  const fetchOpportunities = async () => {
    setIsOppLoading(true);
    setOppError(null);
    try {
      const res = await getPublicOpportunitiesApi({
        search: searchQuery,
        battingRole: selectedRole === 'All Roles' ? 'all' : selectedRole,
      });
      if (res && res.opportunities) {
        setOppList(res.opportunities);
      }
    } catch (err) {
      console.error('Error fetching public opportunities:', err);
      setOppError('Unable to load opportunities.');
    } finally {
      setIsOppLoading(false);
    }
  };

  // Fetch initial data
  useEffect(() => {
    fetchNews();
    fetchScores(true);
  //   fetchOpportunities();

  //   // Auto-refresh scores every 45 seconds (Requirement 8)
  //   const interval = setInterval(() => {
  //     fetchScores(false);
  //   }, 45000);

  //   return () => clearInterval(interval);
  // }, []);
      fetchOpportunities();
  }, []);

  // Re-fetch opportunities when filters change
  useEffect(() => {
    const handler = setTimeout(() => {
      fetchOpportunities();
    }, 300);
    return () => clearTimeout(handler);
  }, [searchQuery, selectedRole]);

  // Load athlete's existing applications if logged in
  useEffect(() => {
    if (isAuthenticated && user?.role === 'athlete') {
      getAthleteApplicationsApi()
        .then((apps) => {
          if (Array.isArray(apps)) {
            const map = {};
            apps.forEach((a) => {
              if (a.opportunityId) map[a.opportunityId] = true;
            });
            setAppliedMap(map);
          }
        })
        .catch(() => null);
    }
  }, [isAuthenticated, user]);

  // Filtered news by category
  const filteredNews = useMemo(() => {
    if (selectedNewsCategory === 'ALL') return newsList;
    return newsList.filter((item) => item.category === selectedNewsCategory);
  }, [newsList, selectedNewsCategory]);

  // Handle Apply click according to RBAC & Auth rules (Requirements 14, 15, 16)
  const handleApplyClick = async (oppId) => {
    setAppMessage(null);

    // 1. Unauthenticated Visitor -> Prompt Sign In / Register
    if (!isAuthenticated) {
      if (onOpenAuthModal) onOpenAuthModal();
      return;
    }

    // 2. Authenticated Coach -> Reject application (Requirement 16)
    if (user?.role === 'coach') {
      setAppMessage({
        id: oppId,
        type: 'error',
        text: 'Only athletes can apply to opportunities.',
      });
      return;
    }

    // 3. Authenticated Admin -> Reject application
    if (user?.role === 'admin') {
      setAppMessage({
        id: oppId,
        type: 'error',
        text: 'Administrators cannot apply to athlete opportunities.',
      });
      return;
    }

    // 4. Authenticated Athlete -> Submit application
    setApplyingId(oppId);
    try {
      await applyToOpportunityApi(oppId);
      setApplyingId(null);
      setAppliedMap((prev) => ({ ...prev, [oppId]: true }));
      setAppMessage({
        id: oppId,
        type: 'success',
        text: 'Application submitted successfully!',
      });
      fetchOpportunities();
    } catch (err) {
      setApplyingId(null);
      if (err.message && err.message.toLowerCase().includes('already applied')) {
        setAppliedMap((prev) => ({ ...prev, [oppId]: true }));
        setAppMessage({
          id: oppId,
          type: 'info',
          text: 'You have already applied to this opportunity.',
        });
      } else {
        setAppMessage({
          id: oppId,
          type: 'error',
          text: err.message || 'Failed to submit application.',
        });
      }
    }
  };

  return (
    <div className="cricket-home">
      {/* Hero Header Banner */}
      <div className="cricket-home__hero">
        <div className="cricket-home__hero-content">
          <div className="cricket-home__hero-badge">
            <Trophy size={16} color="var(--accent-teal)" />
            <span>FieldSignal Cricket Hub</span>
          </div>
          <h1 className="cricket-home__title">CRICKET HOME</h1>
          <p className="cricket-home__subtitle">
            Real-time Cricket Sports News, Live Scores & Professional Batting Opportunities
          </p>
        </div>
      </div>

      {/* Main Content Layout */}
      <div className="cricket-home__layout">
        {/* LEFT COLUMN: News + Live Scores */}
        <div className="cricket-home__main-col">
          {/* ==================================================== */}
          {/* SECTION 1 — LATEST CRICKET NEWS */}
          {/* ==================================================== */}
          <section id="news-section" className="cricket-home__section">
            <div className="cricket-home__section-header">
              <div className="cricket-home__section-title">
                <Newspaper size={20} color="var(--accent-teal)" />
                <h2>LATEST CRICKET NEWS</h2>
              </div>
              <div className="cricket-home__category-pills">
                <button
                  className={`cricket-home__pill ${selectedNewsCategory === 'ALL' ? 'active' : ''}`}
                  onClick={() => setSelectedNewsCategory('ALL')}
                >
                  ALL NEWS
                </button>
                <button
                  className={`cricket-home__pill ${selectedNewsCategory === 'WORLD CRICKET' ? 'active' : ''}`}
                  onClick={() => setSelectedNewsCategory('WORLD CRICKET')}
                >
                  WORLD CRICKET
                </button>
                <button
                  className={`cricket-home__pill ${selectedNewsCategory === 'INDIAN / DOMESTIC CRICKET' ? 'active' : ''}`}
                  onClick={() => setSelectedNewsCategory('INDIAN / DOMESTIC CRICKET')}
                >
                  INDIAN / DOMESTIC
                </button>
              </div>
            </div>

            {/* News List / Skeletons / Errors */}
            {isNewsLoading ? (
              <Card>
                <LoadingBlock label="Loading latest cricket news..." />
              </Card>
            ) : newsError ? (
              <Card>
                <div className="cricket-home__state-box error">
                  <AlertCircle size={32} />
                  <p>{newsError}</p>
                  <Button variant="secondary" size="sm" onClick={fetchNews}>
                    <RefreshCw size={14} /> Retry News
                  </Button>
                </div>
              </Card>
            ) : filteredNews.length === 0 ? (
              <Card>
                <div className="cricket-home__state-box empty">
                  <Globe size={32} />
                  <p>No cricket news available right now.</p>
                </div>
              </Card>
            ) : (
              <div className="cricket-home__news-grid">
                {filteredNews.map((news) => (
                  <Card key={news.id} className="cricket-news-card">
                    <div className="cricket-news-card__image-wrapper">
                      <img
                        src={news.image || DEFAULT_CRICKET_IMAGE}
                        alt={news.title}
                        className="cricket-news-card__image"
                        onError={(e) => {
                          e.target.onerror = null;
                          e.target.src = DEFAULT_CRICKET_IMAGE;
                        }}
                      />
                      <span className="cricket-news-card__category-badge">
                        {news.category}
                      </span>
                    </div>

                    <div className="cricket-news-card__body">
                      <h3 className="cricket-news-card__title">{news.title}</h3>
                      <p className="cricket-news-card__summary">{news.summary}</p>

                      <div className="cricket-news-card__footer">
                        <div className="cricket-news-card__meta">
                          <span>{news.source}</span>
                          <span>•</span>
                          <span>{new Date(news.publishedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                        </div>

                        {news.url && (
                          <a
                            href={news.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="cricket-news-card__read-more"
                          >
                            READ MORE <ExternalLink size={13} />
                          </a>
                        )}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </section>

          {/* ==================================================== */}
          {/* SECTION 2 — LIVE CRICKET SCORES */}
          {/* ==================================================== */}
          <section id="scores-section" className="cricket-home__section" style={{ marginTop: '2.5rem' }}>
            <div className="cricket-home__section-header">
              <div className="cricket-home__section-title">
                <Radio size={20} color="var(--signal-red)" />
                <h2>LIVE CRICKET SCORES</h2>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {lastRefreshedAt && (
                  <span className="eyebrow" style={{ fontSize: '10px' }}>
                    Updated {lastRefreshedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                )}
                <Button variant="ghost" size="sm" onClick={() => fetchScores(true)} disabled={isScoresLoading}>
                  <RefreshCw size={14} className={isScoresLoading ? 'spin' : ''} />
                </Button>
              </div>
            </div>

            {/* Scores List / Skeletons / Errors */}
            {isScoresLoading ? (
              <Card>
                <LoadingBlock label="Loading live cricket scores..." />
              </Card>
            ) : scoresError ? (
              <Card>
                <div className="cricket-home__state-box error">
                  <AlertCircle size={32} />
                  <p>{scoresError}</p>
                  <Button variant="secondary" size="sm" onClick={() => fetchScores(true)}>
                    <RefreshCw size={14} /> Retry Scores
                  </Button>
                </div>
              </Card>
            ) : scoresList.length === 0 ? (
              <Card>
                <div className="cricket-home__state-box empty">
                  <Trophy size={32} />
                  <p>No live cricket matches right now.</p>
                </div>
              </Card>
            ) : (
              <div className="cricket-home__scores-grid">
                {scoresList.map((match) => (
                  <Card key={match.id} className="cricket-score-card">
                    <div className="cricket-score-card__top">
                      <Badge tone={match.isLive ? 'coral' : 'teal'}>
                        {match.statusTag || (match.isLive ? '🔴 LIVE' : 'MATCH RESULT')}
                      </Badge>
                      <span className="cricket-score-card__type">{match.matchType}</span>
                    </div>

                    <div className="cricket-score-card__series">{match.series}</div>
                    <div className="cricket-score-card__venue">{match.venue}</div>

                    <div className="cricket-score-card__teams">
                      <div className="cricket-score-card__team-row">
                        <span className="cricket-score-card__team-name">{match.team1.name}</span>
                        <span className="cricket-score-card__team-score mono-stat">
                          {match.team1.score} {match.team1.overs && <small>({match.team1.overs} ov)</small>}
                        </span>
                      </div>
                      <div className="cricket-score-card__team-row">
                        <span className="cricket-score-card__team-name">{match.team2.name}</span>
                        <span className="cricket-score-card__team-score mono-stat">
                          {match.team2.score} {match.team2.overs && <small>({match.team2.overs} ov)</small>}
                        </span>
                      </div>
                    </div>

                    <div className="cricket-score-card__result">{match.resultText}</div>
                  </Card>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* RIGHT COLUMN / BOTTOM SECTION: PUBLIC OPPORTUNITY FEED */}
        <div className="cricket-home__side-col">
          <section id="opp-section" className="cricket-home__section">
            <div className="cricket-home__section-header">
              <div className="cricket-home__section-title">
                <Target size={20} color="var(--accent-teal)" />
                <h2>CRICKET OPPORTUNITY FEED</h2>
              </div>
            </div>

            {/* Filter Toolbar */}
            <Card padded={false} className="cricket-home__filter-toolbar">
              <div className="cricket-home__search-box">
                <Search size={16} color="var(--text-tertiary)" />
                <input
                  type="text"
                  placeholder="Search batting opportunities..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              <div className="cricket-home__select-box">
                <label htmlFor="public-role-select">Role:</label>
                <select
                  id="public-role-select"
                  value={selectedRole}
                  onChange={(e) => setSelectedRole(e.target.value)}
                >
                  {BATTING_ROLE_OPTIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
            </Card>

            {/* Opportunity Cards / Loading / Errors */}
            {isOppLoading ? (
              <Card>
                <LoadingBlock label="Loading active cricket opportunities..." />
              </Card>
            ) : oppError ? (
              <Card>
                <div className="cricket-home__state-box error">
                  <AlertCircle size={32} />
                  <p>{oppError}</p>
                  <Button variant="secondary" size="sm" onClick={fetchOpportunities}>
                    <RefreshCw size={14} /> Retry Opportunities
                  </Button>
                </div>
              </Card>
            ) : oppList.length === 0 ? (
              <Card>
                <div className="cricket-home__state-box empty">
                  <Award size={32} />
                  <p>No active opportunities available matching your search criteria.</p>
                </div>
              </Card>
            ) : (
              <div className="cricket-home__opp-list">
                {oppList.map((opp) => {
                  const oppId = opp._id || opp.id;
                  const isApplied = appliedMap[oppId];
                  const isBusy = applyingId === oppId;
                  const message = appMessage?.id === oppId ? appMessage : null;

                  return (
                    <Card key={oppId} className="cricket-opp-card">
                      <div className="cricket-opp-card__top">
                        <div>
                          <div className="cricket-opp-card__tags">
                            <Badge tone={TYPE_TONE[opp.type] || 'teal'}>
                              {String(opp.type || 'Trial').toUpperCase()}
                            </Badge>
                            <Badge variant="neutral">
                              {opp.battingRole || 'Opening Batter'}
                            </Badge>
                            <Badge tone="teal" style={{ fontWeight: 700 }}>
                              FEE: {opp.feeDisplay || (opp.fee === 0 ? 'Free' : `₹${opp.fee || 2000}`)}
                            </Badge>
                          </div>
                          <h3 className="cricket-opp-card__title">{opp.title}</h3>
                          <p className="cricket-opp-card__creator">
                            {opp.creatorTeam || opp.org || 'Delhi Cricket Academy'} · Posted by {opp.creatorName || opp.postedBy || 'Coach'}
                          </p>
                        </div>
                      </div>

                      <p className="cricket-opp-card__summary">{opp.summary}</p>

                      <div className="cricket-opp-card__details-row">
                        <span><MapPin size={13} /> {opp.location || 'Cricket Stadium'}</span>
                        <span><Users size={13} /> {opp.applicants || 0} applicants</span>
                        <span><Calendar size={13} /> {new Date(opp.createdAt || Date.now()).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                      </div>

                      {/* Display application result/error feedback message if present */}
                      {message && (
                        <div className={`cricket-opp-card__msg ${message.type}`}>
                          <AlertCircle size={14} /> <span>{message.text}</span>
                        </div>
                      )}

                      <div className="cricket-opp-card__footer">
                        <span className="cricket-opp-card__open-tag">Open for applications</span>

                        {isApplied ? (
                          <Button variant="ghost" size="sm" disabled style={{ color: 'var(--accent-teal)', fontWeight: 600 }}>
                            <CheckCircle2 size={14} /> ALREADY APPLIED
                          </Button>
                        ) : (
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => handleApplyClick(oppId)}
                            disabled={isBusy}
                          >
                            {isBusy ? 'Submitting...' : 'APPLY NOW'}
                          </Button>
                        )}
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
