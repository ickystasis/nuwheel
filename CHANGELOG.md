# Changelog

## [1.8.5] - 2026-07-17

### Fixed
- `renderWatchers()` crash on page load: `activeNames` was referenced in the points tooltip code but only defined in `renderVerdict()`, causing victim panel and wheel to fail to render

## [1.8.4] - 2026-07-17

### Added
- Version endpoint `GET /api/version` and build number displayed in the Admin Panel footer — makes it easy to tell which build is running
- `VERSION` constant in `app/__init__.py`, served via new route in `routes.py`

### Fixed
- Point breakdown tooltips on the victim panel now only show debts involving current (active) participants. If a watcher isn't on the wheel, their debts are filtered out of the tooltip
- `run.sh` and `backup.sh` converted to LF line endings for Alpine Linux compatibility — Docker container was crash-looping on CRLF scripts

## [1.8.3] - 2026-07-17

### Fixed
- Pass verdict no longer clears debts the winner owes to others (`pass_movie()` in `routes.py`). Debts owed **TO** the winner are already cleared by `process_win()` before the verdict; the pass endpoint was incorrectly also clearing debts the winner **owes** to others (e.g. Anthony owing 2 to G. Matt), returning those points when it should not have

## [1.8.2] - 2026-07-15

### Removed
- Import History button and all related code (CSV import modal, API endpoint, backend logic) — was hardcoded for personal use, data already imported

### Fixed
- Winner weight in the Previous Winners panel now preserves decimal values — changed `int()` to `float()` in the save_winner route and updated DB schema from `INTEGER` to `REAL` for weight/total_weight columns

### Moved
- Change Center Image button removed from toolbar and relocated to the Admin Panel (🔧 Setup) — file input accessible only after authentication

### UI
- Toolbar buttons reordered: left side = 🏆 Past Winners, 📊 Stats; right side = 👤 Select Victims, 🔧 Admin, 🔒 Login/Logout
- Select Victims button now hidden when page is locked (requires authentication), matching Admin button behavior
- Minimum font size for wheel segment text on small tiles increased from 12px to 14px

### Infrastructure
- Database backup script (`backup.sh`) — copies `wheel.db` to `/data/backups/` daily at noon with 14-day rolling retention
- Cron daemon (`crond`) started in container to run the backup schedule
- Dockerfile now uses `CMD ["sh", "/app/run.sh"]` (run.sh includes cron setup)

## [1.8.1] - 2026-07-15

### Recent Movies Popup
- Recent movies popup now surfaces movies from three sources: wheel losses (movies the watcher had on the wheel during any spin, even when others won), archived titles (movies removed from the wheel), and winner history — making it easy to re-add previously removed movies
- Sources prioritized by most recent date, deduplicated by name, max 10 items
- Each entry shows the date the movie was last on the wheel in grey text below the title

### Victim Panel Visibility
- Victim panel auto-hides during wheel spin and winner display, reappears when voting phase starts — puts focus on the wheel during the spin
- Button bar remains visible at all times
- All CSS transitions removed from victim panel controls (+/-, delete, inputs, add-title) for instant response

### UI Cleanup
- Spin Settings button (⚙️) and modal removed — the sliders had no effect on wheel physics
- Lock/Unlock button (🔒) moved to always be the rightmost button in the toolbar
- Clear History button removed from Previous Winners modal

### Wheel Text Scaling
- Segment text starting font size now scales with segment arc size — smaller tiles get proportionally smaller text
- Angular constraint added: text width at the text radius must also fit within the segment's arc, preventing overlap into neighboring tiles

### Winners Modal Filters
- Three dropdown filters added: Judgement (All/Punished/Not Punished), Weight (All/True 1-Weight), Proposer (All/per-watcher)
- Title search bar with live filtering as you type
- Reset button appears only when a filter is active
- All filters combine with AND logic; filters reset when modal opens
- Winners modal width increased to 760px to fit the full filter bar
- Status toggle (Active/Disabled) now requires admin password

### Configuration
- `SITE_TITLE` environment variable added to customize the browser tab title (default: Wheel of Doom(b))
- README Configuration and Audio Volume Mounts tables reformatted for clarity

## [1.8.0] - 2026-07-14

### Password Protection
- Lock/Unlock button replaces exposed admin button — settings, wheel spin, edits, and votes require password re-entry on each page load
- Auth persisted via 10-year cookie (`wheel_auth=1`) so you don't need to re-enter every visit
- All protected controls (victim panel edits, spin, vote toggles, debt cells, center image, admin panel) dim when locked; tooltips on debt cells remain visible
- `ADMIN_PASSWORD` env var reused for the new lock system

### Wheel Lock
- Victim/movie/points editing disabled during spin, voting, and winner-pending states to prevent mid-round corruption
- `wheelLocked()` guard applied to all title mutations, plus/minus buttons, remove-from-session, and add-watcher buttons

### Bug Fixes
- Wheel recovery now saves `segmentOrder` alongside `wheelRotation` so restored spins draw segments in the correct order (previously shifted after page reload due to `display_order` changes)
- Debt matrix diagonal cells (same debtor/creditor) no longer show a tooltip

