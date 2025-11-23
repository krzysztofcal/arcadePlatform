# Server-Side XP Calculation Rules

This document describes how XP is calculated for each game when server-side calculation is enabled.

## Enabling Server-Side Calculation

Server-side XP calculation can be enabled via:

```javascript
// Option 1: Global flag
window.XP_SERVER_CALC = true;

// Option 2: URL parameter
https://example.com/game?xpserver=1

// Option 3: localStorage
localStorage.setItem('xp:serverCalc', '1');
```

## How XP is Calculated

When a game window is sent to the server, XP is calculated based on:

1. **Base XP** - Time-based XP from active gameplay
2. **Score XP** - XP from score changes (game-specific ratio)
3. **Event XP** - Bonus XP from specific game events
4. **Multipliers** - Combo and boost multipliers

### Formula

```
Total XP = (Base XP + Score XP + Event XP) × Combo Multiplier × Boost Multiplier
```

Capped at `MAX_XP_PER_SECOND × window_seconds` (default: 24 XP/s × 10s = 240 XP max per window)

---

## Game-Specific Rules

### Default (Unknown Games)

Used for any game without specific rules.

| Parameter | Value | Description |
|-----------|-------|-------------|
| Base XP/second | 10 | Standard activity-based XP |
| Score-to-XP Ratio | 0.01 | 100 score = 1 XP |
| Max Score XP/window | 50 | Cap on score-based XP |

---

### Tetris

| Parameter | Value | Description |
|-----------|-------|-------------|
| Base XP/second | 10 | Standard activity-based XP |
| Score-to-XP Ratio | 0.005 | 200 score = 1 XP (high scores) |
| Max Score XP/window | 100 | Cap on score-based XP |

**Events:**

| Event | XP | Description |
|-------|-----|-------------|
| `line_clear` | 5 × lines | 5 XP per line cleared |
| `tetris` | 40 | Bonus for clearing 4 lines at once |
| `level_up` | 10 × level | 10 XP per level achieved |

---

### 2048

| Parameter | Value | Description |
|-----------|-------|-------------|
| Base XP/second | 10 | Standard activity-based XP |
| Score-to-XP Ratio | 0.02 | 50 score = 1 XP |
| Max Score XP/window | 80 | Cap on score-based XP |

**Events:**

| Event | XP | Description |
|-------|-----|-------------|
| `tile_merge` | log₂(value) | Higher tiles = more XP (2048 tile = 11 XP) |
| `milestone` | 5 × (score/1000) | 5 XP per 1000 points reached |

---

### Pacman

| Parameter | Value | Description |
|-----------|-------|-------------|
| Base XP/second | 10 | Standard activity-based XP |
| Score-to-XP Ratio | 0.01 | 100 score = 1 XP |
| Max Score XP/window | 60 | Cap on score-based XP |

**Events:**

| Event | XP | Description |
|-------|-----|-------------|
| `ghost_eaten` | 10 | Eating a ghost |
| `power_pellet` | 5 | Eating a power pellet |
| `level_complete` | 15 × level | Level completion bonus |

---

### T-Rex Runner

| Parameter | Value | Description |
|-----------|-------|-------------|
| Base XP/second | 10 | Standard activity-based XP |
| Score-to-XP Ratio | 0.02 | 50 score = 1 XP |
| Max Score XP/window | 50 | Cap on score-based XP |

**Events:**

| Event | XP | Description |
|-------|-----|-------------|
| `milestone` | 2 × (distance/100) | 2 XP per 100 distance |

---

### Catch Cats

| Parameter | Value | Description |
|-----------|-------|-------------|
| Base XP/second | 10 | Standard activity-based XP |
| Score-to-XP Ratio | 1.0 | 1 cat = 1 XP (direct mapping) |
| Max Score XP/window | 30 | Cap on score-based XP |

**Events:**

| Event | XP | Description |
|-------|-----|-------------|
| `cat_caught` | 1 | Each cat caught |
| `streak` | 5 (if count ≥ 5) | Bonus for catching 5+ cats in a row |
| `level_up` | 2 × level | Level-up bonus |

**Slug aliases:** `cats`, `catch-cats`, `game_cats`

---

## Combo System

The combo multiplier builds as players stay active:

| Combo Stage | Bonus |
|-------------|-------|
| 1 | 0% |
| 2 | 3% |
| 5 | 12% |
| 10 | 27% |
| 20 (max) | 57% |

**Combo Mechanics:**
- **Build phase**: Gain combo points through activity
- **Sustain phase**: 5 seconds at max combo (stage 20)
- **Cooldown phase**: 3 seconds, multiplier resets to 1

---

## Global Caps

These caps apply regardless of game:

| Cap | Value | Description |
|-----|-------|-------------|
| Daily Cap | 3,000 XP | Maximum XP per day (resets 03:00 Warsaw time) |
| Session Cap | 300 XP | Maximum XP per session |
| Delta Cap | 300 XP | Maximum XP per request |
| Rate Limit | 10 req/min | Per-user request limit |

---

## Activity Requirements

When `XP_REQUIRE_ACTIVITY=1` (default for server calc):

| Requirement | Value | Description |
|-------------|-------|-------------|
| Min Input Events | 4 | Minimum input events per window |
| Min Visibility | 8 seconds | Minimum time tab must be visible |

---

## Adding New Game Rules

To add rules for a new game, edit `netlify/functions/calculate-xp.mjs`:

```javascript
const GAME_XP_RULES = {
  // ... existing games ...

  "new-game": {
    baseXpPerSecond: 10,          // Base XP rate
    scoreToXpRatio: 0.01,         // Score-to-XP conversion
    maxScoreXpPerWindow: 50,      // Cap per window
    events: {
      some_event: (value) => value * 2,  // Custom event handler
      bonus: () => 10,                    // Fixed bonus
    }
  },
};
```

---

## API Endpoint

**POST** `/.netlify/functions/calculate-xp`

**Request:**
```json
{
  "userId": "user-123",
  "sessionId": "sess-456",
  "gameId": "tetris",
  "windowStart": 1700000000000,
  "windowEnd": 1700000010000,
  "inputEvents": 20,
  "visibilitySeconds": 10,
  "scoreDelta": 1000,
  "gameEvents": [
    { "type": "line_clear", "value": 4 },
    { "type": "level_up", "value": 2 }
  ],
  "boostMultiplier": 1.5
}
```

**Response:**
```json
{
  "ok": true,
  "awarded": 45,
  "calculated": 52,
  "capped": true,
  "totalToday": 145,
  "totalLifetime": 5230,
  "remaining": 2855,
  "combo": {
    "multiplier": 3,
    "mode": "build",
    "progress": 0.6
  }
}
```
