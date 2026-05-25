/* ============================================================
   Wheel of Doom(b) — Frontend App
   ============================================================ */

// ---- State ----
let movies = [];
let isSpinning = false;
let wheelRotation = 0; // radians
let animFrameId = null;

// ---- DOM refs ----
const canvas = document.getElementById('wheelCanvas');
const ctx = canvas.getContext('2d');
const movieList = document.getElementById('movieList');
const emptyMsg = document.getElementById('emptyMsg');
const movieInput = document.getElementById('movieInput');
const addBtn = document.getElementById('addBtn');
const spinBtn = document.getElementById('spinBtn');
const clearBtn = document.getElementById('clearBtn');
const winnerDisplay = document.getElementById('winnerDisplay');
const winnerText = document.getElementById('winnerText');

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

async function fetchMovies() {
    const res = await fetch('/api/movies');
    movies = await res.json();
}

async function addMovie(name) {
    const res = await fetch('/api/movies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
    });
    if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to add movie');
    }
    const movie = await res.json();
    movies.push(movie);
}

async function deleteMovie(id) {
    await fetch(`/api/movies/${id}`, { method: 'DELETE' });
    movies = movies.filter(m => m.id !== id);
}

async function clearMovies() {
    await fetch('/api/movies', { method: 'DELETE' });
    movies = [];
}

// ============================================================
//  Rendering
// ============================================================

function renderList() {
    movieList.innerHTML = '';
    if (movies.length === 0) {
        emptyMsg.style.display = 'block';
        clearBtn.style.display = 'none';
        spinBtn.disabled = true;
        return;
    }

    emptyMsg.style.display = 'none';
    clearBtn.style.display = 'inline-block';
    spinBtn.disabled = false;

    movies.forEach(m => {
        const li = document.createElement('li');
        li.innerHTML = `
            <span class="movie-name">${escHtml(m.name)}</span>
            <button class="del-btn" data-id="${m.id}">✕</button>
        `;
        li.querySelector('.del-btn').addEventListener('click', async () => {
            await deleteMovie(m.id);
            renderList();
            drawWheel(wheelRotation);
        });
        movieList.appendChild(li);
    });
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

    const count = movies.length;
    if (count === 0) {
        // Empty state
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fillStyle = '#1a1a2e';
        ctx.fill();
        ctx.strokeStyle = '#2a2a3e';
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.fillStyle = '#555';
        ctx.font = '16px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Add some movies!', cx, cy);
        return;
    }

    const arc = (2 * Math.PI) / count;

    // Draw outer ring
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 4, 0, Math.PI * 2);
    ctx.fillStyle = '#2a2a3e';
    ctx.fill();

    // Draw segments
    for (let i = 0; i < count; i++) {
        const startAngle = rotation + i * arc;
        const endAngle = startAngle + arc;

        // Segment fill
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, radius, startAngle, endAngle);
        ctx.closePath();
        ctx.fillStyle = SEGMENT_COLORS[i % SEGMENT_COLORS.length];
        ctx.fill();

        // Segment border
        ctx.strokeStyle = '#1a1a2e';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Text along the segment
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(startAngle + arc / 2);

        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#1a1a2e';
        const fontSize = count > 12 ? 11 : count > 6 ? 13 : 15;
        ctx.font = `bold ${fontSize}px 'Segoe UI', sans-serif`;

        const text = movies[i].name;
        const maxWidth = radius - 20;
        let displayText = text;
        if (ctx.measureText(text).width > maxWidth) {
            while (ctx.measureText(displayText + '…').width > maxWidth && displayText.length > 1) {
                displayText = displayText.slice(0, -1);
            }
            displayText += '…';
        }
        ctx.fillText(displayText, radius - 12, 0);
        ctx.restore();
    }

    // Center dot
    ctx.beginPath();
    ctx.arc(cx, cy, 12, 0, Math.PI * 2);
    ctx.fillStyle = '#1a1a2e';
    ctx.fill();
    ctx.strokeStyle = '#3a3a52';
    ctx.lineWidth = 2;
    ctx.stroke();
}

// ============================================================
//  Spin Animation
// ============================================================

