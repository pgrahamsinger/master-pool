'use strict';

const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const httpsLib   = require('https');
const fs         = require('fs');
const path       = require('path');
const os         = require('os');
const crypto     = require('crypto');

const app        = express();
const httpServer = http.createServer(app);
const io         = new Server(httpServer);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Helpers ──────────────────────────────────────────────────────────────────
function genRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function newGolfer(g) {
  return {
    ...g,
    owner:              null,   // set after auction finalizes
    ownerId:            null,
    bid:                null,   // final price after auction
    currentBid:         0,      // live bid during auction
    currentBidderId:    null,
    currentBidderName:  null,
    bidCount:           0,
    bidderIds:          [],     // everyone who has placed a bid
  };
}

// ─── Default field ────────────────────────────────────────────────────────────
const DEFAULT_GOLFERS = [
  { id:  1, name: "Scottie Scheffler",   ranking:  1 },
  { id:  2, name: "Rory McIlroy",        ranking:  2 },
  { id:  3, name: "Xander Schauffele",   ranking:  3 },
  { id:  4, name: "Collin Morikawa",     ranking:  4 },
  { id:  5, name: "Viktor Hovland",      ranking:  5 },
  { id:  6, name: "Patrick Cantlay",     ranking:  6 },
  { id:  7, name: "Jon Rahm",            ranking:  7 },
  { id:  8, name: "Ludvig Åberg",        ranking:  8 },
  { id:  9, name: "Tommy Fleetwood",     ranking:  9 },
  { id: 10, name: "Wyndham Clark",       ranking: 10 },
  { id: 11, name: "Hideki Matsuyama",    ranking: 11 },
  { id: 12, name: "Max Homa",            ranking: 12 },
  { id: 13, name: "Tyrrell Hatton",      ranking: 13 },
  { id: 14, name: "Shane Lowry",         ranking: 14 },
  { id: 15, name: "Matt Fitzpatrick",    ranking: 15 },
  { id: 16, name: "Tony Finau",          ranking: 16 },
  { id: 17, name: "Sahith Theegala",     ranking: 17 },
  { id: 18, name: "Justin Thomas",       ranking: 18 },
  { id: 19, name: "Jordan Spieth",       ranking: 19 },
  { id: 20, name: "Brooks Koepka",       ranking: 20 },
  { id: 21, name: "Brian Harman",        ranking: 21 },
  { id: 22, name: "Bryson DeChambeau",   ranking: 22 },
  { id: 23, name: "Cameron Smith",       ranking: 23 },
  { id: 24, name: "Dustin Johnson",      ranking: 24 },
  { id: 25, name: "Will Zalatoris",      ranking: 25 },
  { id: 26, name: "Sungjae Im",          ranking: 26 },
  { id: 27, name: "Tom Kim",             ranking: 27 },
  { id: 28, name: "Keegan Bradley",      ranking: 28 },
  { id: 29, name: "Russell Henley",      ranking: 29 },
  { id: 30, name: "Adam Scott",          ranking: 30 },
  { id: 31, name: "Si Woo Kim",          ranking: 31 },
  { id: 32, name: "Sepp Straka",         ranking: 32 },
  { id: 33, name: "Jason Day",           ranking: 33 },
  { id: 34, name: "Corey Conners",       ranking: 34 },
  { id: 35, name: "Rickie Fowler",       ranking: 35 },
  { id: 36, name: "Justin Rose",         ranking: 36 },
  { id: 37, name: "Sergio Garcia",       ranking: 37 },
  { id: 38, name: "Phil Mickelson",      ranking: 38 },
  { id: 39, name: "Tiger Woods",         ranking: 39 },
  { id: 40, name: "Patrick Reed",        ranking: 40 },
  { id: 41, name: "Bubba Watson",        ranking: 41 },
  { id: 42, name: "Zach Johnson",        ranking: 42 },
  { id: 43, name: "Fred Couples",        ranking: 43 },
  { id: 44, name: "Mike Weir",           ranking: 44 },
  { id: 45, name: "Trevor Immelman",     ranking: 45 },
  { id: 46, name: "Charl Schwartzel",    ranking: 46 },
  { id: 47, name: "Danny Willett",       ranking: 47 },
  { id: 48, name: "Akshay Bhatia",       ranking: 48 },
  { id: 49, name: "Nick Dunlap",         ranking: 49 },
  { id: 50, name: "Cam Davis",           ranking: 50 },
  { id: 51, name: "Nick Taylor",         ranking: 51 },
  { id: 52, name: "Denny McCarthy",      ranking: 52 },
  { id: 53, name: "Bernhard Langer",     ranking: 53 },
  { id: 54, name: "Larry Mize",          ranking: 54 },
  { id: 55, name: "Jose Maria Olazabal", ranking: 55 },
].map(newGolfer);

