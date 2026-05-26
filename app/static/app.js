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
let winners = [];

// ---- localStorage helpers ----
function saveActiveIds() {
    localStorage.setItem('wheelActiveIds', JSON.stringify([...activeIds]));
}

function loadActiveIds() {
    try {
        const saved = localStorage.getItem('wheelActiveIds');
        if (saved) {
            const arr = JSON.parse(saved);
            if (Array.isArray(arr)) activeIds = new Set(arr);
        }
    } catch (e) { /* ignore corrupt data */ }
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
const winnersModal = document.getElementById('winnersModal');
const modalCloseBtn = document.getElementById('modalCloseBtn');
const winnersList = document.getElementById('winnersList');
const clearWinnersBtn = document.getElementById('clearWinnersBtn');

// Participant modal refs
const participantsModal = document.getElementById('participantsModal');
const participantsCloseBtn = document.getElementById('participantsCloseBtn');
const allWatchersList = document.getElementById('allWatchersList');
const newWatcherName = document.getElementById('newWatcherName');
const newWatcherPoints = document.getElementById('newWatcherPoints');
const addNewWatcherBtn = document.getElementById('addNewWatcherBtn');
const startMovieNightBtn = document.getElementById('startMovieNightBtn');

// Judgement refs
const passBtn = document.getElementById('passBtn');
const punishBtn = document.getElementById('punishBtn');
const returnMsg = document.getElementById('returnMsg');
let lastWinnerInfo = null; // {seg, totalPts, winnerId}

// Admin refs
const adminBtn = document.getElementById('adminBtn');
const adminModal = document.getElementById('adminModal');
const adminCloseBtn = document.getElementById('adminCloseBtn');
const adminNewName = document.getElementById('adminNewName');
const adminNewPoints = document.getElementById('adminNewPoints');
const adminAddBtn = document.getElementById('adminAddBtn');
const adminWatchersList = document.getElementById('adminWatchersList');

async function verifyAdminPassword() {
    const pw = prompt('🔒 Enter admin password:');
    if (pw === null) return false;
    try {
        const res = await fetch('/api/admin/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: pw }),
        });
        const data = await res.json();
        if (data.ok) return true;
        alert('Incorrect password!');
        return false;
    } catch {
        alert('Failed to verify password');
        return false;
    }
}

// ---- Colors ----
const SEGMENT_COLORS = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
    '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
    '#F0B27A', '#82E0AA', '#F1948A', '#85929E', '#73C6B6',
    '#E59866', '#AED6F1', '#D7BDE2', '#A3E4D7', '#FAD7A0',
    '#E8DAEF', '#A9CCE3', '#D5DBDB', '#F9E79F', '#ABEBC6',
];

const cx = canvas.width / 2;
const cy = canvas.height / 2;
const radius = canvas.width / 2 - 10;

// ============================================================
//  API
// ============================================================

async function fetchData() {
    const res = await fetch('/api/data');
    allWatchers = await res.json();
}

async function addWatcher(name, points = 0) {
    const res = await fetch('/api/watchers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, points }),
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

async function saveWinner(titleName, watcherName, weight, totalWeight, participants) {
    const res = await fetch('/api/winners', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            title_name: titleName, watcher_name: watcherName,
            weight, total_weight: totalWeight,
            participants: participants || '',
        }),
    });
    if (!res.ok) return null;
    return await res.json();
}

