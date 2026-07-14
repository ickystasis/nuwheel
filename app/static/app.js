/* ============================================================
   Wheel of Doom(b) — Watcher Points + Participant Selector
   ============================================================ */

// ---- State ----
let allWatchers = [];    // [{id, name, points, titles}]
let activeIds = new Set(); // set of watcher IDs currently participating
let segments = [];
let isSpinning = false;
let wheelRotation = 0;
let animFrameId = null;
let idleAnimFrameId = null;
const IDLE_SPEED = 0.003;
let lastTickSegment = -1;
let tickAudioCtx = null;
function playTick() {
    try {
        if (!tickAudioCtx) tickAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = tickAudioCtx.createOscillator();
        const gain = tickAudioCtx.createGain();
        osc.connect(gain);
        gain.connect(tickAudioCtx.destination);
        osc.frequency.value = 800;
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.08, tickAudioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, tickAudioCtx.currentTime + 0.04);
        osc.start(tickAudioCtx.currentTime);
        osc.stop(tickAudioCtx.currentTime + 0.04);
    } catch (e) { /* audio not supported */ }
}
let winners = [];

let spinMusicAudio = null;
let cheerAudio = null;

let spinMusicFiles = [];
let cheerFiles = [];

async function fetchMediaLists() {
    try {
        const [music, cheers] = await Promise.all([
            fetch('/api/media/music').then(r => r.json()),
            fetch('/api/media/cheers').then(r => r.json()),
        ]);
        spinMusicFiles = music;
        cheerFiles = cheers;
    } catch (e) {}
}

function pickRandom(arr) {
    if (arr.length === 0) return null;
    return arr[Math.floor(Math.random() * arr.length)];
}

function playSpinMusic() {
    try {
        if (spinMusicAudio) { spinMusicAudio.pause(); spinMusicAudio = null; }
        const file = pickRandom(spinMusicFiles);
        if (!file) return;
        spinMusicAudio = new Audio('music/' + file);
        spinMusicAudio.loop = true;
        spinMusicAudio.volume = 0.5;
        spinMusicAudio.currentTime = 0;
        spinMusicAudio.play();
    } catch (e) {}
}

function stopSpinMusic() {
    try {
        if (spinMusicAudio) { spinMusicAudio.pause(); spinMusicAudio = null; }
    } catch (e) {}
}

function playCheer() {
    try {
        if (cheerAudio) { cheerAudio.pause(); cheerAudio = null; }
        const file = pickRandom(cheerFiles);
        if (!file) return;
        cheerAudio = new Audio('cheers/' + file);
        cheerAudio.volume = 0.6;
        cheerAudio.currentTime = 0;
        cheerAudio.play();
    } catch (e) {}
}
function startIdleSpin() {
    if (idleAnimFrameId) cancelAnimationFrame(idleAnimFrameId);
    function idleAnimate() {
        wheelRotation += IDLE_SPEED;
        drawWheel(wheelRotation);
        idleAnimFrameId = requestAnimationFrame(idleAnimate);
    }
    idleAnimFrameId = requestAnimationFrame(idleAnimate);
}

function stopIdleSpin() {
    if (idleAnimFrameId) {
        cancelAnimationFrame(idleAnimFrameId);
        idleAnimFrameId = null;
    }
}

let watcherVotes = {};   // {watcherId: 'pass'|'punish'}
let showVoting = false;  // whether vote toggles + verdict btn are active

// ---- Server-side settings persistence ----
async function saveSettings(data) {
    try {
        await fetch('/api/settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
    } catch (e) { /* ignore */ }
}

async function fetchSettings() {
    try {
        const res = await fetch('/api/settings');
        const settings = await res.json();
        if (settings.active_ids && Array.isArray(settings.active_ids)) {
            activeIds = new Set(settings.active_ids);
        }
        if (settings.spin_settings) {
            spinSettings.duration = settings.spin_settings.duration ?? spinSettings.duration;
            spinSettings.decelSharpness = settings.spin_settings.decelSharpness ?? spinSettings.decelSharpness;
            spinSettings.finalCrawl = settings.spin_settings.finalCrawl ?? spinSettings.finalCrawl;
            if (velocitySlider) velocitySlider.value = spinSettings.duration;
            if (velocityValue) velocityValue.textContent = spinSettings.duration.toFixed(2);
            if (frictionGainSlider) frictionGainSlider.value = spinSettings.decelSharpness;
            if (frictionGainValue) frictionGainValue.textContent = spinSettings.decelSharpness.toFixed(2);
            if (finalStretchSlider) finalStretchSlider.value = spinSettings.finalCrawl;
            if (finalStretchValue) finalStretchValue.textContent = spinSettings.finalCrawl.toFixed(2);
        }
        if (settings.center_image) {
            const img = new Image();
            img.onload = () => { centerImage = img; drawWheel(wheelRotation); };
            img.src = settings.center_image;
        }
    } catch (e) { /* ignore */ }
}

// ---- DOM refs ----
const canvas = document.getElementById('wheelCanvas');
const ctx = canvas.getContext('2d');
const addWatcherBtn = document.getElementById('addWatcherBtn');
const watchersContainer = document.getElementById('watchersContainer');
const emptyMsg = document.getElementById('emptyMsg');
const spinBtn = document.getElementById('spinBtn');
const winnerDisplay = document.getElementById('winnerDisplay');
const winnerText = document.getElementById('winnerText');
const winnerDetails = document.getElementById('winnerDetails');
const totalWeight = document.getElementById('totalWeight');
const wheelInfo = document.getElementById('wheelInfo');
const winnersBtn = document.getElementById('winnersBtn');
const shuffleBtn = document.getElementById('shuffleBtn');
const spinControlsBtn = document.getElementById('spinControlsBtn');
const spinSettingsModal = document.getElementById('spinSettingsModal');
const spinSettingsCloseBtn = document.getElementById('spinSettingsCloseBtn');
const velocitySlider = document.getElementById('velocitySlider');
const frictionGainSlider = document.getElementById('frictionGainSlider');
const finalStretchSlider = document.getElementById('finalStretchSlider');
const velocityValue = document.getElementById('velocityValue');
const frictionGainValue = document.getElementById('frictionGainValue');
const finalStretchValue = document.getElementById('finalStretchValue');
const winnersModal = document.getElementById('winnersModal');
const modalCloseBtn = document.getElementById('modalCloseBtn');
const winnersList = document.getElementById('winnersList');
const clearWinnersBtn = document.getElementById('clearWinnersBtn');
const statsBtn = document.getElementById('statsBtn');
const statsBody = document.getElementById('statsBody');

// Debt matrix refs
const debtMatrixModal = document.getElementById('debtMatrixModal');
const debtMatrixCloseBtn = document.getElementById('debtMatrixCloseBtn');
const debtMatrixTable = document.getElementById('debtMatrixTable');
const debtMatrixSummary = document.getElementById('debtMatrixSummary');
let debtMatrixData = null; // {watchers, debts}

// Participant modal refs
const participantsModal = document.getElementById('participantsModal');
const participantsCloseBtn = document.getElementById('participantsCloseBtn');
const allWatchersList = document.getElementById('allWatchersList');
const newWatcherName = document.getElementById('newWatcherName');
const newWatcherPoints = document.getElementById('newWatcherPoints');
const addNewWatcherBtn = document.getElementById('addNewWatcherBtn');
const startMovieNightBtn = document.getElementById('startMovieNightBtn');
const bypassChecksInput = document.getElementById('bypassChecks');
let bypassPointChecks = false;
let spinSettings = {
    duration: parseFloat(velocitySlider?.value) || 1.1,
    decelSharpness: parseFloat(frictionGainSlider?.value) || 0.45,
    finalCrawl: parseFloat(finalStretchSlider?.value) || 0.35,
};
let centerImage = null; // uploaded center button image

// Judgement refs
const verdictBtn = document.getElementById('verdictBtn');
const abortBtn = document.getElementById('abortBtn');
const returnMsg = document.getElementById('returnMsg');
let lastWinnerInfo = null; // {seg, totalPts, winnerId}

// Admin refs
const adminBtn = document.getElementById('adminBtn');
const adminModal = document.getElementById('adminModal');
const adminCloseBtn = document.getElementById('adminCloseBtn');
const adminNewName = document.getElementById('adminNewName');
const adminColorInput = document.getElementById('adminColorInput');
const adminAddBtn = document.getElementById('adminAddBtn');
const adminWatchersList = document.getElementById('adminWatchersList');

// Retro Vote refs
const retroVoteModal = document.getElementById('retroVoteModal');
const retroVoteCloseBtn = document.getElementById('retroVoteCloseBtn');
const retroVoteBody = document.getElementById('retroVoteBody');
const retroVoteRecordBtn = document.getElementById('retroVoteRecordBtn');
const importWinnersModal = document.getElementById('importWinnersModal');
const importWinnersCloseBtn = document.getElementById('importWinnersCloseBtn');
const importWinnersBtn = document.getElementById('importWinnersBtn');
const importWinnersText = document.getElementById('importWinnersText');
const importWinnersSubmitBtn = document.getElementById('importWinnersSubmitBtn');
const importStatus = document.getElementById('importStatus');
let retroVoteWinnerId = null; // winner id being retro-voted
let retroVoteProposerName = null; // proposer for retro-vote tiebreaker
let retroVotes = {}; // {watcherName: 'pass'|'punish'}

// Password modal refs
const passwordModal = document.getElementById('passwordModal');
const passwordInput = document.getElementById('passwordInput');
const passwordSubmitBtn = document.getElementById('passwordSubmitBtn');
const passwordCancelBtn = document.getElementById('passwordCancelBtn');

function verifyAdminPassword() {
    return new Promise((resolve) => {
        passwordInput.value = '';
        passwordModal.classList.remove('hidden');
        setTimeout(() => passwordInput.focus(), 100);

        function cleanup() {
            passwordModal.classList.add('hidden');
            passwordSubmitBtn.removeEventListener('click', onSubmit);
            passwordCancelBtn.removeEventListener('click', onCancel);
            passwordInput.removeEventListener('keydown', onKey);
            passwordModal.removeEventListener('click', onBackdrop);
        }

        async function onSubmit() {
            const pw = passwordInput.value;
            if (!pw) return;
            cleanup();
            try {
                const res = await fetch('/api/admin/verify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password: pw }),
                });
                const data = await res.json();
                resolve(data.ok);
                if (!data.ok) alert('Incorrect password!');
            } catch {
                alert('Failed to verify password');
                resolve(false);
            }
        }

        function onCancel() {
            cleanup();
            resolve(false);
        }

        function onKey(e) {
            if (e.key === 'Enter') onSubmit();
            if (e.key === 'Escape') onCancel();
        }

        function onBackdrop(e) {
            if (e.target === passwordModal) onCancel();
        }

        passwordSubmitBtn.addEventListener('click', onSubmit);
        passwordCancelBtn.addEventListener('click', onCancel);
        passwordInput.addEventListener('keydown', onKey);
        passwordModal.addEventListener('click', onBackdrop);
    });
}

// ---- Colors ----
const SEGMENT_COLORS = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
    '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
    '#F0B27A', '#82E0AA', '#F1948A', '#85929E', '#73C6B6',
    '#E59866', '#AED6F1', '#D7BDE2', '#A3E4D7', '#FAD7A0',
    '#E8DAEF', '#A9CCE3', '#D5DBDB', '#F9E79F', '#ABEBC6',
];

let cx = canvas.width / 2 || 600;
let cy = canvas.height / 2 || 600;
let radius = (canvas.width / 2 || 600) - 10;
let CENTER_R = 280;

// ============================================================
//  API
// ============================================================

async function fetchData() {
    const res = await fetch('/api/data');
    allWatchers = await res.json();
}

async function addWatcher(name, color = '#4ECDC4') {
    const res = await fetch('/api/watchers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, color }),
    });
    if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Failed to add watcher');
    }
    const watcher = await res.json();
    allWatchers.push(watcher);
    return watcher;
}

