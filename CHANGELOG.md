# Changelog

## [1.9.7] - 2026-08-08

### Changed
- Successfully loudness-normalized audio is now renamed with an `N_` prefix (e.g. `song.mp3` → `N_song.mp3`) so it's easy to tell processed files apart at a glance. The prefix is applied exactly once (`N_...` files keep their name), and only when normalization actually succeeded — failed or missing-ffmpeg uploads keep their original name (still best-effort).
- Upload endpoints (`/api/user-media/upload`, `/api/admin/defaults/upload`) now report the final on-disk filename so the stored name matches what's served. The `normalize_media.py` batch tool shows the prefixed target name in dry-run and after normalizing.

### Version
- Bumped to 1.9.7

## [1.9.6] - 2026-08-08

### Fixed
- Admin Panel default-media uploads were broken: the three file-input handlers called a non-existent function name (`adminDefaultUploadMedia`), so picking a file threw a `ReferenceError` and did nothing. Handlers now call `adminUploadDefaultMedia`, and uploads save + loudness-normalize as intended.

### Changed
- Admin Panel wording updated to make the fallback behavior explicit: "Default Media Pools" → **Fallback Media Pools**, with **Fallback Songs**, **Fallback Cheers**, **Fallback Graphics** upload rows. README section renamed to match.

### Version
- Bumped to 1.9.6

## [1.9.5] - 2026-08-07

### Added
- Admin Panel now has a **Default Media Pools** section for uploading shared default songs, cheers, and graphics without touching the server volume. Uploads go to `<DB_DIR>/media/default/{song,cheer,graphic}` and are validated exactly like per-watcher uploads (extension allowlist, magic-byte sniffing, MIME allowlist, 50 MB cap) via the new `POST /api/admin/defaults/upload` endpoint.
- Audio uploaded to the default pools is loudness-normalized just like per-watcher audio (songs → -16 LUFS, cheers → -14 LUFS via `ffmpeg` EBU R128, best-effort). Validation/save logic shared with user uploads through `_validate_media_upload` / `_save_and_normalize_media` helpers in `app/routes.py`.
- After a default upload the frontend refreshes the song/cheer pools and shows live pool counts (songs/cheers/graphics) in the admin panel.
- Tests: 4 new cases in `tests/test_user_media.py` for default-pool upload/list/serve and rejection paths.

### Version
- Bumped to 1.9.5

## [1.9.4] - 2026-08-07

### Changed
- Default media pools (songs, cheers, graphics) moved out of the repo/static folder into the data volume: `data/media/default/{song,cheer,graphic}` (`<DB_DIR>/media/default/...` at runtime). Media is no longer bundled in the Docker image — drop your own files into these folders on the `wheel-data` volume to populate defaults.
- `GET /api/media/<type>` now lists the default pool by media type (`song`/`cheer`/`graphic`), and defaults are served from the pool via new `GET /api/media/<type>/<file>` (the old static `music`/`cheers` endpoints are gone).
- New default **graphic** pool: watchers with no uploaded graphic fall back to a random default-pool graphic before the admin center image, and selections persist (`default:<file>` values) so they don't re-randomize on refresh.
- Frontend default audio URLs point at the new `/api/media/{song,cheer}/` endpoints.
- The previously bundled `.wav` files were removed from the repo (they live in the gitignored local `data/` tree for seeding a server volume); `data/` added to `.gitignore`.
- README and `docker-compose.yml` updated for the new media layout; `normalize_media.py` defaults point at `data/media/default`.

### Version
- Bumped to 1.9.4

## [1.9.3] - 2026-08-07

### Added
- Audio is now loudness-normalized (EBU R128 via `ffmpeg loudnorm`) so every song and cheer plays at a consistent perceived volume regardless of how it was mixed:
  - Songs normalized to **-16 LUFS**, cheers to **-14 LUFS**, with a -1.5 dB true-peak ceiling and leading/trailing silence trimmed; outputs re-encoded to 44.1 kHz stereo (same file type as the source).
  - New `app/audio_loudness.py` helper normalizes uploads in place via `upload_media` — best-effort, the original file is kept untouched if ffmpeg fails or the container lacks it.
  - New `normalize_media.py` batch tool to normalize existing trees (target loudness derived from directory name: `music`/`song` → -16, `cheers`/`cheer` → -14); defaults to the built-in pools + `<DB_DIR>/media`, supports `--dry-run`.
  - `ffmpeg` added to the Docker image.
- Tests: `tests/test_audio_loudness.py` (target mapping, wav/mp3 normalization, garbage-input safety, graceful failure).

### Changed
- Version bumped to 1.9.3

## [1.9.2] - 2026-08-07

### Fixed
- The winning cheer now plays the **new** winner's cheer pool instead of the previous winner's. `pickMediaAudio()` now accepts an explicit winner id (`preferredId`), and `onSpinComplete()` passes the landed winner's id to `playCheer()`, so the cheer fires with the new winner's center-image swap. Spin music still biases toward the previous winner.
- `PREV_WINNER_BIAS` renamed to `WINNER_MEDIA_BIAS` to reflect that the bias now targets whichever winner's media is being played (previous for the spin song, the reveal winner for the cheer).