async function clearAllWinners() {
    await fetch('/api/winners', { method: 'DELETE' });
    winners = [];
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
                segs.push({ name: t.name, points: t.points, watcherName: w.name, titleId: t.id });
            }
        }
    }
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
        cb.addEventListener('change', () => {
            if (cb.checked) activeIds.add(w.id);
            else activeIds.delete(w.id);
            saveActiveIds();
        });

        const name = document.createElement('span');
        name.className = 'participant-name';
        name.textContent = w.name;

        const pts = document.createElement('span');
        pts.className = 'participant-pts';
        pts.textContent = `${w.points} pts`;

        row.appendChild(cb);
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
    spinBtn.disabled = segments.length === 0;

    for (const w of active) {
        const card = document.createElement('div');
        card.className = 'watcher-card';
        card.dataset.watcherId = w.id;

        // Header
        const header = document.createElement('div');
        header.className = 'watcher-header';
        const rightDiv = document.createElement('div');
        if (w.titles.length > 0) {
            const clearBtn = document.createElement('button');
            clearBtn.className = 'clear-titles-btn';
            clearBtn.textContent = '🗑️ Clear Titles';
            clearBtn.addEventListener('click', async () => {
                for (const t of w.titles) {
                    if (typeof t.id === 'number') await deleteTitle(t.id);
                }
                w.titles = [];
                computeSegments();
                renderAll();
            });
            rightDiv.appendChild(clearBtn);
        }
        const delBtn = document.createElement('button');
        delBtn.className = 'watcher-del-btn';
        delBtn.textContent = '✕';
        delBtn.addEventListener('click', async () => {
            await deleteWatcher(w.id);
            computeSegments();
            renderAll();
        });
        rightDiv.appendChild(delBtn);
        const ptsClass = w.points >= 0 ? 'pts-badge pos' : 'pts-badge neg';
        let streakHtml = '';
        if (w.punish_streak > 0) {
            streakHtml = `<span class="streak-badge">🔥x${w.punish_streak}</span>`;
        }
        header.innerHTML = `<span class="watcher-name">👤 ${escHtml(w.name)} <span class="${ptsClass}">${w.points}</span>${streakHtml}</span>`;
        header.appendChild(rightDiv);
        card.appendChild(header);

        // Title rows
        for (let i = 0; i < Math.min(w.titles.length, 3); i++) {
            card.appendChild(createTitleRow(w, w.titles[i], i));
        }

        // Add-title button — available while under 3 titles and remaining budget ≥ 1
        const personalBudget = Math.max(1, w.points);
        const currentTitleTotal = w.titles.reduce((sum, t) => sum + (parseFloat(t.points) || 0), 0);
        const remainingBudget = Math.max(0, personalBudget - currentTitleTotal);
        const canAddMore = w.titles.length < 3 && remainingBudget >= 0.1;
        if (canAddMore) {
            const addBtn = document.createElement('button');
            addBtn.className = 'add-title-btn';
            addBtn.textContent = `➕ Add Title (${w.titles.length}/3 · ${remainingBudget.toFixed(1)} pts left)`;
            addBtn.addEventListener('click', () => {
                w.titles.push({ id: 'new_' + Date.now(), name: '', points: 1 });
                renderWatchers();
                const inputs = card.querySelectorAll('.title-input');
                const last = inputs[inputs.length - 1];
                if (last) last.focus();
            });
            card.appendChild(addBtn);
        }

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
    pointsInput.min = 0.1;
    pointsInput.max = 100;
    pointsInput.step = '0.1';
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
            let pts = parseFloat(pointsInput.value) || 1;
            if (pts < 0.1) pts = 0.1;
            if (pts > 100) pts = 100;

            // Enforce point budget: total title points cannot exceed watcher's personal points
            const personalPts = Math.max(1, watcher.points);
            const otherTotal = watcher.titles
                .filter(t => t.id !== title.id)
                .reduce((sum, t) => sum + (parseFloat(t.points) || 0), 0);
            const maxForThis = Math.max(0, personalPts - otherTotal);
            if (pts > maxForThis) {
                pts = maxForThis;
                if (pts < 0.1) pts = 0.1;
                pts = Math.round(pts * 100) / 100;
                pointsInput.value = pts;
            }
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
                    spinBtn.disabled = segments.length === 0;
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
                    spinBtn.disabled = segments.length === 0;
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
        let val = parseFloat(pointsInput.value) || 1;
        if (val > 0.1) {
            val = Math.round((val - 0.1) * 100) / 100;
            pointsInput.value = val;
            title.points = val;
            clearTimeout(saveTimer);
            saveNeedsRefresh = true;
            saveTimer = setTimeout(save, 200);
        }
    });

    pointsInput.addEventListener('input', () => {
        let val = parseFloat(pointsInput.value) || 1;
        if (val < 0.1) val = 0.1;
        if (val > 100) val = 100;
        val = Math.round(val * 100) / 100;
        title.points = val;
        clearTimeout(saveTimer);
        saveNeedsRefresh = true;
        saveTimer = setTimeout(save, 400);
    });

    plusBtn.addEventListener('click', () => {
        let val = parseFloat(pointsInput.value) || 1;
        if (val < 100) {
            val = Math.round((val + 0.1) * 100) / 100;
            pointsInput.value = val;
            title.points = val;
            clearTimeout(saveTimer);
            saveNeedsRefresh = true;
            saveTimer = setTimeout(save, 200);
        }
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
    if (count === 0) {
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fillStyle = '#1a1a2e';
        ctx.fill();
        ctx.strokeStyle = '#2a2a3e';
        ctx.lineWidth = 12;
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
    ctx.arc(cx, cy, radius + 14, 0, Math.PI * 2);
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
        ctx.fillStyle = SEGMENT_COLORS[i % SEGMENT_COLORS.length];
        ctx.fill();

        ctx.strokeStyle = '#1a1a2e';
        ctx.lineWidth = 7;
        ctx.stroke();

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(startAngle + arc / 2);
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#1a1a2e';
        const fontSize = count > 12 ? 34 : count > 6 ? 40 : 46;
        ctx.font = `bold ${fontSize}px 'Segoe UI', sans-serif`;

        const text = segments[i].name;
        const maxWidth = radius - 76;
        let displayText = text;
        if (ctx.measureText(text).width > maxWidth) {
            while (ctx.measureText(displayText + '…').width > maxWidth && displayText.length > 1) {
                displayText = displayText.slice(0, -1);
            }
            displayText += '…';
        }
        ctx.fillText(displayText, radius - 46, 0);
        ctx.restore();

        currentAngle += arc;
    }

    ctx.beginPath();
    ctx.arc(cx, cy, 46, 0, Math.PI * 2);
    ctx.fillStyle = '#1a1a2e';
    ctx.fill();
    ctx.strokeStyle = '#3a3a52';
    ctx.lineWidth = 7;
    ctx.stroke();
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
    if (isSpinning || segments.length < 1) return;

    // Budget validation: every active watcher must have enough points for their titles
    const active = getActiveWatchers();
    const budgetViolators = [];
    for (const w of active) {
        const budget = Math.max(1, w.points);
        const titleTotal = w.titles.reduce((sum, t) => sum + (parseFloat(t.points) || 0), 0);
        if (titleTotal > budget) {
            budgetViolators.push(`${w.name} (${budget} pt budget, ${titleTotal} pts in titles)`);
        }
    }
    if (budgetViolators.length > 0) {
        const msg = '🚫 Budget violation!<br>' + budgetViolators.join('<br>');
        returnMsg.innerHTML = msg;
        returnMsg.style.color = '#ff6b6b';
        returnMsg.classList.remove('hidden');
        return;
    }

    isSpinning = true;
    spinBtn.disabled = true;
    winnerDisplay.classList.add('hidden');
    passBtn.classList.add('faded');
    punishBtn.classList.add('faded');
    returnMsg.classList.add('hidden');
    lastWinnerInfo = null;
    // Reset message color
    returnMsg.style.color = '';

    const extraRotations = 4 + Math.random() * 4;
    const targetAngle = extraRotations * Math.PI * 2 + Math.random() * Math.PI * 2;
    const targetRotation = wheelRotation + targetAngle;
    const duration = 4000 + Math.random() * 2000;
    const startTime = performance.now();
    const startRotation = wheelRotation;

    function animate(now) {
        const elapsed = now - startTime;
        const t = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - t, 3);
        wheelRotation = startRotation + targetAngle * eased;
        drawWheel(wheelRotation);

        if (t < 1) {
            animFrameId = requestAnimationFrame(animate);
        } else {
            wheelRotation = targetRotation;
            drawWheel(wheelRotation);
            onSpinComplete();
        }
    }

    animFrameId = requestAnimationFrame(animate);
}

