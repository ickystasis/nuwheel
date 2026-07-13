# Changelog

## [unreleased]

### UI / Layout
- Full-viewport layout: victims panel left, wheel center, right side panel
- Header removed, utility buttons (emoji-only) moved above victims panel
- Action buttons (Shuffle, Abort, Verdict, Accept) + winner display moved to right panel, stacked vertically
- Total weight shown at top-right of screen, error messages below right panel buttons
- Canvas dynamically resized to fill available space
- Utility buttons get distinct background colors per type

### Wheel Rendering
- Segment border lines scale with wheel size (no more thick lines on small wheels)
- Wheel text outline and size proportional to wheel size
- Text wrapping: shrinks font instead of truncating with …; checks all lines for overflow
- Winner details now shows percentage: "2/18 (11%) — by David"

### Flow & Lifecycle
- Shuffle order preserved across Accept, Abort, and Verdict (only resets on tile add/remove or manual shuffle)
- Shuffle hidden during vote phase (added showVoting check)
- Abort timeout: clears lastWinnerInfo before renderAll, no longer shows Accept button after abort
- Verdict timeout: same ordering fix, Abort button hidden immediately on verdict click
- "Bypass point assignment checks" renamed to "Point Override"

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