const DEFAULT_STATE = {
  phase:    'setup',             // 'setup' | 'lobby' | 'auction' | 'scoring' | 'final'
  roomCode: genRoomCode(),
  settings: {
    poolName:            "Graham's Masters Pool 2026",
    adminPassword:       'masters2026',
    charityPercent:      20,
    payoutSplit:         [60, 25, 15],
    maxGolfersPerPerson: 3,
    minBidIncrement:     5,
    antiSnipeMinutes:    2,
    startingBid:         5,
  },
  participants:    [],           // { id, name, email, joinedAt }
  golfers:         DEFAULT_GOLFERS,
  auctionEndTime:  null,         // ISO timestamp
  scores:          {},           // { "Player Name": { position, totalScore, rounds[], status } }
  lastScoreUpdate: null,
};

// ─── State persistence ────────────────────────────────────────────────────────
const STATE_FILE = path.join(__dirname, 'state.json');
let state;

if (fs.existsSync(STATE_FILE)) {
  try {
    const loaded = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    // Merge defaults so new fields are picked up after updates
    state = {
      ...DEFAULT_STATE,
      ...loaded,
      settings: { ...DEFAULT_STATE.settings, ...loaded.settings },
    };
    // Ensure golfers have bid fields (migration)
    state.golfers = state.golfers.map(g => ({
      currentBid: 0, currentBidderId: null, currentBidderName: null,
      bidCount: 0, bidderIds: [], owner: null, ownerId: null, bid: null,
      ...g,
    }));
    console.log('✓ Loaded saved state');
  } catch (e) {
    state = JSON.parse(JSON.stringify(DEFAULT_STATE));
    console.log('⚠ Could not load state – starting fresh');
  }
} else {
  state = JSON.parse(JSON.stringify(DEFAULT_STATE));
}

const saveState = () => {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); } catch {}
};
const broadcast = () => io.emit('state_update', state);

// ─── Auction finalization ─────────────────────────────────────────────────────
function finalizeAuction() {
  for (const g of state.golfers) {
    if (g.currentBidderId) {
      g.owner   = g.currentBidderName;
      g.ownerId = g.currentBidderId;
      g.bid     = g.currentBid;
    } else {
      g.owner = null; g.ownerId = null; g.bid = null;
    }
  }
  state.phase = 'scoring';
  console.log('Auction finalized at', new Date().toLocaleString());
}

// Check every 5s if auction timer has expired
setInterval(() => {
  if (state.phase === 'auction' && state.auctionEndTime) {
    if (Date.now() > new Date(state.auctionEndTime).getTime() + 1000) {
      finalizeAuction();
      saveState();
      broadcast();
    }
  }
}, 5000);

// ─── Auth middleware ───────────────────────────────────────────────────────────
const requireAdmin = (req, res, next) => {
  if (req.headers['x-admin-password'] !== state.settings.adminPassword) {
    return res.status(401).json({ error: 'Invalid admin password' });
  }
  next();
};

// ─── Public routes ────────────────────────────────────────────────────────────
app.get('/api/state', (_req, res) => res.json(state));

app.get('/api/admin/verify', (req, res) => {
  res.json({ ok: req.headers['x-admin-password'] === state.settings.adminPassword });
});

// Join pool with room code
app.post('/api/join', (req, res) => {
  const { roomCode, name, email } = req.body || {};

  if (!roomCode || !name || !email) {
    return res.status(400).json({ error: 'Room code, name, and email are required.' });
  }
  if (roomCode.trim().toUpperCase() !== state.roomCode.toUpperCase()) {
    return res.status(401).json({ error: 'Invalid room code. Check with your pool admin.' });
  }
  if (!['lobby', 'auction', 'scoring', 'final'].includes(state.phase)) {
    return res.status(400).json({ error: 'Registration is not open yet.' });
  }

  const normEmail = email.trim().toLowerCase();
  const existing  = state.participants.find(p => p.email === normEmail);
  if (existing) {
    return res.json({ ok: true, participant: existing, rejoin: true });
  }

  const participant = {
    id:       crypto.randomUUID(),
    name:     name.trim(),
    email:    normEmail,
    joinedAt: new Date().toISOString(),
  };
  state.participants.push(participant);
  saveState();
  broadcast();
  res.json({ ok: true, participant });
});