function onSpinComplete() {
    const idx = getWinnerSegmentIndex();
    if (idx >= 0 && idx < segments.length) {
        const seg = segments[idx];
        const totalPts = getTotalWeight();
        winnerText.textContent = `🏆 ${seg.name} 🏆`;
        winnerDetails.textContent = `Weight: ${seg.points}/${totalPts} — by ${seg.watcherName}`;
        winnerDisplay.classList.remove('hidden');
        fireConfetti();

        // Store for Pass/Punish
        lastWinnerInfo = { seg, totalPts };

        // Save the winner and process returns
        const active = getActiveWatchers();
        const participantNames = active.map(w => w.name).join(', ');
        const participantIds = active.map(w => w.id);

        saveWinner(seg.name, seg.watcherName, seg.points, totalPts, participantNames)
            .then(saved => {
                if (saved && saved.id) {
                    lastWinnerInfo.winnerId = saved.id;
                }
                fetchWinners();
            });

        // Check for stolen points to return
        const winnerData = allWatchers.find(w => w.name === seg.watcherName);
        if (winnerData && participantIds.length > 1) {
            fetch('/api/spin/process-win', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ winner_id: winnerData.id, participant_ids: participantIds }),
            })
            .then(r => r.json())
            .then(data => {
                if (data.returned && data.returned.length > 0) {
                    const names = data.returned.map(r => `${r.victim_name} (${r.amount} pt${r.amount > 1 ? 's' : ''})`).join(', ');
                    returnMsg.textContent = `🔄 Returned stolen points: ${names}`;
                    returnMsg.classList.remove('hidden');
                }
                // Update winner points in allWatchers from response
                if (data.winner) {
                    const w = allWatchers.find(x => x.id === data.winner.id);
                    if (w) w.points = data.winner.points;
                }
                // Refresh display and redraw wheel
                renderAll();
                // Show judgement buttons
                passBtn.classList.remove('faded');
                punishBtn.classList.remove('faded');
            })
            .catch(() => {
                passBtn.classList.remove('faded');
                punishBtn.classList.remove('faded');
            });
        } else {
            passBtn.classList.remove('faded');
            punishBtn.classList.remove('faded');
        }
    } else {
        isSpinning = false;
        spinBtn.disabled = false;
    }
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
    segments = getActiveSegments();
    // Fisher-Yates shuffle so the same watcher's titles aren't clumped together
    for (let i = segments.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [segments[i], segments[j]] = [segments[j], segments[i]];
    }
}

