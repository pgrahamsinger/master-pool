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
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function newGolfer(g) {
  return {
    ...g,
    owner: null, ownerId: null, bid: null,
    currentBid: 0, currentBidderId: null, currentBidderName: null,
    bidCount: 0, bidderIds: [],
  };
}

// ─── Default golfer field ─────────────────────────────────────────────────────
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

// ─── Default settings factory ─────────────────────────────────────────────────
function defaultSettings(overrides = {}) {
  return {
    poolName:              "Graham's Masters Pool 2026",
    charityPercent:        20,
    payoutSplit:           [60, 25, 15],
    maxGolfersPerPerson:   3,
    minBidIncrement:       5,
    antiSnipeMinutes:      2,
    startingBid:           5,
    defaultAuctionMinutes: 30,    // pre-fills the "Start Auction" dialog
    scheduledStartTime:    null,  // ISO string — auto-start auction at this time
    entryFee:              0,     // $ per participant (display / tracking only)
    ...overrides,
  };
}

// ─── Room factory ─────────────────────────────────────────────────────────────
function createRoom(settingsOverrides = {}) {
  const code = genRoomCode();
  return {
    code,
    phase:           'setup',
    settings:        defaultSettings(settingsOverrides),
    participants:    [],
    golfers:         JSON.parse(JSON.stringify(DEFAULT_GOLFERS)),
    auctionEndTime:  null,
    scores:          {},
    lastScoreUpdate: null,
    createdAt:       new Date().toISOString(),
  };
}

// ─── Global admin password + rooms store ─────────────────────────────────────
// ADMIN_PASSWORD and ROOM_CODE can be set as Render environment variables
// so they survive redeploys (otherwise state.json is wiped on each deploy).
let adminPassword = process.env.ADMIN_PASSWORD || 'masters2026';
let rooms         = {};   // { [roomCode]: roomState }

// ─── State persistence ────────────────────────────────────────────────────────
const STATE_FILE = path.join(__dirname, 'state.json');

// Create the default first room, using ROOM_CODE env var if set so the code
// stays stable across Render redeploys.
function makeDefaultRoom() {
  const r = createRoom();
  if (process.env.ROOM_CODE) r.code = process.env.ROOM_CODE.trim().toUpperCase();
  rooms[r.code] = r;
  return r;
}

(function loadState() {
  if (!fs.existsSync(STATE_FILE)) {
    makeDefaultRoom();
    return;
  }
  try {
    const d = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    // Env var always wins over stored password so Render env changes take effect
    adminPassword = process.env.ADMIN_PASSWORD || d.adminPassword || adminPassword;

    if (d.rooms && typeof d.rooms === 'object') {
      // New multi-room format
      for (const [code, room] of Object.entries(d.rooms)) {
        room.settings = { ...defaultSettings(), ...room.settings };
        room.golfers  = (room.golfers || []).map(g => ({
          currentBid: 0, currentBidderId: null, currentBidderName: null,
          bidCount: 0, bidderIds: [], owner: null, ownerId: null, bid: null, ...g,
        }));
        rooms[code] = room;
      }
    } else if (d.phase !== undefined) {
      // Migrate old single-room format
      const r         = createRoom();
      r.code          = process.env.ROOM_CODE
                        ? process.env.ROOM_CODE.trim().toUpperCase()
                        : (d.roomCode || r.code);
      r.phase         = d.phase           || 'setup';
      r.settings      = { ...defaultSettings(), ...d.settings };
      r.participants  = d.participants    || [];
      r.golfers       = (d.golfers || []).map(g => ({
        currentBid: 0, currentBidderId: null, currentBidderName: null,
        bidCount: 0, bidderIds: [], owner: null, ownerId: null, bid: null, ...g,
      }));
      r.auctionEndTime  = d.auctionEndTime  || null;
      r.scores          = d.scores          || {};
      r.lastScoreUpdate = d.lastScoreUpdate || null;
      if (d.settings && d.settings.adminPassword && !process.env.ADMIN_PASSWORD)
        adminPassword = d.settings.adminPassword;
      rooms[r.code] = r;
    }

    if (!Object.keys(rooms).length) makeDefaultRoom();
    console.log(`✓ Loaded ${Object.keys(rooms).length} room(s)`);
  } catch (e) {
    console.log('⚠ Could not load state – starting fresh');
    makeDefaultRoom();
  }
})();

const saveState = () => {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify({ adminPassword, rooms }, null, 2)); } catch {}
};

const broadcastRoom = (code) => {
  if (rooms[code]) io.to(`room:${code}`).emit('state_update', rooms[code]);
};

