# ⚽ Kickoff — Online Multiplayer Football

## File Structure
```
football-online/
├── server.js          ← Node.js game server (physics + rooms)
├── package.json
└── public/
    ├── index.html     ← Lobby + game UI
    ├── style.css      ← All styles
    └── game.js        ← Canvas rendering + socket client
```

---

## Run Locally (play on same Wi-Fi)

### 1. Install Node.js
Download from https://nodejs.org (LTS version)

### 2. Install dependencies
```bash
cd football-online
npm install
```

### 3. Start the server
```bash
npm start
```

### 4. Open the game
- **You:** open http://localhost:3000
- **Friends on same Wi-Fi:** open http://YOUR_LOCAL_IP:3000
  - Find your local IP: run `ipconfig` (Windows) or `ifconfig` (Mac/Linux)
  - Look for something like `192.168.1.42`

---

## Deploy Online (free) — Play from anywhere

### Option A: Railway (recommended, easiest)

1. Go to https://railway.app and sign up (free)
2. Click **New Project → Deploy from GitHub repo**
3. Push your code to GitHub first:
   ```bash
   git init
   git add .
   git commit -m "football game"
   # create a repo on github.com, then:
   git remote add origin https://github.com/YOUR_USERNAME/football-online.git
   git push -u origin main
   ```
4. In Railway, select your repo → it auto-detects Node.js
5. Railway gives you a URL like `https://football-online-production.up.railway.app`
6. Share that URL with friends — anyone can play from anywhere!

### Option B: Render (also free)

1. Go to https://render.com and sign up
2. New → Web Service → connect your GitHub repo
3. Settings:
   - **Build command:** `npm install`
   - **Start command:** `npm start`
4. Deploy → get your public URL

---

## How to Play

### Modes
| Mode | Left Team | Right Team |
|------|-----------|------------|
| 1v1  | 1 player  | 1 player   |
| 2v1  | 2 players | 1 player   |
| 1v2  | 1 player  | 2 players  |
| 2v2  | 2 players | 2 players  |

### Starting a game
1. Player 1 (host): enter your name → **Create Room** → choose mode
2. Share the 4-letter room code with friends
3. Friends: enter their name → **Join Room** → enter the code
4. If a slot is empty, that team just has fewer players
5. Host clicks **Start Game** when ready
6. Countdown 3…2…1… then play!

### Controls
Every player uses the same keys on their own device:
- **W / A / S / D** — move up / left / down / right
- **Arrow keys** also work

### Scoring
- Push the ball into the opponent's goal (left or right net)
- Match lasts **2 minutes**
- Highest score wins. Draw if equal.

---

## Customising

| Setting | File | Variable |
|---------|------|----------|
| Match duration | `server.js` | `MATCH_DUR` (seconds) |
| Player speed | `server.js` | `PLAYER_SPEED` |
| Ball kick force | `server.js` | `KICK_FORCE` |
| Ball friction | `server.js` | `BALL_FRIC` |