async function deleteWatcher(id) {
    await fetch(`/api/watchers/${id}`, { method: 'DELETE' });
    allWatchers = allWatchers.filter(w => w.id !== id);
    activeIds.delete(id);
}

async function adjustWatcherPoints(id, delta) {
    const res = await fetch(`/api/watchers/${id}/points`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delta }),
    });
    if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Failed to adjust points');
    }
    const result = await res.json();
    // Update in local data
    const w = allWatchers.find(x => x.id === id);
    if (w) w.points = result.points;
    return result;
}

async function updateTitle(titleId, updates) {
    const res = await fetch(`/api/titles/${titleId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
    });
    if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Failed to update title');
    }
    const title = await res.json();
    for (const w of allWatchers) {
        const idx = w.titles.findIndex(t => t.id === titleId);
        if (idx !== -1) {
            w.titles[idx] = { ...w.titles[idx], ...title };
        }
    }
    return title;
}

async function deleteTitle(titleId) {
    await fetch(`/api/titles/${titleId}`, { method: 'DELETE' });
    for (const w of allWatchers) {
        w.titles = w.titles.filter(t => t.id !== titleId);
    }
}

async function fetchWinners() {
    const res = await fetch('/api/winners');
    winners = await res.json();
}

function buildWheelMovies() {
    const wheel = {};
    for (const seg of segments) {
        if (!wheel[seg.watcherName]) wheel[seg.watcherName] = [];
        wheel[seg.watcherName].push({ name: seg.name, weight: seg.points });
    }
    return wheel;
}

async function saveWinner(titleName, watcherName, weight, totalWeight, participants, watcherBudget, watcherMovieCount, wheelMovies) {
    const res = await fetch('/api/winners', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            title_name: titleName, watcher_name: watcherName,
            weight, total_weight: totalWeight,
            participants: participants || '',
            watcher_budget: watcherBudget || 0,
            watcher_movie_count: watcherMovieCount || 0,
            wheel_movies: wheelMovies || '{}',
        }),
    });
    if (!res.ok) return null;
    return await res.json();
}

async function clearAllWinners() {
    await fetch('/api/winners', { method: 'DELETE' });
    winners = [];
}

async function fetchStats() {
    const res = await fetch('/api/stats');
    if (!res.ok) throw new Error('Failed to fetch stats');
    return res.json();
}

// ============================================================
//  Active watchers helpers
// ============================================================

function getActiveWatchers() {
    return allWatchers.filter(w => activeIds.has(w.id));
}

function getActiveSegments() {
    const segs = [];
    for (const w of allWatchers) {
        if (!activeIds.has(w.id)) continue;
        for (const t of w.titles) {
            if (t.name.trim()) {
                segs.push({ name: t.name, points: t.points, watcherName: w.name, titleId: t.id, displayOrder: t.display_order, color: w.color || '#4ECDC4' });
            }
        }
    }
    // Global sort by server-assigned display_order so all clients see the same order
    segs.sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
    return segs;
}

function getTotalWeight() {
    return segments.reduce((sum, s) => sum + s.points, 0);
}

// ============================================================
//  Participant Dialog
// ============================================================

function renderParticipantList() {
    allWatchersList.innerHTML = '';
    if (allWatchers.length === 0) {
        allWatchersList.innerHTML = '<p class="empty-msg" style="padding:1rem 0">No watchers yet! Add one below. ✨</p>';
        return;
    }
    for (const w of allWatchers) {
        const row = document.createElement('div');
        row.className = 'participant-row';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'participant-check';
        cb.checked = activeIds.has(w.id);
        cb.addEventListener('change', async () => {
            if (cb.checked) activeIds.add(w.id);
            else activeIds.delete(w.id);
            await saveSettings({ active_ids: [...activeIds] });
            await fetchData();
            renderAll();
        });

        const swatch = document.createElement('span');
        swatch.className = 'color-swatch';
        swatch.style.background = w.color || '#4ECDC4';

        const name = document.createElement('span');
        name.className = 'participant-name';
        name.textContent = w.name;

        const pts = document.createElement('span');
        pts.className = 'participant-pts';
        pts.textContent = `${w.points} pts`;

        row.appendChild(cb);
        row.appendChild(swatch);
        row.appendChild(name);
        row.appendChild(pts);
        allWatchersList.appendChild(row);
    }
}

function openParticipantsModal() {
    renderParticipantList();
    participantsModal.classList.remove('hidden');
}

function closeParticipantsModal() {
    participantsModal.classList.add('hidden');
}

// ============================================================
//  Rendering — Watchers (active only)
// ============================================================

function refreshWatchersPreservingFocus() {
    // Save the focused input's position before re-render
    const el = document.activeElement;
    let focusInfo = null;
    if (el && (el.classList.contains('title-input') || el.classList.contains('title-points'))) {
        const row = el.closest('.title-row');
        const card = el.closest('.watcher-card');
        if (row && card) {
            const watcherId = parseInt(card.dataset.watcherId);
            const allRows = card.querySelectorAll('.title-row');
            const titleIndex = Array.from(allRows).indexOf(row);
            focusInfo = { watcherId, titleIndex, isName: el.classList.contains('title-input'),
                         selectionStart: el.selectionStart || 0, selectionEnd: el.selectionEnd || 0 };
        }
    }

    renderWatchers();

    // Restore focus to the same input at the same caret position
    if (focusInfo) {
        const newCard = document.querySelector(`.watcher-card[data-watcher-id="${focusInfo.watcherId}"]`);
        if (newCard) {
            const newRows = newCard.querySelectorAll('.title-row');
            const newRow = newRows[focusInfo.titleIndex];
            if (newRow) {
                const input = focusInfo.isName
                    ? newRow.querySelector('.title-input')
                    : newRow.querySelector('.title-points');
                if (input) {
                    input.focus();
                    try { input.setSelectionRange(focusInfo.selectionStart, focusInfo.selectionEnd); } catch (e) {}
                }
            }
        }
    }
}

function renderWatchers() {
    watchersContainer.innerHTML = '';
    const active = getActiveWatchers();

    if (active.length === 0) {
        emptyMsg.style.display = 'block';
        spinBtn.disabled = true;
        return;
    }

    emptyMsg.style.display = 'none';
    spinBtn.disabled = showVoting || segments.length === 0;

    // Hide Accept button during voting (in case renderAll was called)
    if (showVoting) {
        spinBtn.classList.add('faded');
    }

    for (const w of active) {
        const card = document.createElement('div');
        card.className = 'watcher-card';
        card.dataset.watcherId = w.id;

        const header = document.createElement('div');
        header.className = 'watcher-header';
        const rightDiv = document.createElement('div');

        const delBtn = document.createElement('button');
        delBtn.className = 'watcher-del-btn';
        delBtn.textContent = '✕';
        delBtn.title = 'Remove from session';
        delBtn.addEventListener('click', async () => {
            activeIds.delete(w.id);
            await saveSettings({ active_ids: [...activeIds] });
            computeSegments();
            renderAll();
        });
        rightDiv.appendChild(delBtn);
        delBtn.classList.toggle('hidden', showVoting || isSpinning || lastWinnerInfo);

        const assignedWeight = w.titles.reduce((sum, t) => sum + (parseFloat(t.points) || 0), 0);
        const pointsMatch = Math.abs(assignedWeight - w.points) < 0.0001;
        const ptsClass = pointsMatch ? 'pts-badge pos' : 'pts-badge neg';
        const displayPoints = w.points <= 0 ? 1 : w.points;
        const ptsTooltipHtml = (() => {
            const lines = [];
            if (w.owed_to && w.owed_to.length > 0) {
                for (const d of w.owed_to) {
                    lines.push(`<span class="pos">+${d.amount}</span> from ${escHtml(d.name)}`);
                    if (d.entries && d.entries.length > 0) {
                        for (const e of d.entries) {
                            const dt = e.won_at ? e.won_at.slice(0, 10) : '';
                            lines.push(`  <span style="color:#888;font-size:0.7rem">↳ +${e.delta} <span style="color:#aaa">${escHtml(e.title)}</span> ${dt}</span>`);
                        }
                    }
                }
            }
            if (w.owed_by && w.owed_by.length > 0) {
                for (const d of w.owed_by) {
                    lines.push(`<span class="neg">-${d.amount}</span> to ${escHtml(d.name)}`);
                    if (d.entries && d.entries.length > 0) {
                        for (const e of d.entries) {
                            const dt = e.won_at ? e.won_at.slice(0, 10) : '';
                            lines.push(`  <span style="color:#888;font-size:0.7rem">↳ -${e.delta} <span style="color:#aaa">${escHtml(e.title)}</span> ${dt}</span>`);
                        }
                    }
                }
            }
            const owedToSum = (w.owed_to || []).reduce((s, d) => s + d.amount, 0);
            const owedBySum = (w.owed_by || []).reduce((s, d) => s + d.amount, 0);
            lines.push(`<span class="summary">6 + ${owedToSum} - ${owedBySum} = ${w.points}</span>`);
            return lines.join('<br>');
        })();
        const streakTooltipHtml = (() => {
            const lines = [];
            if (w.punish_history && w.punish_history.length > 0) {
                for (const ph of w.punish_history) {
                    const dt = ph.won_at ? ph.won_at.slice(0, 10) : '';
                    lines.push(`<span class="neg">👎 ${escHtml(ph.title)}</span> <span style="color:#888;font-size:0.7rem">${dt}</span>`);
                }
            } else {
                lines.push(`<span style="color:#888">Streak: ${w.punish_streak}</span>`);
            }
            return lines.join('<br>');
        })();
        let streakHtml = '';
        let streakId = null;
        if (w.punish_streak > 0) {
            streakId = `streak-${w.id}`;
            const scale = 1 + Math.min(w.punish_streak, 5) * 0.33;
            const tone = ['#f3f3a8', '#ffd068', '#ff8c4f', '#de4c39', '#a81c1c'][Math.min(w.punish_streak - 1, 4)];
            streakHtml = `<span id="${streakId}" class="streak-badge" style="font-size:${scale.toFixed(2)}rem;background:${tone};color:#111">💀x${w.punish_streak}</span>`;
        }
        const color = (w.color || '#4ECDC4').replace(/['"]/g, '');
        const ptsBadgeId = `pts-${w.id}`;
        header.innerHTML = `<span class="watcher-name"><span class="victim-color-dot" style="background:${color}"></span> ${escHtml(w.name)} <span id="${ptsBadgeId}" class="${ptsClass}" style="cursor:help">${displayPoints}</span>${streakHtml}</span>`;
        const ptsBadge = header.querySelector('#' + ptsBadgeId);
        const tooltip = document.getElementById('ptsTooltip');
        if (ptsBadge && tooltip) {
            ptsBadge.addEventListener('mouseenter', () => {
                tooltip.innerHTML = ptsTooltipHtml;
                tooltip.classList.remove('hidden');
            });
            ptsBadge.addEventListener('mousemove', (e) => {
                tooltip.style.left = (e.clientX + 12) + 'px';
                tooltip.style.top = (e.clientY - 10) + 'px';
            });
            ptsBadge.addEventListener('mouseleave', () => {
                tooltip.classList.add('hidden');
            });
        }

        if (streakId) {
            const streakBadge = header.querySelector('#' + streakId);
            if (streakBadge && tooltip) {
                streakBadge.addEventListener('mouseenter', () => {
                    tooltip.innerHTML = streakTooltipHtml;
                    tooltip.classList.remove('hidden');
                });
                streakBadge.addEventListener('mousemove', (e) => {
                    tooltip.style.left = (e.clientX + 12) + 'px';
                    tooltip.style.top = (e.clientY - 10) + 'px';
                });
                streakBadge.addEventListener('mouseleave', () => {
                    tooltip.classList.add('hidden');
                });
            }
        }

        if (showVoting) {
            const isProposer = lastWinnerInfo && w.name === lastWinnerInfo.seg.watcherName;
            const vote = watcherVotes[w.id] || (isProposer ? 'na' : 'pass');
            const voteBtn = document.createElement('button');
            if (isProposer) {
                // Proposer: Punish / NA toggle
                voteBtn.className = `vote-toggle${vote === 'punish' ? ' vote-punish' : ''}`;
                voteBtn.textContent = vote === 'punish' ? '👎 Punish' : '🤷 NA';
                voteBtn.addEventListener('click', () => {
                    const newVote = watcherVotes[w.id] === 'punish' ? 'na' : 'punish';
                    watcherVotes[w.id] = newVote;
                    voteBtn.className = `vote-toggle${newVote === 'punish' ? ' vote-punish' : ''}`;
                    voteBtn.textContent = newVote === 'punish' ? '👎 Punish' : '🤷 NA';
                });
            } else {
                // Non-proposer: Pass / Punish toggle
                voteBtn.className = `vote-toggle${vote === 'punish' ? ' vote-punish' : ''}`;
                voteBtn.textContent = vote === 'pass' ? '👍 Pass' : '👎 Punish';
                voteBtn.addEventListener('click', () => {
                    const newVote = watcherVotes[w.id] === 'pass' ? 'punish' : 'pass';
                    watcherVotes[w.id] = newVote;
                    voteBtn.className = `vote-toggle${newVote === 'punish' ? ' vote-punish' : ''}`;
                    voteBtn.textContent = newVote === 'pass' ? '👍 Pass' : '👎 Punish';
                });
            }
            header.appendChild(voteBtn);
        }
        header.appendChild(rightDiv);
        card.appendChild(header);

        const titlesContainer = document.createElement('div');
        titlesContainer.className = 'titles-container';
        if (w.titles && w.titles.length > 0) {
            w.titles.forEach((title, index) => {
                titlesContainer.appendChild(createTitleRow(w, title, index));
            });
        } else {
            const emptyTitles = document.createElement('div');
            emptyTitles.className = 'balance-muted';
            emptyTitles.textContent = 'No movies yet. Add one below to add a segment to the wheel.';
            titlesContainer.appendChild(emptyTitles);
        }

        const addTitleBtn = document.createElement('button');
        addTitleBtn.className = 'btn btn-small btn-add add-title-btn';
        addTitleBtn.textContent = '➕ Add movie';
        addTitleBtn.addEventListener('click', () => {
            const newTitle = { id: null, name: '', points: 1 };
            w.titles.push(newTitle);
            titlesContainer.appendChild(createTitleRow(w, newTitle, w.titles.length - 1));
            updateWheelInfo();
        });

        card.appendChild(titlesContainer);
        card.appendChild(addTitleBtn);
        watchersContainer.appendChild(card);
    }

    updateWheelInfo();
}

function createTitleRow(watcher, title, index) {
    const row = document.createElement('div');
    row.className = 'title-row';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'title-input';
    nameInput.placeholder = `Title ${index + 1}`;
    nameInput.value = title.name;
    nameInput.maxLength = 200;

    const minusBtn = document.createElement('button');
    minusBtn.className = 'point-step-btn';
    minusBtn.textContent = '−';

    const pointsInput = document.createElement('input');
    pointsInput.type = 'number';
    pointsInput.className = 'title-points';
    pointsInput.min = 0;
    pointsInput.step = 'any';
    pointsInput.value = title.points || 1;

    const plusBtn = document.createElement('button');
    plusBtn.className = 'point-step-btn';
    plusBtn.textContent = '+';

    let saveTimer = null;
    let savePending = false;
    let saveQueued = false;
    let saveNeedsRefresh = false;
    async function save() {
        if (savePending) {
            saveQueued = true;
            return;
        }
        savePending = true;
        saveQueued = false;
        try {
            const name = nameInput.value.trim();
            let pts = parseFloat(pointsInput.value);
            if (!Number.isFinite(pts)) pts = 1;
            if (pts < 0) pts = 0;

            // Free-form movie point assignment is allowed
            title.points = pts;

            const shouldRefresh = saveNeedsRefresh;
            saveNeedsRefresh = false;

            if (typeof title.id === 'number') {
                // Existing title — update on backend
                try {
                    await updateTitle(title.id, { name, points: pts });
                    computeSegments();
                    drawWheel(wheelRotation);
                    updateWheelInfo();
                    if (shouldRefresh) refreshWatchersPreservingFocus();
                    if (!showVoting) spinBtn.disabled = segments.length === 0;
                } catch (e) {}
            } else if (name) {
                // New title — create on backend directly
                try {
                    const res = await fetch('/api/titles', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ watcher_id: watcher.id, name, points: pts }),
                    });
                    if (!res.ok) return;
                    const created = await res.json();
                    title.id = created.id; // swap temp string ID for real numeric ID
                    title.name = name;
                    title.points = pts;
                    computeSegments();
                    drawWheel(wheelRotation);
                    updateWheelInfo();
                    if (shouldRefresh) refreshWatchersPreservingFocus();
                    if (!showVoting) spinBtn.disabled = segments.length === 0;
                } catch (e) {}
            }
        } finally {
            savePending = false;
            if (saveQueued) {
                // Another save was requested while we were running; retry with latest values
                setTimeout(save, 50);
            }
        }
    }

    nameInput.addEventListener('input', () => {
        title.name = nameInput.value;
        clearTimeout(saveTimer);
        saveNeedsRefresh = false;
        saveTimer = setTimeout(save, 400);
    });

    minusBtn.addEventListener('click', () => {
        let val = parseFloat(pointsInput.value);
        if (!Number.isFinite(val)) val = 1;
        val = Math.round((val - 1) * 100) / 100;
        if (val < 0) val = 0;
        pointsInput.value = val;
        title.points = val;
        clearTimeout(saveTimer);
        saveNeedsRefresh = true;
        saveTimer = setTimeout(save, 200);
    });

    pointsInput.addEventListener('input', () => {
        let val = parseFloat(pointsInput.value) || 1;
        if (val < 0.1) val = 0.1;
        val = Math.round(val * 100) / 100;
        title.points = val;
        clearTimeout(saveTimer);
        saveNeedsRefresh = true;
        saveTimer = setTimeout(save, 400);
    });

    plusBtn.addEventListener('click', () => {
        let val = parseFloat(pointsInput.value);
        if (!Number.isFinite(val)) val = 0;
        val = Math.round((val + 1) * 100) / 100;
        pointsInput.value = val;
        title.points = val;
        clearTimeout(saveTimer);
        saveNeedsRefresh = true;
        saveTimer = setTimeout(save, 200);
    });

    row.appendChild(nameInput);
    row.appendChild(minusBtn);
    row.appendChild(pointsInput);
    row.appendChild(plusBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'title-del-btn';
    delBtn.textContent = '✕';
    delBtn.addEventListener('click', async () => {
        if (typeof title.id === 'number') await deleteTitle(title.id);
        watcher.titles = watcher.titles.filter(t => t !== title);
        computeSegments();
        renderAll();
    });
    row.appendChild(delBtn);

    return row;
}

function escHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

// ============================================================
//  Wheel Drawing
// ============================================================

function drawWheel(rotation) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const count = segments.length;
    const wheelSize = parseInt(canvas.style.width) || (canvas.width / (window.devicePixelRatio || 1));

    if (count === 0) {
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fillStyle = '#1a1a2e';
        ctx.fill();
        ctx.strokeStyle = '#2a2a3e';
        ctx.lineWidth = Math.max(1, Math.floor(radius / 160));
        ctx.stroke();
        ctx.fillStyle = '#555';
        ctx.font = '60px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Add some titles!', cx, cy);
        return;
    }

    const totalPts = getTotalWeight();

    ctx.beginPath();
    ctx.arc(cx, cy, radius + Math.max(2, Math.floor(wheelSize / 160)), 0, Math.PI * 2);
    ctx.fillStyle = '#2a2a3e';
    ctx.fill();

    let currentAngle = rotation;
    for (let i = 0; i < count; i++) {
        const arc = (segments[i].points / totalPts) * Math.PI * 2;
        const startAngle = currentAngle;
        const endAngle = startAngle + arc;

        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, radius, startAngle, endAngle);
        ctx.closePath();
        ctx.fillStyle = segments[i].color || SEGMENT_COLORS[i % SEGMENT_COLORS.length];
        ctx.fill();

        ctx.strokeStyle = '#1a1a2e';
        ctx.lineWidth = Math.max(1, Math.floor(wheelSize / 320));
        ctx.stroke();

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(startAngle + arc / 2);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const text = segments[i].name;
        const pad = 20;
        const innerEdge = CENTER_R + pad;
        const outerEdge = radius - pad;
        const textRadius = (innerEdge + outerEdge) / 2;
        const maxTextWidth = (outerEdge - innerEdge) * 0.92;

        function wrapText(fontSize) {
            ctx.font = `bold ${fontSize}px 'Segoe UI', sans-serif`;
            if (ctx.measureText(text).width <= maxTextWidth) return [text];
            const words = text.split(' ');
            const lines = [];
            let currentLine = '';
            for (const word of words) {
                const testLine = currentLine ? currentLine + ' ' + word : word;
                if (ctx.measureText(testLine).width > maxTextWidth && currentLine) {
                    lines.push(currentLine);
                    currentLine = word;
                } else {
                    currentLine = testLine;
                }
            }
            if (currentLine) lines.push(currentLine);
            return lines;
        }

        let fontSize = Math.floor(wheelSize * 0.049);
        let lines = wrapText(fontSize);
        while (fontSize > 12 && (lines.length > 2 || lines.some(l => ctx.measureText(l).width > maxTextWidth))) {
            fontSize -= 4;
            lines = wrapText(fontSize);
        }
        if (lines.length > 2) {
            lines = [lines.slice(0, -1).join(' ') + '…', lines[lines.length - 1]];
        }

        const lineHeight = fontSize * 1.2;
        const startY = -((lines.length - 1) * lineHeight) / 2;

        ctx.strokeStyle = 'black';
        ctx.lineWidth = Math.max(6, fontSize * 0.26);
        ctx.lineJoin = 'round';
        ctx.fillStyle = '#ffffff';
        for (let li = 0; li < lines.length; li++) {
            const y = startY + li * lineHeight;
            ctx.strokeText(lines[li], textRadius, y);
            ctx.fillText(lines[li], textRadius, y);
        }
        ctx.restore();
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;

        currentAngle += arc;
    }

    // Center circle — clickable SPIN button
    const centerR = CENTER_R;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, centerR, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.fillStyle = '#2a2a3e';
    ctx.fill();
    if (centerImage) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(rotation);
        ctx.drawImage(centerImage, -centerR, -centerR, centerR * 2, centerR * 2);
        ctx.restore();
    }
    ctx.restore();
    ctx.beginPath();
    ctx.arc(cx, cy, centerR, 0, Math.PI * 2);
    ctx.strokeStyle = '#3a3a52';
    ctx.lineWidth = Math.max(1, Math.floor(wheelSize / 280));
    ctx.stroke();
    if (!centerImage) {
        if (showVoting) {
            ctx.fillStyle = '#ffd93d';
            ctx.font = 'bold 28px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('⚖️ VOTING', cx, cy);
        } else if (lastWinnerInfo) {
            // Never show SPIN when a winner is pending
        } else {
            ctx.fillStyle = '#ffd93d';
            ctx.font = 'bold 44px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('SPIN', cx, cy);
        }
    }
}

// ============================================================
//  Winner Detection
// ============================================================

function getWinnerSegmentIndex() {
    const count = segments.length;
    if (count === 0) return -1;

    const totalPts = getTotalWeight();
    const pointerAngle = 0;

    let currentAngle = wheelRotation;
    for (let i = 0; i < count; i++) {
        const arc = (segments[i].points / totalPts) * Math.PI * 2;
        const start = currentAngle;
        const end = start + arc;

        const normStart = ((start % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        const normEnd = ((end % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        const normPointer = ((pointerAngle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

        if (normStart < normEnd) {
            if (normPointer >= normStart && normPointer < normEnd) return i;
        } else {
            if (normPointer >= normStart || normPointer < normEnd) return i;
        }
        currentAngle += arc;
    }
    return 0;
}

// ============================================================
//  Spin Animation
// ============================================================

function spinWheel() {
    if (showVoting) {
        returnMsg.textContent = '⚖️ Voting in progress — accept or abort first';
        returnMsg.style.color = '#ff6b6b';
        returnMsg.classList.remove('hidden');
        return;
    }
    if (lastWinnerInfo) return;
    if (isSpinning) return;
    if (segments.length < 1) {
        returnMsg.textContent = '📭 No segments to spin';
        returnMsg.style.color = '#ff6b6b';
        returnMsg.classList.remove('hidden');
        return;
    }

    // Budget validation (uses computed points with floor of 1)
    const active = getActiveWatchers();
    const invalidWatchers = active.filter(w => {
        const titleTotal = w.titles.reduce((sum, t) => sum + (parseFloat(t.points) || 0), 0);
        return Math.abs(titleTotal - w.points) > 0.0001;
    });
    if (!bypassPointChecks && invalidWatchers.length > 0) {
        const msg = '🚫 Point assignment mismatch for: ' + invalidWatchers.map(w => w.name).join(', ');
        returnMsg.textContent = msg;
        returnMsg.style.color = '#ff6b6b';
        returnMsg.classList.remove('hidden');
        return;
    }

    stopIdleSpin();
    isSpinning = true;
    if (shuffleBtn) shuffleBtn.classList.add('hidden');
    lastTickSegment = -1;
    playSpinMusic();
    winnerDisplay.classList.add('hidden');
    showVoting = false;
    watcherVotes = {};
    verdictBtn.classList.add('faded');
    verdictBtn.disabled = true;
    returnMsg.classList.add('hidden');
    spinBtn.classList.add('faded');
    spinBtn.disabled = true;
    lastWinnerInfo = null;
    // Reset message color
    returnMsg.style.color = '';
    document.querySelectorAll('.watcher-del-btn').forEach(b => b.classList.add('hidden'));

    // Big random range + duration contribution (at 0.6 → 23-43, at 12.0 → 80-100)
    const extraRotations = 20 + Math.random() * 20 + spinSettings.duration * 5;
    const targetAngle = extraRotations * Math.PI * 2 + Math.random() * Math.PI * 2;
    const targetRotation = wheelRotation + targetAngle;
    // Fast spin: ~2 revolutions per second
    const duration = 2000 + extraRotations * 400;
    const startTime = performance.now();
    const startRotation = wheelRotation;

    function animate(now) {
        const elapsed = now - startTime;
        const t = Math.min(elapsed / duration, 1);
        // Decel Sharpness: exponent for the cubic ease (2 = gentle coast, 7 = hard brake)
        // Final Crawl: adds subtle exponent bump (up to +3) for a smoother final approach
        const exp = 2 + spinSettings.decelSharpness * 5 + spinSettings.finalCrawl * 3;
        const eased = 1 - Math.pow(1 - t, exp);
        wheelRotation = startRotation + (targetRotation - startRotation) * eased;
        drawWheel(wheelRotation);
        const currentSeg = getWinnerSegmentIndex();
        if (currentSeg !== lastTickSegment) {
            lastTickSegment = currentSeg;
            playTick();
        }
        // End as soon as the wheel is visually at its destination (no dead pause)
        if (eased > 0.9995 || t >= 1) {
            wheelRotation = targetRotation;
            drawWheel(wheelRotation);
            onSpinComplete();
        } else {
            animFrameId = requestAnimationFrame(animate);
        }
    }

    animFrameId = requestAnimationFrame(animate);
}

function onSpinComplete() {
    stopSpinMusic();
    playCheer();
    const idx = getWinnerSegmentIndex();
    if (idx >= 0 && idx < segments.length) {
        const seg = segments[idx];
        const totalPts = getTotalWeight();
        winnerText.textContent = `🏆 ${seg.name} 🏆`;
        winnerDetails.textContent = `Weight: ${seg.points}/${totalPts} (${Math.round(seg.points / totalPts * 100)}%) — by ${seg.watcherName}`;
        winnerDisplay.classList.remove('hidden');
        fireConfetti();

        // Store for Accept/Re-roll
        lastWinnerInfo = { seg, totalPts };
        isSpinning = false;

        // Show Accept Results button, enable re-spin via center circle
        spinBtn.classList.remove('faded');
        spinBtn.disabled = false;

        if (shuffleBtn) shuffleBtn.classList.add('hidden');

        // Broadcast final angle so all clients land on the exact same slice
        const finalMod = ((wheelRotation % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        socket.emit('spin_completed', {
            finalMod: finalMod,
        });
    } else {
        isSpinning = false;
    }
}

// ============================================================
//  Accept Results
// ============================================================

async function acceptResults() {
    if (!lastWinnerInfo) return;

    // Lock spinning immediately — before any async work
    showVoting = true;
    isSpinning = true;
    spinBtn.classList.add('faded');
    spinBtn.disabled = true;

    const seg = lastWinnerInfo.seg;
    const active = getActiveWatchers();
    const participantNames = active.map(w => w.name).join(', ');
    const participantIds = active.map(w => w.id);

    // Save winner to history
    const winnerData = allWatchers.find(w => w.name === seg.watcherName);
    const watcherBudget = winnerData ? Math.max(1, winnerData.points) : 0;
    const watcherMovieCount = winnerData ? winnerData.titles.filter(t => t.name.trim()).length : 0;
    const wheelMovies = buildWheelMovies();
    const saved = await saveWinner(
        seg.name, seg.watcherName, seg.points,
        lastWinnerInfo.totalPts, participantNames,
        watcherBudget, watcherMovieCount, wheelMovies
    );
    if (saved && saved.id) {
        lastWinnerInfo.winnerId = saved.id;
        // Store incomplete state in localStorage for recovery
        localStorage.setItem('incompleteWinner', JSON.stringify({
            winnerRecordId: saved.id,
            titleName: seg.name,
            watcherName: seg.watcherName,
            points: seg.points,
            totalPts: lastWinnerInfo.totalPts,
            participantIds: participantIds,
            participantNames: participantNames,
            wheelRotation: wheelRotation,
        }));
        fetchWinners();
    }

    await fetchData();
    renderAll();

    // Activate voting mode: show vote toggles + Render Verdict + Abort buttons
    const activeWatchers = getActiveWatchers();
    watcherVotes = {};
    for (const w of activeWatchers) {
        watcherVotes[w.id] = w.name === seg.watcherName ? 'na' : 'pass';
    }
    renderWatchers();
    verdictBtn.classList.remove('faded');
    verdictBtn.disabled = false;
    abortBtn.classList.remove('faded');
    abortBtn.disabled = false;
}

// ============================================================
//  Abort Session
// ============================================================

async function abortSession() {
    if (!lastWinnerInfo) return;
    const winnerRecordId = lastWinnerInfo.winnerId;
    if (!winnerRecordId) {
        alert('No winner record to abort. Please accept results first.');
        return;
    }

    verdictBtn.classList.add('faded');
    verdictBtn.disabled = true;
    abortBtn.classList.add('faded');
    abortBtn.disabled = true;
    returnMsg.classList.add('hidden');

    try {
        const res = await fetch('/api/spin/abort', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ winner_record_id: winnerRecordId }),
        });
        if (!res.ok) {
            const data = await res.json();
            alert(data.error || 'Failed to abort session');
            return;
        }
        await fetchWinners();
        returnMsg.textContent = '🚫 Session aborted. Movie marked as cancelled.';
        returnMsg.classList.remove('hidden');
    } catch (e) {
        alert('Abort failed: ' + e.message);
        return;
    }

    setTimeout(() => {
        showVoting = false;
        watcherVotes = {};
        isSpinning = false;
        lastWinnerInfo = null;
        localStorage.removeItem('incompleteWinner');
        renderAll();
        startIdleSpin();
        verdictBtn.classList.add('faded');
        verdictBtn.disabled = true;
        abortBtn.classList.add('faded');
        abortBtn.disabled = true;
        spinBtn.classList.add('faded');
        spinBtn.disabled = true;
    }, 2000);
}

// ============================================================
//  Render Verdict (replaces individual Pass / Punish)
// ============================================================

async function renderVerdict() {
    if (!lastWinnerInfo) return;
    const seg = lastWinnerInfo.seg;
    const active = getActiveWatchers();

    // Validate all watchers have cast a vote
    const missing = active.filter(w => !watcherVotes[w.id]);
    if (missing.length > 0) {
        returnMsg.textContent = `⚠️ Waiting for votes from: ${missing.map(w => w.name).join(', ')}`;
        returnMsg.classList.remove('hidden');
        return;
    }

    // Tabulate votes (exclude NA/abstain). Proposer's vote counts 1.1x to break ties.
    const proposerName = seg.watcherName;
    let punishScore = 0, passScore = 0;
    for (const w of active) {
        const v = watcherVotes[w.id];
        const mult = (w.name === proposerName) ? 1.1 : 1;
        if (v === 'punish') { punishScore += mult; }
        else if (v === 'pass') { passScore += mult; }
    }
    const isPunish = (punishScore + passScore) > 0 && punishScore > passScore;

    verdictBtn.classList.add('faded');
    verdictBtn.disabled = true;
    abortBtn.classList.add('faded');
    abortBtn.disabled = true;
    returnMsg.classList.add('hidden');

    const winnerData = allWatchers.find(w => w.name === seg.watcherName);
    if (!winnerData) { return; }

    try {
        // Record per-watcher votes + judgement in the winner entry
        if (lastWinnerInfo.winnerId) {
            const votesObj = {};
            for (const w of active) {
                votesObj[String(w.id)] = watcherVotes[w.id];
            }
            await fetch(`/api/winners/${lastWinnerInfo.winnerId}/verdict`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    judgement: isPunish ? 'punish' : 'pass',
                    votes: votesObj,
                }),
            });
            fetchWinners();
        }

        // Refund: clear debts owed to the winner (moved from acceptResults)
        let processWinCleared = [];
        if (winnerData && active.length > 1) {
            const refundIds = active.map(w => w.id);
            try {
                const pwRes = await fetch('/api/spin/process-win', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ winner_id: winnerData.id, participant_ids: refundIds, winner_record_id: lastWinnerInfo.winnerId }),
                });
                const pwData = await pwRes.json();
                processWinCleared = pwData.cleared || [];
            } catch { /* ignore */ }
        }

        if (isPunish) {
            // Execute punish logic
            const active2 = getActiveWatchers();
            const participantIds = active2.map(w => w.id);
            const res = await fetch('/api/spin/punish', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ winner_id: winnerData.id, participant_ids: participantIds, winner_record_id: lastWinnerInfo.winnerId }),
            });
            const data = await res.json();
            if (!res.ok) { alert(data.error || 'Punish failed'); return; }

            await fetchData();
            renderAll();
            const clearedLines = (processWinCleared || []).map(c => `${c.amount} returned to ${escHtml(c.debtor_name)}`).join('<br>');
            const stolenLines = (data.stolen_from || []).map(s => `${s.amount} added to ${escHtml(s.thief_name)} (${s.total_debt} total)`).join('<br>');
            let punishDetail = '';
            if (clearedLines) punishDetail += `<br>${clearedLines}`;
            if (stolenLines) punishDetail += `<br>${stolenLines}`;
            returnMsg.innerHTML = `👎 Punished! ${escHtml(seg.watcherName)} owes ${data.total_theft} point${data.total_theft !== 1 ? 's' : ''} (🔥x${data.multiplier} streak!)${punishDetail}`;
        } else {
            // Execute pass logic
            const passRes = await fetch('/api/spin/pass', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ winner_id: winnerData.id, participant_ids: active.map(w => w.id), winner_record_id: lastWinnerInfo.winnerId, process_win_cleared: processWinCleared }),
            });
            const passData = await passRes.json();
            await fetchData();
            renderAll();
            const pts = passData.points_saved || 0;
            const returnedItems = passData.returned_to || [];
            const streakMsg = passData.streak > 0 ? ` ${escHtml(seg.watcherName)}'s streak reset to 0` : '';
            let ptsMsg = '';
            if (returnedItems.length > 0) {
                const returnedLines = returnedItems.map(r => `${r.amount} returned to ${escHtml(r.name)}`).join('<br>');
                ptsMsg = ` (${pts} point${pts !== 1 ? 's' : ''} returned)<br>${returnedLines}`;
            }
            returnMsg.innerHTML = `👍 Passed!${streakMsg}${ptsMsg}`;
        }
        returnMsg.classList.remove('hidden');
    } catch (e) {
        alert('Render Verdict failed: ' + e.message);
        return;
    }

    // Reset voting state after a short delay
    setTimeout(() => {
        showVoting = false;
        watcherVotes = {};
        isSpinning = false;
        lastWinnerInfo = null;
        localStorage.removeItem('incompleteWinner');
        renderAll();
        startIdleSpin();
        verdictBtn.classList.add('faded');
        verdictBtn.disabled = true;
        abortBtn.classList.add('faded');
        abortBtn.disabled = true;
    }, 2500);
}