### Changed
- Version bumped to 1.9.2

## [1.9.1] - 2026-08-02

### Fixed
- Winner's wheel center graphic now stays locked to the exact image that was on screen when the spin was accepted — the chosen graphic filename is persisted server-side (`last_spin_winner_graphic`) alongside `last_spin_winner_id`, so a page refresh no longer re-randomizes the image. A new winner replaces it, and aborting a spin reverts to the previous committed winner's exact image.
- Missing or deleted media never breaks the wheel: if a committed graphic file is gone it falls back to the default/admin center image, and if a picked song/cheer 404s the audio falls back to the built-in `music/`/`cheers/` pool (`mediaAudio()` helper).

### Changed
- Version bumped to 1.9.1

## [1.9.0] - 2026-08-02

### Added
- User Media button (🎵, right toolbar, second from left) — any user can now upload personal media per watcher, opened from a modal with a cascading picker (watcher → media type → file):
  - 👏 Cheer and 🎵 Song: `.mp3` / `.wav` up to 50 MB
  - 🖼️ Wheel Center Graphic: `.jpg` / `.jpeg` / `.png` up to 50 MB
  - Watcher dropdown shows each user's color swatch
- Uploads stored server-side in `/data/media/<user_id>/<type>/` and served to all clients via new endpoints `POST /api/user-media/upload`, `GET /api/user-media/<id>/<type>`, `GET /api/user-media/<id>/<type>/<file>` — no rebuild needed to add media
- Strict upload validation: extension allowlist, magic-byte content sniffing (`_sniff_media_type`), MIME allowlist, and a 50 MB cap (plus `client_max_body_size 50m` in nginx) — renamed/misleading files are rejected
- Audio now prefers the previous spin winner's personal pool: 99% chance their uploaded song/cheer plays (`PREV_WINNER_BIAS = 0.99`), falling back to the built-in `music/`/`cheers/` pool if they have none or in the remaining 1%
- Winner's uploaded graphic is shown on the wheel center the moment the spin lands and stays until the next winner is chosen (falls back to the admin center image)
- `last_spin_winner_id` persisted server-side via `/api/settings` (replaces the old `localStorage` tracking); on first run after this release it is seeded from the most recent winner in history, so the media bias works immediately on an already-live database
- Media lists are re-fetched at spin time (and again on cheer) so uploads made right up to the spin count
- Tests: `tests/test_user_media.py` (12 cases: upload accept/reject paths, list/serve, last-winner seeding)

### Fixed
- Wheel tiles no longer rearrange when Render Judgement or Abandon is clicked — `renderVerdict()` and `abortSession()` now restore the exact frozen segment array + rotation captured at spin completion (via the new `restoreFrozenWheel()` helper) instead of calling `renderAll()`/`computeSegments()` after `fetchData()`, which could rebuild segments from refreshed `allWatchers` and shift the wheel position. The reset timeouts in both flows also preserve the frozen segment order when returning to idle spin. Same fix previously applied to the Accept button in 1.8.8.
- Aborted spins are now properly invalid: the pending winner's graphic is reverted to the last accepted winner's graphic and `last_spin_winner_id` is only committed once a verdict is actually rendered
- User media watcher dropdown no longer shows a double scrollbar — the list expands to fit all users (modal body overflow made visible)

### Changed
- Version bumped to 1.9.0
- `backup.sh` retention extended from 14 to 365 days
- Default `SITE_TITLE` in `docker-compose.yml` set to `nuwheel`

## [1.8.8] - 2026-07-21

### Fixed
- Wheel no longer jumps to a wrong position when Accept is clicked — `acceptResults()` now restores the exact frozen segment array captured at spin completion instead of calling `computeSegments()`, which could rebuild segments from stale/updated `allWatchers` and shift the wheel position
- `data_changed` WebSocket handler no longer calls `renderAll()` while a winner is pending, preventing the wheel from being visually replaced by stale segment data between spin completion and Accept

### Changed
- Version bumped to 1.8.8

## [1.8.7] - 2026-07-20

### Fixed
- Wheel no longer visually jumps when Accept is clicked — `acceptResults()` no longer calls `fetchData()` + `renderAll()`, which could shift segment order and make the wheel appear to rotate
- `_enforce_title_budget` removed — dead function that was silently clamping title points to a watcher's remaining budget
- Title points can now be set to 0 (server-side minimum changed from 0.1 to 0)
- `parseFloat(val) || 1` in points input handler fixed — entering `0` no longer snaps to `1` because `0 || 1` is falsy in JavaScript
- Wheel rotation and voting state now stored server-side in `app_settings` instead of `localStorage` — any authenticated user can recover the voting state after page reload or from another device

### Added
- Aborted filter option in the Previous Winners judgement dropdown

### Changed
- Version bumped to 1.8.7

## [1.8.6] - 2026-07-17

### Fixed
- Points badge and debt tooltip now refresh when participants are added/removed via the ✕ button, Start Movie Night, or Admin panel — `fetchData()` was missing in several paths, leaving stale `owed_to`/`owed_by`/`points` computed against the old participant set

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

## [1.7.0] - 2026-07-14

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