// Place a bid
app.post('/api/bid', (req, res) => {
  const { participantId, golferId, amount } = req.body || {};

  if (!participantId || !golferId || amount === undefined) {
    return res.status(400).json({ error: 'participantId, golferId, and amount are required.' });
  }
  const participant = state.participants.find(p => p.id === participantId);
  if (!participant) return res.status(401).json({ error: 'Participant not found. Please re-join.' });

  if (state.phase !== 'auction') {
    return res.status(400).json({ error: 'Auction is not currently active.' });
  }
  if (state.auctionEndTime && Date.now() > new Date(state.auctionEndTime).getTime()) {
    return res.status(400).json({ error: 'The auction has ended.' });
  }

  const golfer = state.golfers.find(g => g.id === golferId);
  if (!golfer) return res.status(404).json({ error: 'Golfer not found.' });

  if (golfer.currentBidderId === participantId) {
    return res.status(400).json({ error: 'You are already the highest bidder on this golfer.' });
  }

  const minBid = golfer.currentBid > 0
    ? golfer.currentBid + state.settings.minBidIncrement
    : state.settings.startingBid;

  if (Number(amount) < minBid) {
    return res.status(400).json({ error: `Minimum bid is $${minBid}.` });
  }

  // Enforce max golfers per person (count golfers this participant is currently leading, excluding this one)
  const leading = state.golfers.filter(g => g.currentBidderId === participantId && g.id !== golferId).length;
  if (leading >= state.settings.maxGolfersPerPerson) {
    return res.status(400).json({
      error: `You're already leading on ${state.settings.maxGolfersPerPerson} golfers (the maximum). You must be outbid on one before bidding on another.`,
    });
  }

  // Anti-snipe: if bid comes in within antiSnipeMinutes of end, extend the timer
  if (state.auctionEndTime) {
    const remaining   = new Date(state.auctionEndTime).getTime() - Date.now();
    const antiSnipeMs = state.settings.antiSnipeMinutes * 60 * 1000;
    if (remaining > 0 && remaining < antiSnipeMs) {
      state.auctionEndTime = new Date(Date.now() + antiSnipeMs).toISOString();
    }
  }

  // Record bid
  golfer.currentBid        = Number(amount);
  golfer.currentBidderId   = participantId;
  golfer.currentBidderName = participant.name;
  golfer.bidCount          = (golfer.bidCount || 0) + 1;
  if (!golfer.bidderIds.includes(participantId)) {
    golfer.bidderIds.push(participantId);
  }

  saveState();
  broadcast();
  res.json({ ok: true });
});

// ─── Admin routes ─────────────────────────────────────────────────────────────
app.post('/api/admin/settings', requireAdmin, (req, res) => {
  const { poolName, charityPercent, payoutSplit, newAdminPassword,
          maxGolfersPerPerson, minBidIncrement, antiSnipeMinutes, startingBid } = req.body;
  if (poolName             !== undefined) state.settings.poolName             = poolName;
  if (charityPercent       !== undefined) state.settings.charityPercent       = Number(charityPercent);
  if (payoutSplit          !== undefined) state.settings.payoutSplit          = payoutSplit;
  if (newAdminPassword     !== undefined) state.settings.adminPassword        = newAdminPassword;
  if (maxGolfersPerPerson  !== undefined) state.settings.maxGolfersPerPerson  = Number(maxGolfersPerPerson);
  if (minBidIncrement      !== undefined) state.settings.minBidIncrement      = Number(minBidIncrement);
  if (antiSnipeMinutes     !== undefined) state.settings.antiSnipeMinutes     = Number(antiSnipeMinutes);
  if (startingBid          !== undefined) state.settings.startingBid          = Number(startingBid);
  saveState(); broadcast();
  res.json({ ok: true });
});

app.post('/api/admin/golfers', requireAdmin, (req, res) => {
  state.golfers = (req.body.golfers || []).map(g => ({
    currentBid: 0, currentBidderId: null, currentBidderName: null,
    bidCount: 0, bidderIds: [], owner: null, ownerId: null, bid: null,
    ...g,
  }));
  saveState(); broadcast();
  res.json({ ok: true });
});

app.post('/api/admin/participants/remove', requireAdmin, (req, res) => {
  state.participants = state.participants.filter(p => p.id !== req.body.participantId);
  saveState(); broadcast();
  res.json({ ok: true });
});

app.post('/api/admin/phase', requireAdmin, (req, res) => {
  state.phase = req.body.phase;
  saveState(); broadcast();
  res.json({ ok: true });
});

app.post('/api/admin/roomcode/regenerate', requireAdmin, (req, res) => {
  state.roomCode = genRoomCode();
  saveState(); broadcast();
  res.json({ ok: true, roomCode: state.roomCode });
});

// Start live auction with a timed window
app.post('/api/admin/auction/start', requireAdmin, (req, res) => {
  const { durationMinutes = 30 } = req.body;
  state.auctionEndTime = new Date(Date.now() + Number(durationMinutes) * 60 * 1000).toISOString();
  state.phase = 'auction';
  saveState(); broadcast();
  res.json({ ok: true, auctionEndTime: state.auctionEndTime });
});