// ============================================================
//  Wheel Info
// ============================================================

function updateWheelInfo() {
    const totalPts = getTotalWeight();
    if (totalPts > 0) {
        wheelInfo.style.display = 'block';
        totalWeight.textContent = `Total weight: ${totalPts}`;
    } else {
        wheelInfo.style.display = 'none';
    }
}

// ============================================================
//  Confetti 🎊
// ============================================================

function fireConfetti() {
    const colors = ['#FF6B6B','#FFD93D','#6BCB77','#4D96FF','#FF6BB5','#A78BFA','#FF9F43','#00D2D3'];
    for (let i = 0; i < 60; i++) {
        const piece = document.createElement('div');
        piece.className = 'confetti-piece';
        const color = colors[Math.floor(Math.random() * colors.length)];
        const size = 6 + Math.random() * 8;
        const left = 10 + Math.random() * 80;
        const delay = Math.random() * 1.5;
        const dur = 2 + Math.random() * 2;
        const rotation = Math.random() * 360;
        const xDrift = (Math.random() - 0.5) * 200;
        piece.style.cssText = `
            left: ${left}%; width: ${size}px; height: ${size * (0.4 + Math.random() * 0.6)}px;
            background: ${color}; border-radius: ${Math.random() > 0.5 ? '50%' : '2px'};
            animation: confetti-fall ${dur}s ease-out ${delay}s forwards;
            transform: rotate(${rotation}deg); --x-drift: ${xDrift}px;
        `;
        piece.style.setProperty('--x-drift', `${xDrift}px`);
        document.body.appendChild(piece);
        setTimeout(() => piece.remove(), (dur + delay) * 1000 + 100);
    }
}

