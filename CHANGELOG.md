# Changelog

## [unreleased]

### Winner History
- Weight display shows percentage: `W:2/43 (5%)`
- Proposer pill shows actual vote emoji (👎 punish, 🤷 abstain, 👍 pass) as a styled vote-chip
- Proposer filtered from watcher vote chip list (no duplicate entry)
- All names in vote chips resolved through `allWatchers` case-insensitively for consistent casing
- Proposer vote lookup uses watcher ID first, then case-insensitive name fallback (handles renames and import casing)
- Proposer skip check matches by ID or case-insensitive name
- Tooltips migrated from native `title` attribute to floating `#winnersTooltip` div for OBS window-capture compatibility
- Tooltip content includes weight percentage per movie
- `backdrop-filter: blur(4px)` removed from `.modal-overlay` for OBS compatibility

### Bug Fixes
- Fixed temporal-dead-zone crash (`votesData` read before its `let` declaration)
- Fixed duplicate `let` declarations for `votesData` and `spinMovies` in same scope
- Fixed case mismatch between imported vote keys (lowercase) and stored `watcher_name` (original casing)

## [1.5.1] - 2026-07-12

- Wheel text: white fill with thick black outline
- Wheel text: auto-scales font size to fit tile
- Wheel text: centered between center button and wheel edge
- Wheel text: word-wraps to 2 lines when too long

## [1.5.0] - 2026-07-12

- Sound effects on spin/result
- Stats dashboard
- Victim color indicator
- Refactored debt matrix system
- Shuffle Wheel button (randomizes wheel order without affecting victim panel)
- Punish streak tooltip (hover streak badge to see movies in current streak)

## [1.4.0] - 2026-07-12

- Accept Results flow
- WebSocket spin sync
- DB-stored segment order

## [1.3.0] - 2026-07-12

- Punish streak multiplier
- Fractional title weights
- Budget validation per watcher
- Segment shuffling on spin

## [1.2.0] - 2026-07-12

- Admin password config via env var
- Docker security warning

## [1.1.0] - 2026-07-12

- Real-time WebSocket sync for all mutations
- Budget fixes and edge cases
- Session persistence across restarts

## [1.0.0] - 2026-07-12

- Watcher Points system with debt matrix
- Punish / Return flow
- Admin panel for manual adjustments
- Spinning wheel with Canvas rendering
- SQLite persistence