// Extend auction timer
app.post('/api/admin/auction/extend', requireAdmin, (req, res) => {
  const { minutes = 5 } = req.body;
  const base = state.auctionEndTime ? Math.max(Date.now(), new Date(state.auctionEndTime).getTime()) : Date.now();
  state.auctionEndTime = new Date(base + Number(minutes) * 60 * 1000).toISOString();
  saveState(); broadcast();
  res.json({ ok: true, auctionEndTime: state.auctionEndTime });
});

// End auction immediately + finalize
app.post('/api/admin/auction/finalize', requireAdmin, (req, res) => {
  finalizeAuction();
  saveState(); broadcast();
  res.json({ ok: true });
});

// Clear all bids (admin correction)
app.post('/api/admin/auction/clearbid', requireAdmin, (req, res) => {
  const golfer = state.golfers.find(g => g.id === req.body.golferId);
  if (!golfer) return res.status(404).json({ error: 'Not found' });
  golfer.currentBid = 0; golfer.currentBidderId = null;
  golfer.currentBidderName = null; golfer.bidCount = 0; golfer.bidderIds = [];
  saveState(); broadcast();
  res.json({ ok: true });
});

app.post('/api/admin/scores/refresh', requireAdmin, async (_req, res) => {
  try {
    const scores = await fetchMastersScores();
    if (scores && Object.keys(scores).length > 0) {
      state.scores = scores;
      state.lastScoreUpdate = new Date().toISOString();
      saveState(); broadcast();
      res.json({ ok: true, count: Object.keys(scores).length });
    } else {
      res.json({ ok: false, message: 'Tournament scores not available yet.' });
    }
  } catch (e) {
    res.json({ ok: false, message: e.message });
  }
});

app.post('/api/admin/scores/manual', requireAdmin, (req, res) => {
  for (const u of (req.body.scores || [])) {
    state.scores[u.name] = {
      position: u.position || '--', totalScore: u.totalScore || 'E',
      status: u.status || 'active', rounds: u.rounds || [],
    };
  }
  state.lastScoreUpdate = new Date().toISOString();
  saveState(); broadcast();
  res.json({ ok: true });
});

app.post('/api/admin/reset', requireAdmin, (req, res) => {
  const savedPw = state.settings.adminPassword;
  state = JSON.parse(JSON.stringify(DEFAULT_STATE));
  state.settings.adminPassword = savedPw;
  state.roomCode = genRoomCode();
  saveState(); broadcast();
  res.json({ ok: true });
});

// ─── ESPN score fetcher ───────────────────────────────────────────────────────
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    httpsLib.get(url, {
      headers: { 'User-Agent': 'MastersPool/1.0', Accept: 'application/json' },
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return resolve(httpsGet(res.headers.location));
      }
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error('Bad JSON')); } });
    }).on('error', reject);
  });
}

async function fetchMastersScores() {
  const data   = await httpsGet('https://site.api.espn.com/apis/site/v2/sports/golf/leaderboard?league=pga');
  const events = data.events || [];
  const tourney = events.find(e => (e.name || '').toLowerCase().includes('masters'))
                || events.find(e => (e.shortName || '').toLowerCase().includes('masters'))
                || events[0];
  if (!tourney) return null;

  const competitors = tourney.competitions?.[0]?.competitors || [];
  const scores = {};
  for (const c of competitors) {
    const name = c.athlete?.displayName;
    if (!name) continue;
    const getStat = n => (c.statistics || []).find(s => s.name === n)?.displayValue;
    scores[name] = {
      position:   c.status?.position?.displayName || getStat('position') || '--',
      totalScore: getStat('scoreToPar') || c.score || 'E',
      status:     c.status?.type?.name || 'active',
      rounds:     (c.linescores || []).map(r => r.displayValue || '--'),
    };
  }
  return Object.keys(scores).length ? scores : null;
}

// ─── Socket.io ────────────────────────────────────────────────────────────────
io.on('connection', socket => {
  socket.emit('state_update', state);
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, '0.0.0.0', () => {
  const localIP = Object.values(os.networkInterfaces()).flat()
    .find(i => i?.family === 'IPv4' && !i.internal)?.address || 'localhost';

  console.log("\n🏌️  Graham's Masters Pool 2026");
  console.log('══════════════════════════════════════');
  console.log(`  Local:     http://localhost:${PORT}`);
  console.log(`  Network:   http://${localIP}:${PORT}`);
  console.log(`  Room code: ${state.roomCode}`);
  console.log(`  Admin pw:  ${state.settings.adminPassword}`);
  console.log('══════════════════════════════════════\n');
});