// ─── Auction finalization ─────────────────────────────────────────────────────
function finalizeAuction(room) {
  for (const g of room.golfers) {
    if (g.currentBidderId) {
      g.owner   = g.currentBidderName;
      g.ownerId = g.currentBidderId;
      g.bid     = g.currentBid;
    } else {
      g.owner = null; g.ownerId = null; g.bid = null;
    }
  }
  room.phase = 'scoring';
  console.log(`Room ${room.code} auction finalized at`, new Date().toLocaleString());
}

// Check every 5 s: auto-finalize expired auctions, auto-start scheduled ones
setInterval(() => {
  let dirty = false;
  for (const room of Object.values(rooms)) {
    if (room.phase === 'auction' && room.auctionEndTime &&
        Date.now() > new Date(room.auctionEndTime).getTime() + 1000) {
      finalizeAuction(room);
      dirty = true;
      broadcastRoom(room.code);
    }
    if (['setup', 'lobby'].includes(room.phase) && room.settings.scheduledStartTime) {
      const t = new Date(room.settings.scheduledStartTime).getTime();
      if (!isNaN(t) && Date.now() > t) {
        // Use a specific end time if set, otherwise fall back to duration
        if (room.settings.scheduledAuctionEndTime) {
          const endT = new Date(room.settings.scheduledAuctionEndTime).getTime();
          room.auctionEndTime = !isNaN(endT) && endT > Date.now()
            ? new Date(endT).toISOString()
            : new Date(Date.now() + (Number(room.settings.defaultAuctionMinutes) || 30) * 60000).toISOString();
        } else {
          const dur = Number(room.settings.defaultAuctionMinutes) || 30;
          room.auctionEndTime = new Date(Date.now() + dur * 60000).toISOString();
        }
        room.phase = 'auction';
        room.settings.scheduledStartTime = null;
        dirty = true;
        broadcastRoom(room.code);
      }
    }
  }
  if (dirty) saveState();
}, 5000);

// ─── Auth ─────────────────────────────────────────────────────────────────────
const requireAdmin = (req, res, next) => {
  if (req.headers['x-admin-password'] !== adminPassword)
    return res.status(401).json({ error: 'Invalid admin password' });
  next();
};

const getRoom = (code, res) => {
  const room = rooms[(code || '').trim().toUpperCase()];
  if (!room) { res.status(404).json({ error: 'Room not found.' }); return null; }
  return room;
};

// ─── Public routes ────────────────────────────────────────────────────────────
app.get('/api/admin/verify', (req, res) =>
  res.json({ ok: req.headers['x-admin-password'] === adminPassword }));

app.get('/api/admin/rooms', requireAdmin, (_req, res) =>
  res.json({
    ok: true,
    rooms: Object.values(rooms).map(r => ({
      code:               r.code,
      poolName:           r.settings.poolName,
      phase:              r.phase,
      participantCount:   r.participants.length,
      participants:       r.participants.map(p => ({ name: p.name, email: p.email })),
      createdAt:          r.createdAt,
      auctionEndTime:     r.auctionEndTime,
      scheduledStartTime: r.settings.scheduledStartTime,
      entryFee:           r.settings.entryFee,
      pot:                r.golfers.reduce((s, g) => s + (r.phase === 'auction' ? (g.currentBid || 0) : (g.bid || 0)), 0),
      charityPercent:     r.settings.charityPercent,
      payoutSplit:        r.settings.payoutSplit,
    })),
  }));

app.post('/api/admin/rooms/create', requireAdmin, (req, res) => {
  const room = createRoom(req.body.settings || {});
  rooms[room.code] = room;
  saveState();
  res.json({ ok: true, code: room.code, poolName: room.settings.poolName });
});

app.post('/api/admin/rooms/:code/delete', requireAdmin, (req, res) => {
  const code = req.params.code.toUpperCase();
  if (!rooms[code]) return res.status(404).json({ error: 'Room not found' });
  delete rooms[code];
  saveState();
  res.json({ ok: true });
});