const styleSheet = document.createElement('style');
styleSheet.textContent = `@keyframes confetti-fall {
    0% { transform: translateY(0) rotate(0deg) translateX(0); opacity: 1; }
    100% { transform: translateY(100vh) rotate(720deg) translateX(var(--x-drift)); opacity: 0; }
}`;
document.head.appendChild(styleSheet);

// ============================================================
//  Segments
// ============================================================

function computeSegments() {
    const oldKeys = segments.map(s => `${s.name}|${s.watcherName}`);
    segments = getActiveSegments();
    // Preserve the existing order when segment identities haven't changed.
    // Order only resets when tiles are added/removed or shuffleWheel() is called.
    if (segments.length === oldKeys.length && segments.length > 0) {
        const orderMap = new Map(oldKeys.map((k, i) => [k, i]));
        segments.sort((a, b) => {
            const ka = `${a.name}|${a.watcherName}`;
            const kb = `${b.name}|${b.watcherName}`;
            return (orderMap.get(ka) ?? Infinity) - (orderMap.get(kb) ?? Infinity);
        });
    }
}

// ============================================================
//  Render All
// ============================================================

function renderAll() {
    computeSegments();
    renderWatchers();
    drawWheel(wheelRotation);
    if (shuffleBtn) {
        shuffleBtn.classList.toggle('hidden', isSpinning || !!lastWinnerInfo || segments.length === 0 || showVoting);
    }
}