function spinWheel() {
    if (isSpinning || movies.length < 1) return;
    isSpinning = true;
    spinBtn.disabled = true;
    winnerDisplay.classList.add('hidden');

    // How many full rotations + random offset
    const extraRotations = 4 + Math.random() * 4; // 4–8 full spins
    const targetAngle = extraRotations * Math.PI * 2 + Math.random() * Math.PI * 2;
    const targetRotation = wheelRotation + targetAngle;
    const duration = 4000 + Math.random() * 2000; // 4–6 seconds
    const startTime = performance.now();
    const startRotation = wheelRotation;

    function animate(now) {
        const elapsed = now - startTime;
        const t = Math.min(elapsed / duration, 1);
        // Ease out cubic
        const eased = 1 - Math.pow(1 - t, 3);
        const currentRotation = startRotation + targetAngle * eased;
        wheelRotation = currentRotation;
        drawWheel(currentRotation);

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

function getWinnerIndex() {
    const count = movies.length;
    if (count === 0) return -1;

    // The pointer is at the top (12 o'clock = -π/2 direction)
    // We need to find which segment the pointer (top-center) is pointing at
    // The pointer is at angle -π/2 (straight up)
    // Normalize: we want to find which segment contains the pointer direction
    const pointerAngle = -Math.PI / 2; // top of the wheel

    // Each segment i starts at (wheelRotation + i * arc)
    // The segment's midpoint direction: wheelRotation + i * arc + arc/2
    // We want the segment where the pointer angle falls within it

    const arc = (2 * Math.PI) / count;

    // Normalize the pointer angle relative to wheelRotation
    // Segment i covers from (wheelRotation + i*arc) to (wheelRotation + (i+1)*arc)
    // Find which i such that pointerAngle is in that range

    for (let i = 0; i < count; i++) {
        const start = wheelRotation + i * arc;
        const end = start + arc;

        // Normalize to [0, 2π)
        const normStart = ((start % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        const normEnd = ((end % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        const normPointer = ((pointerAngle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

        if (normStart < normEnd) {
            if (normPointer >= normStart && normPointer < normEnd) {
                return i;
            }
        } else {
            // Wraps around 0
            if (normPointer >= normStart || normPointer < normEnd) {
                return i;
            }
        }
    }

    return 0; // fallback
}

function onSpinComplete() {
    const winner = getWinnerIndex();
    if (winner >= 0 && winner < movies.length) {
        const name = movies[winner].name;
        winnerText.textContent = `🏆 ${name} 🏆`;
        winnerDisplay.classList.remove('hidden');
        fireConfetti();
    }
    isSpinning = false;
    spinBtn.disabled = false;
}

// ============================================================
//  Confetti 🎊
// ============================================================

function fireConfetti() {
    const colors = [
        '#FF6B6B', '#FFD93D', '#6BCB77', '#4D96FF',
        '#FF6BB5', '#A78BFA', '#FF9F43', '#00D2D3',
    ];

    for (let i = 0; i < 60; i++) {
        const piece = document.createElement('div');
        piece.className = 'confetti-piece';

        const color = colors[Math.floor(Math.random() * colors.length)];
        const size = 6 + Math.random() * 8;
        const left = 10 + Math.random() * 80;
        const delay = Math.random() * 1.5;
        const duration = 2 + Math.random() * 2;
        const rotation = Math.random() * 360;
        const xDrift = (Math.random() - 0.5) * 200;

        piece.style.cssText = `
            left: ${left}%;
            width: ${size}px;
            height: ${size * (0.4 + Math.random() * 0.6)}px;
            background: ${color};
            border-radius: ${Math.random() > 0.5 ? '50%' : '2px'};
            animation: confetti-fall ${duration}s ease-out ${delay}s forwards;
            transform: rotate(${rotation}deg);
            --x-drift: ${xDrift}px;
        `;

        // Add horizontal drift
        piece.style.setProperty('--x-drift', `${xDrift}px`);

        document.body.appendChild(piece);

        // Clean up after animation
        setTimeout(() => piece.remove(), (duration + delay) * 1000 + 100);
    }
}

// Add horizontal drift to the confetti keyframes dynamically
const styleSheet = document.createElement('style');
styleSheet.textContent = `
    @keyframes confetti-fall {
        0% {
            transform: translateY(0) rotate(0deg) translateX(0);
            opacity: 1;
        }
        100% {
            transform: translateY(100vh) rotate(720deg) translateX(var(--x-drift));
            opacity: 0;
        }
    }
`;
document.head.appendChild(styleSheet);

// ============================================================
//  Events
// ============================================================

// Add movie
async function handleAdd() {
    const name = movieInput.value.trim();
    if (!name) return;

    try {
        await addMovie(name);
        movieInput.value = '';
        movieInput.focus();
        renderList();
        drawWheel(wheelRotation);
    } catch (err) {
        alert(err.message);
    }
}

addBtn.addEventListener('click', handleAdd);
movieInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleAdd();
});

// Spin
spinBtn.addEventListener('click', spinWheel);

// Clear all
clearBtn.addEventListener('click', async () => {
    if (movies.length === 0) return;
    if (!confirm('Remove all movies?')) return;
    await clearMovies();
    wheelRotation = 0;
    renderList();
    drawWheel(wheelRotation);
    winnerDisplay.classList.add('hidden');
});

// ============================================================
//  Init
// ============================================================

(async function init() {
    await fetchMovies();
    renderList();
    drawWheel(0);
})();
