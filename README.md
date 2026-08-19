# Shooting Ladder

Shooting Ladder is a mobile-first team web app for logging basketball shooting workouts. Players can tap their name, save a workout score, and review season totals, career averages, percentages, and leaderboards from the same screen.

## Features

- Add and remove players from the team roster.
- Log workout date, workout type, score, makes, attempts, and notes.
- Track a selected season while also keeping career totals.
- Review team-wide and player-specific averages, percentages, and leaderboards.
- Save data locally in the device browser so the app can live on a phone home screen.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Current storage model

This version stores data in browser localStorage. That is enough for a quick team tool or prototype, but not enough for shared cross-device team data.

## Logical next upgrade

To use this across a full team and keep multi-year data safely synced, the next step is to add:

- Authentication for coaches and players.
- A shared database for roster and workout history.
- Role-based permissions and export/reporting.