async function shuffleWheel() {
    if (isSpinning || segments.length === 0) return;
    // Shuffle locally — only affects wheel canvas, not panel title order
    for (let i = segments.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [segments[i], segments[j]] = [segments[j], segments[i]];
    }
    drawWheel(wheelRotation);
}

// ============================================================
//  Previous Winners Modal
// ============================================================

function makeEditableField(value, onChange) {
    const span = document.createElement('span');
    span.textContent = value;
    span.className = 'editable-field';
    span.addEventListener('click', () => {
        if (span.querySelector('input')) return;
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.className = 'editable-input';
        inp.value = span.textContent;
        span.textContent = '';
        span.appendChild(inp);
        inp.focus();
        inp.select();
        inp.addEventListener('blur', () => {
            const newVal = inp.value.trim();
            span.textContent = newVal || value;
            onChange(newVal || value);
        });
        inp.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') inp.blur();
            if (e.key === 'Escape') { span.textContent = value; }
        });
    });
    return span;
}

function renderWinnersList() {
    winnersList.innerHTML = '';
    if (winners.length === 0) {
        winnersList.innerHTML = '<p class="empty-msg">No winners yet! Spin the wheel~ ✨</p>';
        return;
    }
    for (const w of winners) {
        const budget = parseInt(w.watcher_budget) || 0;
        const movieCount = parseInt(w.watcher_movie_count) || 0;
        const isGold = w.weight == 1 && (budget === 0 || budget === 1) && (movieCount === 0 || movieCount === 1);
        const entry = document.createElement('div');
        entry.className = `winner-entry${isGold ? ' winner-entry-gold' : ''}${w.status === 'disabled' ? ' winner-entry-disabled' : ''}${w.judgement === 'aborted' ? ' winner-entry-aborted' : ''}`;

        const left = document.createElement('div');
        left.style.cssText = 'display:flex;flex-direction:column;gap:0.25rem;flex:1;min-width:0;';

        // Top row: clickable judgement emoji + title
        const titleRow = document.createElement('div');
        titleRow.style.cssText = 'display:flex;align-items:center;gap:0.4rem;';

        const judgeBtn = document.createElement('span');
        judgeBtn.style.cssText = 'font-size:1.1rem;cursor:default;';
        if (w.judgement === 'aborted') {
            judgeBtn.textContent = '🚫';
            judgeBtn.title = 'Aborted';
        } else if (w.judgement === 'punish') {
            judgeBtn.textContent = '👎';
            judgeBtn.title = 'Punished';
        } else if (w.judgement === 'pass') {
            judgeBtn.textContent = '👍';
            judgeBtn.title = 'Passed';
        } else {
            judgeBtn.textContent = '❓';
            judgeBtn.title = 'No verdict';
        }
        titleRow.appendChild(judgeBtn);

        const titleSpan = document.createElement('span');
        titleSpan.className = 'winner-entry-title';
        titleSpan.appendChild(makeEditableField(w.title_name, async (val) => {
            try {
                await fetch(`/api/winners/${w.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title_name: val }),
                });
                w.title_name = val;
            } catch (e) { alert(e.message); }
        }));
        titleRow.appendChild(titleSpan);
        left.appendChild(titleRow);

        // Meta line: weight/max + proposer + date + streak
        const metaRow = document.createElement('div');
        metaRow.className = 'winner-entry-meta';
        metaRow.style.cssText = 'display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;';

        const maxW = parseFloat(w.total_weight) || 0;
        const weightStr = maxW > 0 ? `${w.weight}/${maxW} (${Math.round(w.weight / maxW * 100)}%)` : `${w.weight}/NA`;
        const weightSpan = document.createElement('span');
        weightSpan.textContent = `W:${weightStr}`;
        metaRow.appendChild(weightSpan);

        metaRow.appendChild(document.createTextNode(' by '));
        const propName = w.watcher_name;

        // Parse votes & wheel_movies early so proposer pill can show their actual vote
        let votesData = {};
        if (w.votes && w.votes !== '{}') {
            try { votesData = JSON.parse(w.votes); } catch (e) {}
        }
        let spinMovies = {};
        try { spinMovies = JSON.parse(w.wheel_movies || '{}'); } catch (e) {}

        // Resolve proposer's watcher ID (handles renames — stored name ≠ current name)
        const propWatcher = allWatchers.find(x => x.name === propName);
        const propIdStr = propWatcher ? String(propWatcher.id) : null;
        const propDispName = propWatcher ? propWatcher.name : propName;

        // Look up proposer's actual vote by ID first, fall back to case-insensitive name match
        const propVote = (propIdStr && votesData[propIdStr] !== undefined)
            ? votesData[propIdStr]
            : Object.entries(votesData).find(([k]) => k.toLowerCase() === propName.toLowerCase())?.[1] || 'na';
        let propEmoji, propClass;
        if (w.judgement === 'aborted') { propEmoji = '🚫'; propClass = 'vote-chip-aborted'; }
        else if (propVote === 'punish') { propEmoji = '👎'; propClass = 'vote-chip-punish'; }
        else if (propVote === 'na') { propEmoji = '🤷'; propClass = 'vote-chip-na'; }
        else { propEmoji = '👍'; propClass = 'vote-chip-pass'; }
        const propSpan = document.createElement('span');
        propSpan.className = `vote-chip ${propClass}`;
        propSpan.textContent = `${propEmoji} ${propDispName}`;
        propSpan.style.cssText = 'cursor:help;';
        metaRow.appendChild(propSpan);

        let d;
        if (w.won_at && w.won_at.includes(' ')) {
            // SQLite datetime format YYYY-MM-DD HH:MM:SS (UTC)
            d = new Date(w.won_at.replace(' ', 'T') + 'Z');
        } else if (w.won_at && w.won_at.includes('-')) {
            // Date-only from import: parse as local to avoid timezone shift
            const parts = w.won_at.split('-');
            d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
        }
        const dateSpan = document.createElement('span');
        dateSpan.className = 'winner-entry-when';
        dateSpan.textContent = d ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : (w.won_at || '');
        metaRow.appendChild(dateSpan);

        if (w.punish_streak > 0) {
            const streakSpan = document.createElement('span');
            streakSpan.className = 'streak-badge-sm';
            streakSpan.textContent = `🔥x${w.punish_streak}`;
            metaRow.appendChild(streakSpan);
        }

        left.appendChild(metaRow);

        // Replace proposer tooltip with per-spin movies (shared floating tooltip)
        const propMovieList = spinMovies[propName] || [];
        if (propMovieList.length > 0) {
            const tooltipLines = propMovieList.map(m => `${m.name} (${m.weight}pt${m.weight !== 1 ? 's' : ''}${maxW > 0 ? ' - ' + Math.round(m.weight / maxW * 100) + '%' : ''})`);
            const tooltip = document.getElementById('winnersTooltip');
            const html = `<span style="color:#ffd93d">${propDispName}'s movies this spin:</span><br>${tooltipLines.join('<br>')}`;
            const modalContent = document.querySelector('#winnersModal .modal-content');
            propSpan.addEventListener('mouseenter', (e) => {
                tooltip.innerHTML = html;
                tooltip.classList.remove('hidden');
                const rect = modalContent.getBoundingClientRect();
                tooltip.style.left = (e.clientX - rect.left + 12) + 'px';
                tooltip.style.top = (e.clientY - rect.top - 10) + 'px';
            });
            propSpan.addEventListener('mousemove', (e) => {
                const rect = modalContent.getBoundingClientRect();
                tooltip.style.left = (e.clientX - rect.left + 12) + 'px';
                tooltip.style.top = (e.clientY - rect.top - 10) + 'px';
            });
            propSpan.addEventListener('mouseleave', () => {
                tooltip.classList.add('hidden');
            });
        }

        // Per-watcher votes row — static text with hover
        const voteChips = document.createElement('div');
        voteChips.style.cssText = 'display:flex;align-items:center;gap:0.3rem;flex-wrap:wrap;font-size:0.8rem;';
        // For aborted entries, show attendance from participants field as individual chips
        if (w.judgement === 'aborted') {
            const names = (w.participants || '').split(',').map(s => s.trim()).filter(Boolean);
            if (names.length > 0) {
                for (const pName of names) {
                    if (pName.toLowerCase() === propName.toLowerCase()) continue;
                    const chip = document.createElement('span');
                    chip.className = 'vote-chip vote-chip-aborted';
                    chip.textContent = `🚫 ${pName}`;
                    chip.style.cssText = 'cursor:default;';
                    const voterMovieList = spinMovies[pName] || [];
                    if (voterMovieList.length > 0) {
                        const tooltipLines = voterMovieList.map(m => `${m.name} (${m.weight}pt${m.weight !== 1 ? 's' : ''}${maxW > 0 ? ' - ' + Math.round(m.weight / maxW * 100) + '%' : ''})`);
                        const tooltip = document.getElementById('winnersTooltip');
                        const html = `<span style="color:#ffd93d">${pName}'s movies this spin:</span><br>${tooltipLines.join('<br>')}`;
                        const modalContent = document.querySelector('#winnersModal .modal-content');
                        chip.addEventListener('mouseenter', (e) => {
                            tooltip.innerHTML = html;
                            tooltip.classList.remove('hidden');
                            const rect = modalContent.getBoundingClientRect();
                            tooltip.style.left = (e.clientX - rect.left + 12) + 'px';
                            tooltip.style.top = (e.clientY - rect.top - 10) + 'px';
                        });
                        chip.addEventListener('mousemove', (e) => {
                            const rect = modalContent.getBoundingClientRect();
                            tooltip.style.left = (e.clientX - rect.left + 12) + 'px';
                            tooltip.style.top = (e.clientY - rect.top - 10) + 'px';
                        });
                        chip.addEventListener('mouseleave', () => {
                            tooltip.classList.add('hidden');
                        });
                    }
                    voteChips.appendChild(chip);
                }
            } else {
                const noAttend = document.createElement('span');
                noAttend.style.cssText = 'font-size:0.75rem;color:#666;font-style:italic;';
                noAttend.textContent = 'No attendance data';
                voteChips.appendChild(noAttend);
            }
        } else {
            for (const [key, vote] of Object.entries(votesData)) {
                // Skip proposer — their vote is shown after "by"
                if (key === propIdStr || key.toLowerCase() === propName.toLowerCase()) continue;
                const name = /^\d+$/.test(key)
                    ? (allWatchers.find(x => x.id == key)?.name || `User #${key}`)
                    : (allWatchers.find(x => x.name.toLowerCase() === key.toLowerCase())?.name || key);
                const chip = document.createElement('span');
                if (vote === 'punish') {
                    chip.className = 'vote-chip vote-chip-punish';
                    chip.textContent = `👎 ${name}`;
                } else if (vote === 'na') {
                    chip.className = 'vote-chip vote-chip-na';
                    chip.textContent = `🤷 ${name}`;
                } else {
                    chip.className = 'vote-chip vote-chip-pass';
                    chip.textContent = `👍 ${name}`;
                }
                chip.style.cssText = 'cursor:default;';
                // Per-spin movie tooltip (shared floating tooltip)
                const voterMovieList = spinMovies[name] || [];
                if (voterMovieList.length > 0) {
                    const tooltipLines = voterMovieList.map(m => `${m.name} (${m.weight}pt${m.weight !== 1 ? 's' : ''}${maxW > 0 ? ' - ' + Math.round(m.weight / maxW * 100) + '%' : ''})`);
                    const tooltip = document.getElementById('winnersTooltip');
                    const html = `<span style="color:#ffd93d">${name}'s movies this spin:</span><br>${tooltipLines.join('<br>')}`;
                    const modalContent = document.querySelector('#winnersModal .modal-content');
                    chip.addEventListener('mouseenter', (e) => {
                        tooltip.innerHTML = html;
                        tooltip.classList.remove('hidden');
                        const rect = modalContent.getBoundingClientRect();
                        tooltip.style.left = (e.clientX - rect.left + 12) + 'px';
                        tooltip.style.top = (e.clientY - rect.top - 10) + 'px';
                    });
                    chip.addEventListener('mousemove', (e) => {
                        const rect = modalContent.getBoundingClientRect();
                        tooltip.style.left = (e.clientX - rect.left + 12) + 'px';
                        tooltip.style.top = (e.clientY - rect.top - 10) + 'px';
                    });
                    chip.addEventListener('mouseleave', () => {
                        tooltip.classList.add('hidden');
                    });
                }
                voteChips.appendChild(chip);
            }
        }
        left.appendChild(voteChips);

        // Right column: status toggle
        const rightCol = document.createElement('div');
        rightCol.style.cssText = 'display:flex;flex-direction:column;align-items:flex-end;gap:0.3rem;';

        const statusBtn = document.createElement('button');
        statusBtn.className = 'status-toggle-btn';
        statusBtn.textContent = w.status === 'disabled' ? 'Disabled' : 'Active';
        statusBtn.addEventListener('click', async () => {
            const next = w.status === 'disabled' ? 'active' : 'disabled';
            try {
                await fetch(`/api/winners/${w.id}/status`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status: next }),
                });
                w.status = next;
                renderWinnersList();
            } catch (e) { alert(e.message); }
        });
        rightCol.appendChild(statusBtn);

        entry.appendChild(left);
        entry.appendChild(rightCol);
        winnersList.appendChild(entry);
    }
}

function openWinnersModal() {
    renderWinnersList();
    winnersModal.classList.remove('hidden');
}

function closeWinnersModal() {
    winnersModal.classList.add('hidden');
}

function renderStatsTable(items, totalSessions) {
    if (!items || items.length === 0) return '<p class="empty-msg">No stats yet.</p>';
    const rowCells = items.map(item => `
        <tr>
            <td><strong>${escHtml(item.name)}</strong></td>
            <td>${item.attendance_count}</td>
            <td><span class="stats-pill">${item.attendance_pct}%</span></td>
            <td>${item.pick_count}</td>
            <td><span class="stats-pill" style="background:rgba(255,217,61,0.14);color:#ffd93d">${item.pick_pct}%</span></td>
            <td><span class="stats-pill" style="background:rgba(167,139,250,0.14);color:#a78bfa">${item.adjusted_pick_pct}%</span></td>
            <td>${item.avg_wheel_weight || 6.0}</td>
            <td>${item.punish_count}</td>
            <td><span class="stats-pill" style="background:rgba(255,107,107,0.14);color:#ff6b6b">${item.punish_pct}%</span></td>
            <td>${item.punish_vote_count}</td>
            <td>${item.punish_vote_pct}%</td>
        </tr>
    `).join('');
    return `
        <div style="font-size:0.8rem;color:#aaa;margin-bottom:0.5rem">Sessions: ${totalSessions}</div>
        <div style="overflow-x:auto">
            <table class="stats-table">
                <thead>
                    <tr>
                        <th>Victim</th>
                        <th>Att.</th>
                        <th>Att.%</th>
                        <th>Picks</th>
                        <th>Pick%</th>
                        <th>Adj.Pick%</th>
                        <th>AvgWt</th>
                        <th>Pun.</th>
                        <th>Pun.%</th>
                        <th>⚖️</th>
                        <th>VotePun%</th>
                    </tr>
                </thead>
                <tbody>${rowCells}</tbody>
            </table>
        </div>
    `;
}

async function openStatsModal() {
    // Open the combined debt matrix modal
    await openDebtMatrix();
}

function closeStatsModal() {}

// ============================================================
//  Debt Matrix
// ============================================================

async function fetchDebtMatrix() {
    const res = await fetch('/api/debts');
    if (!res.ok) throw new Error('Failed to fetch debt matrix');
    return await res.json();
}

function escAttr(s) {
    return String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderDebtMatrix(data) {
    debtMatrixData = data;
    const { watchers, debts } = data;
    const count = watchers.length;
    if (count === 0) {
        debtMatrixTable.innerHTML = '';
        debtMatrixSummary.textContent = 'No watchers yet.';
        return;
    }

    // Build lookup: (debtor_id, creditor_id) -> amount
    const debtMap = {};
    const entriesMap = {};
    for (const d of debts) {
        debtMap[`${d.debtor_id},${d.creditor_id}`] = d.amount;
        if (d.entries && d.entries.length > 0) {
            entriesMap[`${d.debtor_id},${d.creditor_id}`] = d.entries;
        }
    }
    function getDebt(dId, cId) {
        if (dId === cId) return 0;
        return debtMap[`${dId},${cId}`] || 0;
    }
    function getEntries(dId, cId) {
        return entriesMap[`${dId},${cId}`] || [];
    }

    // Calculate effective points for each watcher: base 6 + owed to - owed by (all watchers)
    const wheelPoints = {};
    for (const w of watchers) {
        let owedTo = 0;
        let owedBy = 0;
        for (const other of watchers) {
            if (other.id === w.id) continue;
            owedTo += getDebt(other.id, w.id);
            owedBy += getDebt(w.id, other.id);
        }
        wheelPoints[w.id] = 6 + owedTo - owedBy;
    }

    // Build table
    const thead = debtMatrixTable.querySelector('thead');
    const tbody = debtMatrixTable.querySelector('tbody');
    thead.innerHTML = '';
    tbody.innerHTML = '';

    // Header row
    let headerHtml = '<tr><th class="row-header">Owed ↓ / Owes →</th>';
    for (const w of watchers) {
        headerHtml += `<th>${escHtml(w.name)}</th>`;
    }
    headerHtml += '<th style="background:#1a1a2e;color:#6bcb77">Effective Pts</th></tr>';
    thead.innerHTML = headerHtml;

    // Data rows
    for (const row of watchers) {
        let rowHtml = `<tr><td>${escHtml(row.name)}</td>`;
        for (const col of watchers) {
            let cls, val;
            if (row.id === col.id) {
                cls = 'cell-diagonal';
                val = '';
            } else {
                val = getDebt(col.id, row.id);
                cls = val > 0 ? 'cell-positive cell-editable' : 'cell-zero cell-editable';
            }
            rowHtml += `<td class="${cls}" data-d="${col.id}" data-c="${row.id}">${val}</td>`;
        }
        const pts = wheelPoints[row.id];
        const ptsColor = pts >= 1 ? '#6bcb77' : '#ff6b6b';
        rowHtml += `<td style="font-weight:600;color:${ptsColor};background:#1a1a2e">${pts}</td>`;
        rowHtml += '</tr>';
        tbody.innerHTML += rowHtml;
    }

    // Make all cells uniform width = widest cell (for a true grid look)
    requestAnimationFrame(() => {
        const allCells = debtMatrixTable.querySelectorAll('th, td');
        let maxW = 0;
        allCells.forEach(cell => {
            const w = cell.scrollWidth;
            if (w > maxW) maxW = w;
        });
        maxW += 10; // 1-char breathing room at 0.7rem
        allCells.forEach(cell => {
            cell.style.width = maxW + 'px';
            cell.style.minWidth = maxW + 'px';
            cell.style.maxWidth = maxW + 'px';
        });
    });

    // Tooltip for debt cells
    const tooltip = document.getElementById('ptsTooltip');
    tbody.querySelectorAll('td').forEach(td => {
        const dId = td.dataset.d;
        const cId = td.dataset.c;
        if (!dId || !cId) return;
        const debtor = watchers.find(w => w.id == dId);
        const creditor = watchers.find(w => w.id == cId);
        if (!debtor || !creditor) return;
        const amount = getDebt(parseInt(dId), parseInt(cId));
        td.addEventListener('mouseenter', () => {
            if (td.querySelector('input')) return;
            const lines = [];
            if (amount > 0) {
                lines.push(`<span class="pos">+${amount}</span> from ${escHtml(debtor.name)}`);
                const entries = getEntries(parseInt(dId), parseInt(cId));
                for (const e of entries) {
                    const dt = e.won_at ? e.won_at.slice(0, 10) : '';
                    lines.push(`  <span style="color:#888;font-size:0.7rem">↳ +${e.delta} <span style="color:#aaa">${escHtml(e.title)}</span> ${dt}</span>`);
                }
            } else {
                lines.push(`<span style="color:#555">No debt</span>`);
            }
            tooltip.innerHTML = lines.join('<br>');
            tooltip.classList.remove('hidden');
        });
        td.addEventListener('mousemove', (e) => {
            if (tooltip.classList.contains('hidden')) return;
            tooltip.style.left = (e.clientX + 12) + 'px';
            tooltip.style.top = (e.clientY - 10) + 'px';
        });
        td.addEventListener('mouseleave', () => {
            tooltip.classList.add('hidden');
        });
    });

    // Make cells editable on click (admin-only check happens in save)
    tbody.querySelectorAll('td.cell-editable').forEach(td => {
        td.addEventListener('click', () => {
            if (td.querySelector('input')) return; // already editing
            const orig = td.textContent.trim();
            const inp = document.createElement('input');
            inp.type = 'number';
            inp.step = '0.1';
            inp.value = orig;
            inp.dataset.orig = orig;
            td.textContent = '';
            td.appendChild(inp);
            inp.focus();
            inp.select();
            inp.addEventListener('blur', () => saveDebtCell(td, inp));
            inp.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { inp.blur(); }
                if (e.key === 'Escape') { td.textContent = orig; }
            });
        });
    });
}