// ============================================================
//  Render All
// ============================================================

function renderAll() {
    computeSegments();
    renderWatchers();
    drawWheel(wheelRotation);
}

// ============================================================
//  Previous Winners Modal
// ============================================================

function renderWinnersList() {
    winnersList.innerHTML = '';
    if (winners.length === 0) {
        winnersList.innerHTML = '<p class="empty-msg">No winners yet! Spin the wheel~ ✨</p>';
        return;
    }
    for (const w of winners) {
        const entry = document.createElement('div');
        entry.className = 'winner-entry';

        const left = document.createElement('div');
        const t = document.createElement('div');
        t.className = 'winner-entry-title';

        // Show judgement emoji
        let titleText = '';
        if (w.judgement === 'pass') titleText = '👍 ';
        else if (w.judgement === 'punish') titleText = '👎 ';
        titleText += `🏆 ${w.title_name}`;
        t.textContent = titleText;

        const m = document.createElement('div');
        m.className = 'winner-entry-meta';
        let meta = `Weight: ${w.weight}/${w.total_weight} — by ${w.watcher_name}`;
        if (w.participants) {
            meta += `  •  🎬 ${w.participants}`;
        }
        m.textContent = meta;
        left.appendChild(t);
        left.appendChild(m);

        // Right side: timestamp + retroactive voting
        const rightCol = document.createElement('div');
        rightCol.style.cssText = 'display:flex;flex-direction:column;align-items:flex-end;gap:0.3rem;';

        const when = document.createElement('div');
        when.className = 'winner-entry-when';
        const d = new Date(w.won_at + 'Z');
        when.textContent = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        rightCol.appendChild(when);

        // Retroactive voting arrows (only if no judgement yet)
        if (!w.judgement || w.judgement === '') {
            const voteRow = document.createElement('div');
            voteRow.style.cssText = 'display:flex;gap:0.3rem;';

            const upBtn = document.createElement('button');
            upBtn.textContent = '👍';
            upBtn.title = 'Mark as Pass';
            upBtn.className = 'retro-vote-btn';
            upBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await fetch(`/api/winners/${w.id}/judgement`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ judgement: 'pass' }),
                });
                await fetchWinners();
                renderWinnersList();
            });

            const downBtn = document.createElement('button');
            downBtn.textContent = '👎';
            downBtn.title = 'Mark as Punish';
            downBtn.className = 'retro-vote-btn';
            downBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await fetch(`/api/winners/${w.id}/judgement`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ judgement: 'punish' }),
                });
                await fetchWinners();
                renderWinnersList();
            });

            voteRow.appendChild(upBtn);
            voteRow.appendChild(downBtn);
            rightCol.appendChild(voteRow);
        }

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