// Change global admin password
app.post('/api/admin/password', requireAdmin, (req, res) => {
  const { newPassword } = req.body || {};
  if (!newPassword || String(newPassword).length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  adminPassword = String(newPassword);
  saveState();
  res.json({ ok: true });
});

// Get room state (participants use this to reconnect)
app.get('/api/room/:code/state', (req, res) => {
  const room = getRoom(req.params.code, res);
  if (!room) return;
  res.json(room);
});

// Join with room code
app.post('/api/join', (req, res) => {
  const { roomCode, name, email } = req.body || {};
  if (!roomCode || !name || !email)
    return res.status(400).json({ error: 'Room code, name, and email are required.' });
  const room = rooms[roomCode.trim().toUpperCase()];
  if (!room)
    return res.status(401).json({ error: 'Invalid room code. Check with your pool admin.' });
  if (!['lobby', 'auction', 'scoring', 'final'].includes(room.phase))
    return res.status(400).json({ error: 'Registration is not open yet.' });

  const normEmail = email.trim().toLowerCase();
  const existing  = room.participants.find(p => p.email === normEmail);
  if (existing)
    return res.json({ ok: true, participant: existing, roomCode: room.code, rejoin: true });

  const participant = {
    id:       crypto.randomUUID(),
    name:     name.trim(),
    email:    normEmail,
    joinedAt: new Date().toISOString(),
  };
  room.participants.push(participant);
  saveState();
  broadcastRoom(room.code);
  res.json({ ok: true, participant, roomCode: room.code });
});

// Place a bid
app.post('/api/room/:code/bid', (req, res) => {
  const room = getRoom(req.params.code, res); if (!room) return;
  const { participantId, golferId, amount } = req.body || {};
  if (!participantId || !golferId || amount === undefined)
    return res.status(400).json({ error: 'participantId, golferId, and amount are required.' });

  const participant = room.participants.find(p => p.id === participantId);
  if (!participant) return res.status(401).json({ error: 'Participant not found. Please re-join.' });
  if (room.phase !== 'auction') return res.status(400).json({ error: 'Auction is not currently active.' });
  if (room.auctionEndTime && Date.now() > new Date(room.auctionEndTime).getTime())
    return res.status(400).json({ error: 'The auction has ended.' });

  const golfer = room.golfers.find(g => g.id === golferId);
  if (!golfer) return res.status(404).json({ error: 'Golfer not found.' });
  if (golfer.currentBidderId === participantId)
    return res.status(400).json({ error: 'You are already the highest bidder on this golfer.' });

  const minBid = golfer.currentBid > 0
    ? golfer.currentBid + room.settings.minBidIncrement
    : room.settings.startingBid;
  if (Number(amount) < minBid)
    return res.status(400).json({ error: `Minimum bid is $${minBid}.` });

  const leading = room.golfers.filter(g => g.currentBidderId === participantId && g.id !== golferId).length;
  if (leading >= room.settings.maxGolfersPerPerson)
    return res.status(400).json({
      error: `You're already leading on ${room.settings.maxGolfersPerPerson} golfers (the maximum). You must be outbid on one before bidding on another.`,
    });

  // Anti-snipe: extend timer if bid comes in close to the end
  if (room.auctionEndTime) {
    const remaining   = new Date(room.auctionEndTime).getTime() - Date.now();
    const antiSnipeMs = room.settings.antiSnipeMinutes * 60 * 1000;
    if (remaining > 0 && remaining < antiSnipeMs) {
      room.auctionEndTime = new Date(Date.now() + antiSnipeMs).toISOString();
    }
  }

  golfer.currentBid        = Number(amount);
  golfer.currentBidderId   = participantId;
  golfer.currentBidderName = participant.name;
  golfer.bidCount          = (golfer.bidCount || 0) + 1;
  if (!golfer.bidderIds.includes(participantId)) golfer.bidderIds.push(participantId);

  saveState();
  broadcastRoom(room.code);
  res.json({ ok: true });
});

// ─── Admin room routes (scoped helper) ───────────────────────────────────────
const ra = (suffix, fn) =>
  app.post(`/api/admin/rooms/:code${suffix}`, requireAdmin, (req, res) => {
    const room = getRoom(req.params.code, res); if (!room) return;
    fn(req, res, room);
  });

ra('/settings', (req, res, room) => {
  const fields = ['poolName','charityPercent','payoutSplit','maxGolfersPerPerson',
                  'minBidIncrement','antiSnipeMinutes','startingBid',
                  'defaultAuctionMinutes','scheduledStartTime','scheduledAuctionEndTime','entryFee'];
  fields.forEach(k => { if (req.body[k] !== undefined) room.settings[k] = req.body[k]; });
  saveState(); broadcastRoom(room.code);
  res.json({ ok: true });
});

ra('/golfers', (req, res, room) => {
  room.golfers = (req.body.golfers || []).map(g => ({
    currentBid: 0, currentBidderId: null, currentBidderName: null,
    bidCount: 0, bidderIds: [], owner: null, ownerId: null, bid: null, ...g,
  }));
  saveState(); broadcastRoom(room.code);
  res.json({ ok: true });
});

ra('/participants/remove', (req, res, room) => {
  room.participants = room.participants.filter(p => p.id !== req.body.participantId);
  saveState(); broadcastRoom(room.code);
  res.json({ ok: true });
});

ra('/phase', (req, res, room) => {
  room.phase = req.body.phase;
  saveState(); broadcastRoom(room.code);
  res.json({ ok: true });
});

ra('/roomcode/regenerate', (req, res, room) => {
  const oldCode = room.code;
  const newCode = genRoomCode();
  room.code = newCode;
  rooms[newCode] = room;
  delete rooms[oldCode];
  saveState();
  broadcastRoom(newCode);
  res.json({ ok: true, roomCode: newCode });
});

ra('/auction/start', (req, res, room) => {
  if (req.body.endTime) {
    const t = new Date(req.body.endTime).getTime();
    if (isNaN(t) || t <= Date.now()) return res.status(400).json({ error: 'End time must be in the future' });
    room.auctionEndTime = new Date(t).toISOString();
  } else {
    const dur = Number(req.body.durationMinutes) || room.settings.defaultAuctionMinutes || 30;
    room.auctionEndTime = new Date(Date.now() + dur * 60000).toISOString();
  }
  room.phase = 'auction';
  saveState(); broadcastRoom(room.code);
  res.json({ ok: true, auctionEndTime: room.auctionEndTime });
});

ra('/auction/extend', (req, res, room) => {
  const base = room.auctionEndTime
    ? Math.max(Date.now(), new Date(room.auctionEndTime).getTime())
    : Date.now();
  room.auctionEndTime = new Date(base + Number(req.body.minutes || 5) * 60000).toISOString();
  saveState(); broadcastRoom(room.code);
  res.json({ ok: true, auctionEndTime: room.auctionEndTime });
});

ra('/auction/finalize', (req, res, room) => {
  finalizeAuction(room);
  saveState(); broadcastRoom(room.code);
  res.json({ ok: true });
});

ra('/auction/clearbid', (req, res, room) => {
  const g = room.golfers.find(g => g.id === req.body.golferId);
  if (!g) return res.status(404).json({ error: 'Not found' });
  g.currentBid = 0; g.currentBidderId = null; g.currentBidderName = null;
  g.bidCount = 0; g.bidderIds = [];
  saveState(); broadcastRoom(room.code);
  res.json({ ok: true });
});

ra('/scores/refresh', async (req, res, room) => {
  try {
    const scores = await fetchMastersScores();
    if (scores && Object.keys(scores).length) {
      room.scores = scores;
      room.lastScoreUpdate = new Date().toISOString();
      saveState(); broadcastRoom(room.code);
      res.json({ ok: true, count: Object.keys(scores).length });
    } else {
      res.json({ ok: false, message: 'Tournament scores not available yet.' });
    }
  } catch (e) {
    res.json({ ok: false, message: e.message });
  }
});

ra('/scores/manual', (req, res, room) => {
  for (const u of (req.body.scores || [])) {
    room.scores[u.name] = {
      position:   u.position   || '--',
      totalScore: u.totalScore || 'E',
      status:     u.status     || 'active',
      rounds:     u.rounds     || [],
    };
  }
  room.lastScoreUpdate = new Date().toISOString();
  saveState(); broadcastRoom(room.code);
  res.json({ ok: true });
});

ra('/reset', (req, res, room) => {
  const { code, settings: { poolName } } = room;
  const fresh = createRoom({ poolName });
  fresh.code = code;
  rooms[code] = fresh;
  saveState(); broadcastRoom(code);
  res.json({ ok: true });
});

// ─── ESPN score fetcher ───────────────────────────────────────────────────────
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    httpsLib.get(url, {
      headers: { 'User-Agent': 'MastersPool/1.0', Accept: 'application/json' },
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302)
        return resolve(httpsGet(res.headers.location));
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
  socket.on('join_room', (code) => {
    if (!code) return;
    const key = String(code).toUpperCase();
    socket.join(`room:${key}`);
    if (rooms[key]) socket.emit('state_update', rooms[key]);
  });
  socket.on('leave_room', (code) => {
    if (code) socket.leave(`room:${String(code).toUpperCase()}`);
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, '0.0.0.0', () => {
  const localIP = Object.values(os.networkInterfaces()).flat()
    .find(i => i?.family === 'IPv4' && !i.internal)?.address || 'localhost';
  const codes = Object.keys(rooms).join(', ');
  console.log("\n🏌️  Graham's Masters Pool 2026");
  console.log('══════════════════════════════════════');
  console.log(`  Local:      http://localhost:${PORT}`);
  console.log(`  Network:    http://${localIP}:${PORT}`);
  console.log(`  Room(s):    ${codes}`);
  console.log(`  Admin pw:   ${adminPassword}`);
  console.log('══════════════════════════════════════\n');
});