async function saveDebtCell(td, inp) {
    const val = Math.round(parseFloat(inp.value));
    if (!Number.isFinite(val)) {
        td.textContent = inp.dataset.orig;
        return;
    }
    const debtor_id = parseInt(td.dataset.d);
    const creditor_id = parseInt(td.dataset.c);
    try {
        // Admin check
        const ok = await verifyAdminPassword();
        if (!ok) {
            td.textContent = inp.dataset.orig;
            return;
        }
        const res = await fetch('/api/debts', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ debtor_id, creditor_id, amount: val }),
        });
        if (!res.ok) throw new Error('Failed to update');
        td.textContent = val;
        td.className = val === 0 ? 'cell-zero cell-editable' : 'cell-positive cell-editable';
        // Re-fetch and re-render to keep summary in sync
        const fresh = await fetchDebtMatrix();
        renderDebtMatrix(fresh);
    } catch (e) {
        td.textContent = inp.dataset.orig;
        alert(e.message);
    }
}

async function openDebtMatrix() {
    try {
        const [debtData, statsData] = await Promise.all([fetchDebtMatrix(), fetchStats()]);
        renderDebtMatrix(debtData);
        // Render stats
        const cutoffLabel = statsData.cutoff_date ? statsData.cutoff_date : '';
        const cutoffSub = cutoffLabel ? `<div style="font-size:0.8rem;color:#aaa;margin-bottom:0.5rem">Cutoff date: ${cutoffLabel}</div>` : '';
        const allTimeHtml = renderStatsTable(statsData.watchers, statsData.total_active_sessions);
        const recentHtml = statsData.recent_watchers
            ? renderStatsTable(statsData.recent_watchers, statsData.recent_total_sessions)
            : '';
        statsBody.innerHTML = `
            <h4 style="color:#e0e0e0;margin:0 0 0.5rem">All Time</h4>
            ${allTimeHtml}
            ${recentHtml ? `<hr style="border-color:#2a2a3e;margin:1rem 0"><h4 style="color:#e0e0e0;margin:0 0 0.5rem">Last 3 Months</h4>${cutoffSub}${recentHtml}` : ''}
        `;
        debtMatrixModal.classList.remove('hidden');
    } catch (e) {
        alert('Failed to load data: ' + e.message);
    }
}