// ============================================================
//  Events — Participants Modal
// ============================================================

addWatcherBtn.addEventListener('click', openParticipantsModal);
participantsCloseBtn.addEventListener('click', closeParticipantsModal);
participantsModal.addEventListener('click', (e) => {
    if (e.target === participantsModal) closeParticipantsModal();
});

// Start movie night
startMovieNightBtn.addEventListener('click', () => {
    closeParticipantsModal();
    renderAll();
});

// Escape key for participant modal
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (!participantsModal.classList.contains('hidden')) closeParticipantsModal();
        if (!winnersModal.classList.contains('hidden')) closeWinnersModal();
    }
});

// ============================================================
//  Events — Spin
// ============================================================

spinBtn.addEventListener('click', spinWheel);

// ── Events — Pass / Punish ──

passBtn.addEventListener('click', async () => {
    // Pass: nothing changes, just re-enable spinning
    passBtn.classList.add('faded');
    punishBtn.classList.add('faded');
    returnMsg.classList.add('hidden');
    // Save judgement & reset punish streak
    if (lastWinnerInfo && lastWinnerInfo.winnerId) {
        await fetch(`/api/winners/${lastWinnerInfo.winnerId}/judgement`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ judgement: 'pass' }),
        }).then(() => fetchWinners());
        // Reset punish streak on the backend
        const winnerData2 = allWatchers.find(w => w.name === lastWinnerInfo.seg.watcherName);
        if (winnerData2) {
            await fetch('/api/spin/pass', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ winner_id: winnerData2.id }),
            });
        }
        // Remove the winning title as cleanup
        if (lastWinnerInfo.seg && typeof lastWinnerInfo.seg.titleId === 'number') {
            await deleteTitle(lastWinnerInfo.seg.titleId);
        }
    }
    // Re-render to update the UI
    renderAll();
    isSpinning = false;
    spinBtn.disabled = false;
    lastWinnerInfo = null;
});