### Verdict Messages
- Punish/pass/abort messages now persist on screen until the next spin (instead of auto-dismissing after 2-2.5s)
- Punish message shows per-user breakdown: `2 added to David (5 total)`, one line per user
- Pass message shows per-user breakdown: `1 returned to Chris`, one line per user
- Pass endpoint now clears debts in both directions (winner as debtor + winner as creditor), so all returned points are reported
- Debts already cleared by `process-win` are included in the pass message
- Pass message omits "streak reset to 0" when streak is already 0

### UI Safeguards
- Watcher remove (✕) button hidden during spin, while winner is displayed, and during voting to prevent accidental removal mid-round

### Wheel Physics
- Complete rewrite of spin animation to pure physics simulation (`dv/dt = -(k·v + c)`)
- Initial velocity: 150–300 RPM base with 75%–125% random multiplier (~113–375 RPM range)
- Velocity-proportional friction (`k = 0.03–0.10`): braking fades with speed — fast at first, nearly zero at low speeds
- Constant friction term (`c = 0.008–0.014 rad/s²`): ensures the wheel eventually stops instead of crawling forever
- No time targets, no rotation counts, no easing curves — just spin until it naturally dies
- Winner determined by `getWinnerSegmentIndex()` at the final resting position (not predetermined)

### Stats & Debt Matrix
- Stats modal merged into debt matrix modal — single popup shows debt matrix on top, stats below
- New stats columns: Att.%, Pick%, Adj.Pick%, Pun.%, ⚖️ (punish votes), VotePun%
- 3-month cutoff stats: same stats computed for last 90 days, cutoff date shown in the section header
- Punish vote tracking: counts how many times each watcher voted to punish
- Attendance counting now verifies via votes JSON (imported data no longer inflates attendance)
- 💳 button removed, only 📊 opens the combined modal
- Modal background now extends full height with scroll

### Winner History
- All tooltips (victim panel + previous winners) increased by 30%
- Previous winners tooltip header shows `{user}'s movies this spin` instead of generic text
- Abandoned spins show participants as grey pill chips with 🚫 emoji (matching voted spin layout)
- Abandoned spin proposer pill uses grey `vote-chip-aborted` styling with 🚫 emoji
- Proposer excluded from participant chip list for abandoned spins
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
- Fixed internal nginx listening on port 443 instead of 9642 (mismatch with docker-compose port mapping)
- Fixed temporal-dead-zone crash (`votesData` read before its `let` declaration)

### Movie Archive & Recent Movies Popup
- Deleting a movie now archives it server-side instead of permanent deletion (can be restored later)
- Clicking "Add movie" creates an empty row and focuses it
- Focusing an empty title input shows a popup of the last 10 movies that watcher has previously spun (from winner history), positioned to the right of the victims panel and vertically centered on the button
- Clicking a movie in the popup fills the existing blank row's inputs with that name and points and triggers save (no separate POST)
- Titles returned in creation order (id ASC) so new entries always appear at the bottom of the victim list
- Popup hides when typing or on blur (200ms delay to allow clicking popup items)
- Archived movies and recent-movies list work across browsers — no cookies needed
- Fixed duplicate `let` declarations for `votesData` and `spinMovies` in same scope
- Fixed case mismatch between imported vote keys (lowercase) and stored `watcher_name` (original casing)
- Fixed Docker build not picking up file changes on Windows (use `--build` flag)
- Spin is now properly blocked during voting phase (JS guards + error message)
- Canvas center-click can no longer bypass spin guards during voting

### Server-Side Persistence
- Center image, spin settings, and active participant selection now stored server-side via new `app_settings` DB table and `/api/settings` endpoints
- Settings persist across browser refreshes and are shared between all clients
- `GET /api/settings` returns all stored settings; `PUT /api/settings` upserts key-value pairs
- `GET /api/data` falls back to stored `active_ids` when no query param provided

### UI / Layout
- Full-viewport layout: victims panel left, wheel center, right side panel
- Header removed, utility buttons (emoji-only) moved above victims panel
- Action buttons (Shuffle, Abort, Verdict, Accept) + winner display moved to right panel, stacked vertically
- Total weight shown at top-right of screen, error messages below right panel buttons
- Canvas dynamically resized to fill available space
- Utility buttons get distinct background colors per type

### Wheel Rendering
- Center image rotates in sync with wheel segments during spin
- Wheel slow idle rotation (~35s/rev) when idle, stops during spin/vote, resumes after abort/verdict
- Winning tile rotation saved to localStorage on accept and restored on incomplete spin recovery
- Shuffle button hidden during incomplete spin state recovery
- Segment border lines scale with wheel size (no more thick lines on small wheels)
- Wheel text outline and size proportional to wheel size
- Text wrapping: shrinks font instead of truncating with …; checks all lines for overflow
- Winner details now shows percentage: "2/18 (11%) — by David"

### Flow & Lifecycle
- Shuffle order preserved across Accept, Abort, and Verdict (only resets on tile add/remove or manual shuffle)
- Shuffle hidden during vote phase (added showVoting check)
- Voting-phase spin attempt shows error message "Voting in progress — accept or abort first"
- Previous winners modal: verdict judgement emojis are display-only (no longer toggleable)
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