function closeDebtMatrix() {
    debtMatrixModal.classList.add('hidden');
}

// ============================================================
//  Retro Vote Modal
// ============================================================

function openRetroVoteModal(winner) {
    retroVoteWinnerId = winner.id;
    retroVoteProposerName = winner.watcher_name;
    retroVotes = {};
    retroVoteBody.innerHTML = '';

    // Parse participants from the comma-separated names
    let names = [];
    if (winner.participants) {
        names = winner.participants.split(',').map(s => s.trim()).filter(Boolean);
    }

    if (names.length === 0) {
        retroVoteBody.innerHTML = '<p class="empty-msg">No participant list saved for this entry. Open the winner and note who was there.</p>';
        retroVoteRecordBtn.disabled = true;
    } else {
        retroVoteRecordBtn.disabled = false;
        for (const name of names) {
            retroVotes[name] = 'pass';
            const row = document.createElement('div');
            row.className = 'participant-row';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'participant-name';
            nameSpan.textContent = name;

            const toggle = document.createElement('button');
            toggle.className = 'vote-toggle';
            toggle.textContent = '👍 Pass';
            toggle.dataset.vote = 'pass';
            toggle.addEventListener('click', () => {
                const newVote = retroVotes[name] === 'pass' ? 'punish' : 'pass';
                retroVotes[name] = newVote;
                toggle.className = `vote-toggle${newVote === 'punish' ? ' vote-punish' : ''}`;
                toggle.textContent = newVote === 'pass' ? '👍 Pass' : '👎 Punish';
            });

            row.appendChild(nameSpan);
            row.appendChild(toggle);
            retroVoteBody.appendChild(row);
        }
    }

    retroVoteModal.classList.remove('hidden');
}

async function recordRetroVote() {
    const names = Object.keys(retroVotes);
    if (names.length === 0 || !retroVoteWinnerId) return;

    // Tabulate (proposer's vote counts 1.1x to break ties)
    let punishScore = 0, passScore = 0;
    for (const name of names) {
        const mult = (name === retroVoteProposerName) ? 1.1 : 1;
        if (retroVotes[name] === 'punish') { punishScore += mult; }
        else { passScore += mult; }
    }
    const isPunish = (punishScore + passScore) > 0 && punishScore > passScore;

    retroVoteRecordBtn.disabled = true;
    retroVoteRecordBtn.textContent = '⏳ Saving...';

    try {
        // Record votes via the verdict endpoint
        // We use names as keys since retro entries may not have stable watcher IDs
        await fetch(`/api/winners/${retroVoteWinnerId}/verdict`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                judgement: isPunish ? 'punish' : 'pass',
                votes: retroVotes,
            }),
        });
        await fetchWinners();
        retroVoteModal.classList.add('hidden');
        renderWinnersList();
    } catch (e) {
        alert('Failed to record votes: ' + e.message);
    }

    retroVoteRecordBtn.disabled = false;
    retroVoteRecordBtn.textContent = '📝 Record Votes';
    retroVoteWinnerId = null;
    retroVoteProposerName = null;
    retroVotes = {};
}

// Image upload for center button (persisted server-side)
document.getElementById('centerImageInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const img = new Image();
    const reader = new FileReader();
    reader.onload = (ev) => {
        const dataUrl = ev.target.result;
        img.onload = () => {
            centerImage = img;
            drawWheel(wheelRotation);
            saveSettings({ center_image: dataUrl });
        };
        img.src = dataUrl;
    };
    reader.readAsDataURL(file);
});

// ============================================================
//  Events — Participants Modal
// ============================================================

addWatcherBtn.addEventListener('click', openParticipantsModal);
participantsCloseBtn.addEventListener('click', closeParticipantsModal);
participantsModal.addEventListener('click', (e) => {
    if (e.target === participantsModal) closeParticipantsModal();
});
startMovieNightBtn.addEventListener('click', async () => {
    await saveSettings({ active_ids: [...activeIds] });
    closeParticipantsModal();
    renderAll();
});
shuffleBtn.addEventListener('click', shuffleWheel);
spinControlsBtn.addEventListener('click', () => {
    spinSettingsModal.classList.remove('hidden');
});
spinSettingsCloseBtn.addEventListener('click', () => {
    spinSettingsModal.classList.add('hidden');
});
spinSettingsModal.addEventListener('click', (e) => {
    if (e.target === spinSettingsModal) spinSettingsModal.classList.add('hidden');
});
function saveSpinSettings() {
    saveSettings({ spin_settings: { ...spinSettings } });
}

velocitySlider.addEventListener('input', () => {
    spinSettings.duration = parseFloat(velocitySlider.value);
    velocityValue.textContent = spinSettings.duration.toFixed(2);
    saveSpinSettings();
});
frictionGainSlider.addEventListener('input', () => {
    spinSettings.decelSharpness = parseFloat(frictionGainSlider.value);
    frictionGainValue.textContent = spinSettings.decelSharpness.toFixed(2);
    saveSpinSettings();
});
finalStretchSlider.addEventListener('input', () => {
    spinSettings.finalCrawl = parseFloat(finalStretchSlider.value);
    finalStretchValue.textContent = spinSettings.finalCrawl.toFixed(2);
    saveSpinSettings();
});
bypassChecksInput.addEventListener('change', () => {
    bypassPointChecks = bypassChecksInput.checked;
});
renderAll();

// Escape key for modals
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (!participantsModal.classList.contains('hidden')) closeParticipantsModal();
        if (!winnersModal.classList.contains('hidden')) closeWinnersModal();
        if (!retroVoteModal.classList.contains('hidden')) retroVoteModal.classList.add('hidden');
        if (!debtMatrixModal.classList.contains('hidden')) closeDebtMatrix();
    }
});

// ── Retro Vote Events ──

retroVoteCloseBtn.addEventListener('click', () => retroVoteModal.classList.add('hidden'));
retroVoteModal.addEventListener('click', (e) => {
    if (e.target === retroVoteModal) retroVoteModal.classList.add('hidden');
});
retroVoteRecordBtn.addEventListener('click', recordRetroVote);

// ============================================================
//  Events — Spin
// ============================================================

spinBtn.addEventListener('click', acceptResults);

// ── Events — Verdict ──

verdictBtn.addEventListener('click', renderVerdict);
abortBtn.addEventListener('click', abortSession);

// ── Events — Admin ──