punishBtn.addEventListener('click', async () => {
    if (!lastWinnerInfo) return;
    const active = getActiveWatchers();
    const participantIds = active.map(w => w.id);
    const winnerData = allWatchers.find(w => w.name === lastWinnerInfo.seg.watcherName);
    if (!winnerData) return;

    try {
        const res = await fetch('/api/spin/punish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ winner_id: winnerData.id, participant_ids: participantIds }),
        });
        const data = await res.json();
        if (!res.ok) { alert(data.error || 'Punish failed'); return; }

        // Update points and streak in allWatchers from response
        if (data.winner) {
            const w = allWatchers.find(x => x.id === data.winner.id);
            if (w) {
                w.points = data.winner.points;
                w.punish_streak = data.winner.punish_streak;
            }
        }
        // Full refresh to get latest state
        await fetchData();
        renderAll();
        returnMsg.textContent = `👎 Punished! ${lastWinnerInfo.seg.watcherName} lost ${data.total_theft} point${data.total_theft !== 1 ? 's' : ''} (🔥x${data.multiplier} streak!)`;
        returnMsg.classList.remove('hidden');

        // Save punish judgement
        if (lastWinnerInfo.winnerId) {
            await fetch(`/api/winners/${lastWinnerInfo.winnerId}/judgement`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ judgement: 'punish' }),
            }).then(() => fetchWinners());
        }

        // Remove the winning title as cleanup
        if (lastWinnerInfo.seg && typeof lastWinnerInfo.seg.titleId === 'number') {
            await deleteTitle(lastWinnerInfo.seg.titleId);
        }
        // Re-render after title removal
        renderAll();

        // Re-enable spinning after a moment
        setTimeout(() => {
            passBtn.classList.add('faded');
            punishBtn.classList.add('faded');
            returnMsg.classList.add('hidden');
            isSpinning = false;
            spinBtn.disabled = false;
            lastWinnerInfo = null;
        }, 2000);
    } catch (e) {
        alert('Punish failed: ' + e.message);
    }
});

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

        const ptsInput = document.createElement('input');
        ptsInput.type = 'number';
        ptsInput.className = 'points-input';
        ptsInput.value = w.points;
        ptsInput.min = '-9999';
        ptsInput.max = '9999';

        const saveBtn = document.createElement('button');
        saveBtn.className = 'btn btn-small btn-add';
        saveBtn.textContent = '💾';
        saveBtn.title = 'Save points';
        saveBtn.addEventListener('click', async () => {
            const newPts = parseInt(ptsInput.value) || 0;
            if (newPts < -9999 || newPts > 9999) {
                alert('Points must be between -9999 and 9999');
                return;
            }
            try {
                await adjustWatcherPoints(w.id, newPts - w.points);
                await fetchData();
                renderAdminWatchers();
                renderAll();
            } catch (e) { alert(e.message); }
        });

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
        row.appendChild(ptsInput);
        row.appendChild(saveBtn);
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
    const pts = parseInt(adminNewPoints.value) || 0;
    try {
        const w = await addWatcher(name, pts);
        activeIds.add(w.id);
        saveActiveIds();
        adminNewName.value = '';
        adminNewPoints.value = '0';
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

clearWinnersBtn.addEventListener('click', async () => {
    if (winners.length === 0) return;
    if (!confirm('⚠️ This will permanently delete ALL winner history. Are you sure?')) return;
    await clearAllWinners();
    renderWinnersList();
});

// ============================================================
//  Init
// ============================================================

// ---- WebSocket real-time sync ----
const socket = io();

socket.on('data_changed', () => {
    // Don't interrupt if user is in a modal or editing a title
    if (!participantsModal.classList.contains('hidden') ||
        !winnersModal.classList.contains('hidden') ||
        !adminModal.classList.contains('hidden')) {
        return;
    }
    const active = document.activeElement;
    if (active && active.closest('.title-row')) {
        return;
    }
    fetchData().then(renderAll);
});

socket.on('winners_changed', () => {
    if (!winnersModal.classList.contains('hidden')) {
        fetchWinners();
        renderWinnersList();
    }
});

(async function init() {
    loadActiveIds();
    await fetchData();
    await fetchWinners();
    renderAll();
})();
