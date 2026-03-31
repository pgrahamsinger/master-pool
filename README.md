# Churchill Masters Pool 2026

A live Calcutta auction pool app with real-time bidding and tournament scoring.

---

## Deploying to Render.com (Recommended — Free, Public URL)

### Step 1 — Push to GitHub
1. Create a free account at [github.com](https://github.com) if you don't have one
2. Create a new repository (name it `masters-pool`)
3. Upload this entire `masters-pool` folder to the repository (drag-and-drop works in the GitHub UI)

### Step 2 — Deploy on Render
1. Create a free account at [render.com](https://render.com)
2. Click **New → Web Service**
3. Connect your GitHub account and select the `masters-pool` repo
4. Render will auto-detect the settings from `render.yaml`
5. Click **Deploy Web Service**
6. After ~2 minutes, your app is live at a URL like: `https://masters-pool.onrender.com`

### Step 3 — Share
- Share the public URL with everyone at the firm
- Log in as admin to get started (see below)

> **Note on Render free tier:** The service will "spin down" after 15 minutes of no visitors, causing a ~30-second cold start on first load. During an active auction with people checking in, it won't sleep. For the tournament week, consider upgrading to the $7/month "Starter" plan to keep it always-on.

---

## Running Locally (No Internet Required)

Requires [Node.js](https://nodejs.org) v18+.

```
npm install
node server.js
```

The terminal shows:
```
  Local:     http://localhost:3000
  Network:   http://192.168.1.42:3000   ← share with office
  Room code: XK7P2Q
  Admin pw:  masters2026
```

---

## How to Run Your Pool

### 1. Setup (Admin)
- Open the app and click **⚙ Admin** → log in (default password: `masters2026`)
- Your **room code** is displayed — copy it to share with participants
- Configure: pool name, charity %, payout split (default 60/25/15), max golfers per person, bid increment
- Review/edit the golfer field (55 pre-loaded Masters invitees)
- Click **Open Registration Lobby** when ready

### 2. Lobby
- Participants visit the URL, enter the room code, their name, and email
- They appear on your lobby screen in real-time
- When everyone is in, click **Start Live Auction**
- Set the duration (15 min to 2 hours) — 30 min is a good default

### 3. Live Auction
Everyone sees all golfers simultaneously with a live countdown timer:
- Participants click any golfer card to place a bid
- Bids must exceed the current high bid by the minimum increment ($5 default)
- Each person can lead on a maximum of N golfers at a time (configurable)
- **Anti-snipe:** any bid in the last 2 minutes extends the clock by 2 minutes
- **Outbid alerts** appear at the top when someone beats your bid
- When the timer hits zero, all winners are locked in automatically

### 4. Tournament Scoring (April 10–13)
- Admin clicks **↻ Refresh Scores** to pull live data from ESPN's API
- Everyone's screen updates instantly
- **Owner Standings** shows projected payouts based on current positions
- **Golfer Leaderboard** shows the full Masters field
- If ESPN auto-fetch fails, use **✎ Manual Score Entry**
- Click **🏆 Finalize** when the tournament ends

### 5. Final Results
- Official payouts shown by owner
- Charity contribution displayed

---

## Settings Reference

| Setting | Default | Description |
|---|---|---|
| Charity % | 20% | % of total pot donated to charity |
| Payout split | 60/25/15 | % to owner of 1st/2nd/3rd place finisher |
| Max golfers/person | 3 | Max a single person can be leading at once during auction |
| Min bid increment | $5 | Minimum amount above current bid |
| Starting bid | $5 | Minimum first bid on any golfer |
| Anti-snipe | 2 min | Timer extension when bid placed near end |

---

## Admin Password
Default: `masters2026`

Change it via Setup → Settings → New Admin Password.

## Data Persistence
State is saved to `state.json` automatically. If the server restarts, it reloads from this file. On Render's free tier, the filesystem is ephemeral (wiped on redeploy), so avoid redeploying mid-auction.