function renderAdminWatchers() {
    adminWatchersList.innerHTML = '';
    if (allWatchers.length === 0) {
        adminWatchersList.innerHTML = '<p class="empty-msg">No watchers yet! Add one above. ✨</p>';
        return;
    }
    for (const w of allWatchers) {
        const row = document.createElement('div');
        row.className = 'participant-row';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'participant-name';
        nameSpan.textContent = w.name;

        const ptsDisplay = document.createElement('span');
        ptsDisplay.className = 'pts-badge pos';
        ptsDisplay.textContent = `${w.points} pts`;
        ptsDisplay.title = 'Base 6 + debt matrix';

        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.className = 'color-input';
        colorInput.value = w.color || '#4ECDC4';

        const saveColorBtn = document.createElement('button');
        saveColorBtn.className = 'btn btn-small btn-add';
        saveColorBtn.textContent = '💾';
        saveColorBtn.title = 'Save color';
        saveColorBtn.addEventListener('click', async () => {
            try {
                await fetch(`/api/watchers/${w.id}/color`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ color: colorInput.value }),
                });
                await fetchData();
                renderAdminWatchers();
                renderAll();
            } catch (e) { alert(e.message); }
        });

        // Reset streak button (only shown when streak > 0)
        if (w.punish_streak > 0) {
            const resetStreakBtn = document.createElement('button');
            resetStreakBtn.className = 'btn btn-small';
            resetStreakBtn.textContent = `🔄 x${w.punish_streak}`;
            resetStreakBtn.title = 'Reset punish streak to 0';
            resetStreakBtn.style.cssText = 'background:#5a3a3a;border:1px solid #8a4a4a;border-radius:6px;padding:0.2rem 0.4rem;cursor:pointer;font-size:0.85rem;';
            resetStreakBtn.addEventListener('click', async () => {
                if (!confirm(`Reset punish streak for "${w.name}"? (Currently 🔥x${w.punish_streak})`)) return;
                try {
                    const res = await fetch(`/api/admin/watchers/${w.id}/reset-streak`, { method: 'POST' });
                    if (!res.ok) { alert('Failed to reset streak'); return; }
                    await fetchData();
                    renderAdminWatchers();
    renderAll();
    resizeWheel();
                } catch (e) { alert(e.message); }
            });
            row.appendChild(resetStreakBtn);
        }

        const delBtn = document.createElement('button');
        delBtn.className = 'watcher-del-btn';
        delBtn.textContent = '✕';
        delBtn.title = 'Delete watcher';
        delBtn.addEventListener('click', async () => {
            if (!confirm(`Delete "${w.name}" and all their titles?`)) return;
            await deleteWatcher(w.id);
            await fetchData();
            renderAdminWatchers();
            renderAll();
        });

        row.appendChild(nameSpan);
        row.appendChild(ptsDisplay);
        row.appendChild(colorInput);
        row.appendChild(saveColorBtn);
        row.appendChild(delBtn);
        adminWatchersList.appendChild(row);
    }
}

async function openAdminModal() {
    const ok = await verifyAdminPassword();
    if (!ok) return;
    renderAdminWatchers();
    adminModal.classList.remove('hidden');
}

adminBtn.addEventListener('click', openAdminModal);
adminCloseBtn.addEventListener('click', () => adminModal.classList.add('hidden'));
adminModal.addEventListener('click', (e) => {
    if (e.target === adminModal) adminModal.classList.add('hidden');
});

adminAddBtn.addEventListener('click', async () => {
    const name = adminNewName.value.trim();
    if (!name) { alert('Enter a watcher name'); return; }
    try {
        const w = await addWatcher(name, adminColorInput.value);
        activeIds.add(w.id);
        await saveSettings({ active_ids: [...activeIds] });
        adminNewName.value = '';
        adminColorInput.value = '#4ECDC4';
        renderAdminWatchers();
        renderAll();
    } catch (e) { alert(e.message); }
});

adminNewName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') adminAddBtn.click();
});

// ============================================================
//  Events — Previous Winners
// ============================================================

winnersBtn.addEventListener('click', openWinnersModal);
modalCloseBtn.addEventListener('click', closeWinnersModal);
winnersModal.addEventListener('click', (e) => {
    if (e.target === winnersModal) closeWinnersModal();
});
statsBtn.addEventListener('click', openStatsModal);
debtMatrixCloseBtn.addEventListener('click', closeDebtMatrix);
debtMatrixModal.addEventListener('click', (e) => {
    if (e.target === debtMatrixModal) closeDebtMatrix();
});

clearWinnersBtn.addEventListener('click', async () => {
    if (winners.length === 0) return;
    if (!confirm('⚠️ This will permanently delete ALL winner history. Are you sure?')) return;
    await clearAllWinners();
    renderWinnersList();
});

importWinnersBtn.addEventListener('click', () => {
    importWinnersText.value = '';
    importWinnersText.disabled = false;
    importStatus.style.display = 'none';
    importStatus.textContent = '';
    importWinnersModal.classList.remove('hidden');
    setTimeout(() => importWinnersText.focus(), 200);
});

importWinnersCloseBtn.addEventListener('click', () => importWinnersModal.classList.add('hidden'));
importWinnersModal.addEventListener('click', (e) => {
    if (e.target === importWinnersModal) importWinnersModal.classList.add('hidden');
});

importWinnersSubmitBtn.addEventListener('click', async () => {
    const csvText = importWinnersText.value.trim();
    if (!csvText) return;
    importWinnersSubmitBtn.disabled = true;
    importWinnersSubmitBtn.textContent = 'Importing...';
    importStatus.style.display = 'none';
    try {
        const res = await fetch('/api/winners/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ csv: csvText }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Import failed');
        let msg = `✅ Imported ${data.succeeded} winner${data.succeeded !== 1 ? 's' : ''}`;
        if (data.errors && data.errors.length > 0) {
            msg += `\n\n⚠️ ${data.errors.length} row${data.errors.length !== 1 ? 's' : ''} skipped:\n`;
            for (const err of data.errors) {
                msg += `\nRow ${err.row} "${err.title}": ${err.errors.join('; ')}`;
            }
        }
        importStatus.textContent = msg;
        importStatus.style.display = 'block';
        if (!data.errors || data.errors.length === 0) {
            setTimeout(() => {
                importWinnersModal.classList.add('hidden');
            }, 1500);
        }
    } catch (e) {
        importStatus.textContent = '❌ Import failed: ' + e.message;
        importStatus.style.display = 'block';
        importWinnersSubmitBtn.disabled = false;
        importWinnersSubmitBtn.textContent = 'Import CSV';
        importWinnersText.focus();
        return;
    }
    importWinnersSubmitBtn.disabled = false;
    importWinnersSubmitBtn.textContent = 'Import CSV';
    importWinnersText.focus();
});

// ============================================================
//  Init
// ============================================================

// ---- WebSocket real-time sync ----
const socket = io();

socket.on('data_changed', () => {
    // Don't interrupt if user is in a modal, editing a title, or in voting mode
    if (!participantsModal.classList.contains('hidden') ||
        !winnersModal.classList.contains('hidden') ||
        !adminModal.classList.contains('hidden') ||
        !debtMatrixModal.classList.contains('hidden')) {
        if (!debtMatrixModal.classList.contains('hidden') && !showVoting) {
            fetchDebtMatrix().then(renderDebtMatrix);
        }
        return;
    }
    if (showVoting) {
        return;
    }
    const active = document.activeElement;
    if (active && active.closest('.title-row')) {
        return;
    }
    fetchData().then(renderAll);
});

socket.on('spin_completed', (data) => {
    // Don't override if we're mid-spin ourselves
    if (isSpinning) return;
    // Don't override if local spinner already handled this (Accept button visible)
    if (!spinBtn.classList.contains('faded')) return;
    // Don't override if we're in voting mode
    if (showVoting) return;

    // All clients have the same segment order (DB display_order), so the same
    // final angle lands on the same slice for everyone.
    const fullTurns = (8 + Math.random() * 8) * Math.PI * 2;
    const targetRotation = data.finalMod + fullTurns;
    let delta = targetRotation - (wheelRotation % (2 * Math.PI));
    if (delta < 0) delta += Math.PI * 2;
    if (delta < Math.PI * 2 * 8) delta += Math.PI * 2 * (8 + Math.floor(Math.random() * 8));

    const finalTarget = wheelRotation + delta;
    const duration = 10000 + Math.random() * 5000;
    const startTime = performance.now();
    const startRotation = wheelRotation;
    isSpinning = true;
    document.querySelectorAll('.watcher-del-btn').forEach(b => b.classList.add('hidden'));

    function animate(now) {
        const elapsed = now - startTime;
        const t = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - t, 2 + 5 * t);
        wheelRotation = startRotation + delta * eased;
        drawWheel(wheelRotation);
        if (t < 1) {
            animFrameId = requestAnimationFrame(animate);
        } else {
            wheelRotation = finalTarget;
            drawWheel(wheelRotation);
            // Determine winner from wheel position (same for all clients)
            const idx = getWinnerSegmentIndex();
            if (idx >= 0) {
                const seg = segments[idx];
                const totalPts = getTotalWeight();
                winnerText.textContent = `\uD83C\uDFC6 ${seg.name} \uD83C\uDFC6`;
                winnerDetails.textContent = `Weight: ${seg.points}/${totalPts} (${Math.round(seg.points / totalPts * 100)}%) - by ${seg.watcherName}`;
                winnerDisplay.classList.remove('hidden');
                fireConfetti();
            }
            isSpinning = false;
        }
    }
    animFrameId = requestAnimationFrame(animate);
    // Accept button is NOT shown on remote clients (spinner only)
    spinBtn.classList.add('faded');
    spinBtn.disabled = true;
});

socket.on('winners_changed', () => {
    if (!winnersModal.classList.contains('hidden')) {
        fetchWinners();
        renderWinnersList();
    }
});

// Canvas: center circle click → SPIN
canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);
    const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
    if (dist <= CENTER_R) spinWheel();
});

// Canvas: pointer cursor on center hover
canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);
    const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
    canvas.style.cursor = (dist <= CENTER_R && !isSpinning && !showVoting && !lastWinnerInfo) ? 'pointer' : 'default';
});

(async function init() {
    await fetchSettings();
    await fetchMediaLists();
    await fetchData();
    await fetchWinners();
    renderAll();
    startIdleSpin();
    requestAnimationFrame(() => requestAnimationFrame(resizeWheel));

    // Recover incomplete spin state
    try {
        const raw = localStorage.getItem('incompleteWinner');
        if (raw) {
            const info = JSON.parse(raw);
            const winnerRecord = winners.find(x => x.id == info.winnerRecordId);
            if (winnerRecord && !winnerRecord.judgement) {
                stopIdleSpin();
                lastWinnerInfo = {
                    seg: { name: info.titleName, watcherName: info.watcherName, points: info.points },
                    totalPts: info.totalPts,
                    winnerId: info.winnerRecordId,
                };
                if (info.wheelRotation !== undefined) {
                    wheelRotation = info.wheelRotation;
                    drawWheel(wheelRotation);
                }
                showVoting = true;
                isSpinning = true;
                watcherVotes = {};
                for (const pid of info.participantIds) {
                    const w = allWatchers.find(x => x.id == pid);
                    watcherVotes[pid] = (w && w.name == info.watcherName) ? 'na' : 'pass';
                }
                verdictBtn.classList.remove('faded');
                verdictBtn.disabled = false;
                abortBtn.classList.remove('faded');
                abortBtn.disabled = false;
                winnerText.textContent = `🏆 ${info.titleName} 🏆`;
                winnerDetails.textContent = `Weight: ${info.points}/${info.totalPts} (${Math.round(info.points / info.totalPts * 100)}%) — by ${info.watcherName}`;
                winnerDisplay.classList.remove('hidden');
                spinBtn.classList.add('faded');
                spinBtn.disabled = true;
                if (shuffleBtn) shuffleBtn.classList.add('hidden');
                renderWatchers();
            }
        }
    } catch (e) { /* ignore corrupt recovery data */ }
})();

// ============================================================
//  Wheel Resize — dynamic canvas sizing
// ============================================================

function resizeWheel() {
    const panel = document.querySelector('.wheel-panel');
    const wrapper = document.querySelector('.wheel-wrapper');

    const panelRect = panel.getBoundingClientRect();
    const otherHeight = 0;
    const availableHeight = panelRect.height - otherHeight - 30;
    const availableWidth = panelRect.width - 30;
    let size = Math.floor(Math.min(availableWidth, availableHeight, 1600));
    size = Math.max(size, 200);

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(size * dpr);
    canvas.height = Math.floor(size * dpr);
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
    cx = canvas.width / 2;
    cy = canvas.height / 2;
    radius = canvas.width / 2 - 10 * dpr;
    CENTER_R = Math.floor(size * 0.196 * dpr);
    drawWheel(wheelRotation);
}

window.addEventListener('resize', () => requestAnimationFrame(resizeWheel));
