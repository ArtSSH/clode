/* ============================================================
   STATE
============================================================ */
const STARS_KEY = 'mult_stars_v1';
function loadStars() { return parseInt(localStorage.getItem(STARS_KEY) || '0'); }
function saveStars() { localStorage.setItem(STARS_KEY, totalStars); }

const EXAM_SCORES_KEY = 'mult_exam_scores_v1';
function loadExamScores() { try { return JSON.parse(localStorage.getItem(EXAM_SCORES_KEY) || '{}'); } catch { return {}; } }
function saveExamScore(table, score) {
  const d = loadExamScores();
  if (d[table] == null || score > d[table]) d[table] = score; // keep best result
  localStorage.setItem(EXAM_SCORES_KEY, JSON.stringify(d));
}
function getExamScore(table) { return loadExamScores()[table] ?? null; }

let totalStars     = loadStars();
let curTable       = 2;
let curMode        = 'flash';
let questions      = [];
let qIdx           = 0;
let sessionStars   = 0;
let sessionCorrect = 0;
let flashRevealed  = false;
let srsQueue       = [];
let srsQueueIdx    = 0;
let mixedReview    = false;
let srsBaseTotal   = 0;   // cards in the session, not counting repeats

/* ============================================================
   SRS  (localStorage)
============================================================ */
const SRS_KEY = 'mult_srs_v1';
function fmtDate(dt) {
  const p = n => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}
function today() { return fmtDate(new Date()); }
function addDays(d, n) { const [y, m, day] = d.split('-').map(Number); return fmtDate(new Date(y, m - 1, day + n)); }
function loadSRS() { try { return JSON.parse(localStorage.getItem(SRS_KEY) || '{}'); } catch { return {}; } }
function saveSRS(data) { localStorage.setItem(SRS_KEY, JSON.stringify(data)); }
function cardKey(table, b) { return `${table}_${b}`; }

function getCardData(table, b) {
  const data = loadSRS();
  return data[cardKey(table, b)] || { interval: 0, ease: 2.5, due: today(), lapses: 0 };
}
function setCardData(table, b, cd) {
  const data = loadSRS();
  data[cardKey(table, b)] = cd;
  saveSRS(data);
}

// Returns { due: number, started: boolean }
function getTableStats(table) {
  const t = today();
  const data = loadSRS();
  let due = 0, started = false;
  for (let b = 1; b <= 10; b++) {
    const key = cardKey(table, b);
    if (data[key]) {
      started = true;
      if (data[key].due <= t) due++;
    }
  }
  return { due, started };
}

// Fact level 0-4 from its SRS state: 0 new, 1 learning, 2 young, 3 known, 4 solid
function factLevel(cd) {
  if (!cd) return 0;
  if (cd.interval < 1) return 1;
  if (cd.interval < 3) return 2;
  if (cd.interval < 8) return 3;
  return 4;
}
// A table counts as learned when all 10 of its facts are at level 3+
function getTableMastery(table) {
  const data = loadSRS();
  const levels = [];
  for (let b = 1; b <= 10; b++) levels.push(factLevel(data[cardKey(table, b)]));
  const known = levels.filter(l => l >= 3).length;
  return { levels, known, mastered: known === 10 };
}

function applyRating(table, b, rating) {
  const cd = getCardData(table, b);
  let { interval, ease, lapses } = cd;
  // Practising a card before it is due must not stretch its interval
  if (rating > 0 && interval > 0 && cd.due > today()) return { requeue: false };
  if (rating === 0) {
    lapses++; interval = 0; ease = Math.max(1.3, ease - 0.2);
    setCardData(table, b, { interval, ease, due: today(), lapses });
    return { requeue: true };
  }
  if (rating === 1) {
    ease = Math.max(1.3, ease - 0.15);
    interval = interval === 0 ? 1 : Math.max(1, Math.round(interval * 1.2));
  } else {
    ease = Math.min(3.0, ease + 0.1);
    if (interval === 0) interval = 1;
    else if (interval === 1) interval = 3;
    else interval = Math.round(interval * ease);
  }
  setCardData(table, b, { interval, ease, due: addDays(today(), interval), lapses });
  return { requeue: false };
}

// A wrong answer in test/dictation/exam sends the fact back to the cards due today
function recordMistake(q) { applyRating(q.a, q.b, 0); }

function buildSRSQueue(table) {
  const t = today();
  const data = loadSRS();
  const due = [], fresh = [], upcoming = [];
  for (let b = 1; b <= 10; b++) {
    const key = cardKey(table, b);
    if (!data[key]) fresh.push(b);
    else if (data[key].due <= t) due.push({ b, due: data[key].due });
    else upcoming.push(b);
  }
  due.sort((a, z) => a.due.localeCompare(z.due));
  fresh.sort((x, y) => EASY_ORDER.indexOf(x) - EASY_ORDER.indexOf(y));
  let queue = [...due.map(x => x.b), ...fresh];
  if (queue.length === 0) queue = [...upcoming];
  return queue.map(b => ({ t: table, b, requeueCount: 0 }));
}

// New cards go easiest first: ×1, ×10, ×2, ×5, then the rest
const EASY_ORDER = [1, 10, 2, 5, 4, 3, 9, 6, 8, 7];

// Strategy hint for a fact; picks the easier factor as the "rule" and the other as the number
const HINT_RANK = { 1: 0, 10: 1, 2: 2, 5: 3, 9: 4, 4: 5, 3: 6, 8: 7, 6: 8, 7: 9 };
function strategyHint(a, b) {
  const [k, n] = HINT_RANK[a] <= HINT_RANK[b] ? [a, b] : [b, a];
  switch (k) {
    case 1:  return `Помножити на 1 — число не змінюється: ${n}`;
    case 10: return `×10 — допиши нуль: ${n} → ${n * 10}`;
    case 2:  return `Подвой: ${n} + ${n} = ${2 * n}`;
    case 5:  return `5 × ${n} — половина від 10 × ${n} = ${10 * n}. Половина: ${5 * n}`;
    case 9:  return `9 × ${n} = 10 × ${n} − ${n} = ${10 * n} − ${n} = ${9 * n}`;
    case 4:  return `Подвій двічі: ${n} + ${n} = ${2 * n}, ${2 * n} + ${2 * n} = ${4 * n}`;
    case 3:  return `Подвій і додай ще раз: ${n} + ${n} = ${2 * n}, ${2 * n} + ${n} = ${3 * n}`;
    case 8:  return `Подвій тричі: ${n} → ${2 * n} → ${4 * n} → ${8 * n}`;
    case 6:  return `6 × ${n} = 5 × ${n} + ${n} = ${5 * n} + ${n} = ${6 * n}`;
    default: return `7 × ${n} = 5 × ${n} + 2 × ${n} = ${5 * n} + ${2 * n} = ${7 * n}`;
  }
}
// a rows of b dots, grouped by five
function dotArrayHTML(a, b) {
  let html = '';
  for (let r = 0; r < a; r++) {
    html += `<div class="dot-row${r === 5 ? ' gap-r' : ''}">`;
    for (let c = 0; c < b; c++) html += `<i${c === 5 ? ' class="gap-c"' : ''}></i>`;
    html += '</div>';
  }
  return html;
}

// Cards due today from every table, oldest first (capped so one session stays short)
function buildMixedQueue(limit = 20) {
  const t = today();
  const data = loadSRS();
  const due = [];
  for (let table = 2; table <= 10; table++) {
    for (let b = 1; b <= 10; b++) {
      const cd = data[cardKey(table, b)];
      if (cd && cd.due <= t) due.push({ t: table, b, due: cd.due });
    }
  }
  due.sort((x, y) => x.due.localeCompare(y.due));
  const picked = due.slice(0, limit);
  for (let i = picked.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [picked[i], picked[j]] = [picked[j], picked[i]]; }
  return picked.map(x => ({ t: x.t, b: x.b, requeueCount: 0 }));
}

/* ============================================================
   TABLE GRID
============================================================ */
const tg = document.getElementById('tableGrid');
for (let i = 2; i <= 10; i++) {
  const btn = document.createElement('button');
  btn.className = 'table-btn';
  btn.setAttribute('data-n', i);
  btn.id = `tbtn_${i}`;
  btn.innerHTML = `<div class="table-btn-num">${i}</div><div class="table-due-label" id="tlabel_${i}"></div>`;
  btn.onclick = () => selectTable(i);
  tg.appendChild(btn);
}

function refreshTableBadges() {
  for (let i = 2; i <= 10; i++) {
    const btn = document.getElementById(`tbtn_${i}`);
    const old = btn.querySelector('.table-badge');
    if (old) old.remove();

    const oldDots = btn.querySelector('.table-dots');
    if (oldDots) oldDots.remove();
    const { levels, mastered } = getTableMastery(i);
    const dots = document.createElement('div');
    dots.className = 'table-dots';
    dots.innerHTML = levels.map(l => `<span class="${l >= 3 ? 'on' : l >= 1 ? 'part' : ''}"></span>`).join('');
    btn.appendChild(dots);
    btn.classList.toggle('mastered', mastered);

    const { due, started } = getTableStats(i);

    if (!started) {
      // Brand new table — no badge, clean look
    } else if (due > 0) {
      const badge = document.createElement('div');
      badge.className = 'table-badge due';
      badge.textContent = due;
      btn.appendChild(badge);
    }
  }
}

/* ============================================================
   NAVIGATION
============================================================ */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0, 0);
  if (id === 'sHome') { refreshTableBadges(); refreshHomeDashboard(); }
}
function goHome() { showScreen('sHome'); }

function updateStarsBadges() {
  saveStars();
  document.getElementById('statStars').textContent    = totalStars;
  document.getElementById('modeStars').textContent    = totalStars;
  document.getElementById('choiceStars').textContent  = totalStars;
  document.getElementById('typingStars').textContent  = totalStars;
  document.getElementById('examStars').textContent    = totalStars;
  const ms = document.getElementById('mathStars'); if (ms) ms.textContent = totalStars;
}

function getGlobalStats() {
  const t = today();
  const data = loadSRS();
  let totalNew = 0, totalDue = 0;
  for (let table = 2; table <= 10; table++) {
    for (let b = 1; b <= 10; b++) {
      const key = cardKey(table, b);
      if (!data[key]) totalNew++;
      else if (data[key].due <= t) totalDue++;
    }
  }
  return { totalNew, totalDue };
}

function refreshHomeDashboard() {
  const { totalNew, totalDue } = getGlobalStats();
  document.getElementById('statNew').textContent   = totalNew;
  document.getElementById('statDue').textContent   = totalDue;
  document.getElementById('statStars').textContent = totalStars;
  let mastered = 0;
  for (let t = 2; t <= 10; t++) if (getTableMastery(t).mastered) mastered++;
  document.getElementById('statMastered').textContent = mastered;

  const mixedBtn = document.getElementById('mixedBtn');
  mixedBtn.style.display = totalDue > 0 ? '' : 'none';
  mixedBtn.textContent = `🔀 Змішане повторення · ${Math.min(totalDue, 20)}`;
}

/* ============================================================
   SELECT TABLE
============================================================ */
function selectTable(n) {
  curTable = n;
  document.getElementById('modeTitle').textContent = `Таблиця на ${n}`;

  const { due, started } = getTableStats(n);
  const info = document.getElementById('modeDueInfo');
  const txt  = document.getElementById('modeDueText');

  const countBadge = document.getElementById('flashCardCount');
  if (!started) {
    countBadge.textContent = '10 нових';
    countBadge.style.display = 'inline';
  } else if (due > 0) {
    countBadge.textContent = `${due} ${due === 1 ? 'картка' : due <= 4 ? 'картки' : 'карток'}`;
    countBadge.style.display = 'inline';
  } else {
    countBadge.textContent = '✓ готово';
    countBadge.style.display = 'inline';
  }

  if (!started) {
    txt.textContent = '10 нових карток — починай з «Картки»!';
    info.classList.add('show');
  } else if (due > 0) {
    txt.textContent = `${due} ${due === 1 ? 'картка' : due <= 4 ? 'картки' : 'карток'} для повторення сьогодні`;
    info.classList.add('show');
  } else {
    info.classList.remove('show');
  }

  const examBadge = document.getElementById('examLastScore');
  const lastScore = getExamScore(n);
  if (lastScore !== null) {
    examBadge.textContent = `${lastScore} б.`;
    examBadge.style.display = 'inline';
  } else {
    examBadge.style.display = 'none';
  }

  showScreen('sMode');
}

/* ============================================================
   BUILD RANDOM Qs
============================================================ */
function buildQs(table) {
  let arr = [];
  for (let i = 1; i <= 10; i++) arr.push({ a: table, b: i, ans: table * i });
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}
function wrongOpts(q) {
  const correct = q.ans;
  // typical mistakes: neighbouring products and off-by-one slips
  const near = [q.a * (q.b - 1), q.a * (q.b + 1), (q.a - 1) * q.b, (q.a + 1) * q.b, correct - 1, correct + 1, correct + 10, correct - 10]
    .filter(v => v > 0 && v !== correct);
  const pool = new Set([correct]);
  const nearShuffled = [...new Set(near)].sort(() => Math.random() - 0.5);
  for (const v of nearShuffled) { if (pool.size >= 4) break; pool.add(v); }
  while (pool.size < 4) pool.add((Math.floor(Math.random() * 10) + 1) * (Math.floor(Math.random() * 10) + 1));
  const arr = [...pool];
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}
// 10 questions for test/dictation: weak facts come up more often (max 2 per fact, never back to back)
function buildWeightedQs(table) {
  const data = loadSRS();
  const weight = {}, left = {};
  for (let b = 1; b <= 10; b++) {
    const cd = data[cardKey(table, b)];
    weight[b] = cd
      ? Math.max(0.3, 1 + cd.lapses * 1.5 + Math.max(0, 2.5 - cd.ease) * 2 + (cd.interval < 1 ? 1 : 0) - factLevel(cd) * 0.15)
      : 2;
    left[b] = 2;
  }
  const out = [];
  let prev = null;
  while (out.length < 10) {
    const cands = [];
    for (let b = 1; b <= 10; b++) if (left[b] > 0 && b !== prev) cands.push(b);
    let r = Math.random() * cands.reduce((s, b) => s + weight[b], 0);
    let pick = cands[cands.length - 1];
    for (const b of cands) { r -= weight[b]; if (r <= 0) { pick = b; break; } }
    left[pick]--; prev = pick;
    out.push({ a: table, b: pick, ans: table * pick });
  }
  return out;
}
function qFmt(q) { return `${q.a} <span class="times">×</span> ${q.b}`; }

/* ── MATH EXERCISES ── */
function buildExprPool(table) {
  const cfg =[0,0, 6,8,10,12,15,18,20,25,30]; // addMax per table
  const mlt = [0,0, 4,5, 5, 6, 7, 8, 9,10,10]; // multMax
  const dlt = [0,0, 0,2, 3, 4, 5, 5, 6, 7, 8]; // two-step max delta
  const addMax = cfg[table], multMax = mlt[table], delta = dlt[table];
  const pool = []; const seen = new Set();
  function push(expr, ans) {
    if (!seen.has(expr) && ans >= 0 && ans <= 99) { seen.add(expr); pool.push({ expr, ans }); }
  }
  const half = Math.floor(addMax / 2);
  // simple add/sub
  for (let a = 1; a <= addMax; a++) {
    for (let b = 1; b <= half; b++) {
      push(`${a} + ${b}`, a + b);
      if (a > b) push(`${a} \u2212 ${b}`, a - b);
    }
  }
  // table × n
  for (let n = 2; n <= multMax; n++) push(`${table} \u00d7 ${n}`, table * n);
  // two-step
  if (delta > 0) {
    for (let n = 2; n <= Math.min(5, multMax); n++) {
      for (let c = 1; c <= delta; c++) {
        push(`${table} \u00d7 ${n} + ${c}`, table * n + c);
        if (table * n - c > 0) push(`${table} \u00d7 ${n} \u2212 ${c}`, table * n - c);
      }
    }
  }
  return pool;
}

function shuffled(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// Word problems: forms are [2–4, 5+] so the numeral agrees with the noun
const WORD_ITEMS = [
  { box: ['коробки', 'коробок'],   each: 'У кожній',  thing: ['цукерки', 'цукерок'] },
  { box: ['тарілки', 'тарілок'],   each: 'На кожній', thing: ['яблука', 'яблук'] },
  { box: ['букети', 'букетів'],    each: 'У кожному', thing: ['квітки', 'квіток'] },
  { box: ['полиці', 'полиць'],     each: 'На кожній', thing: ['книжки', 'книжок'] },
  { box: ['кошики', 'кошиків'],    each: 'У кожному', thing: ['гриби', 'грибів'] },
  { box: ['пакети', 'пакетів'],    each: 'У кожному', thing: ['апельсини', 'апельсинів'] },
  { box: ['ряди', 'рядів'],        each: 'У кожному', thing: ['стільці', 'стільців'] },
  { box: ['зошити', 'зошитів'],    each: 'У кожному', thing: ['сторінки', 'сторінок'] },
  { box: ['вази', 'ваз'],          each: 'У кожній',  thing: ['троянди', 'троянд'] },
];
function pl(n, few, many) { return n <= 4 ? few : many; }
function wordProblem(table, other) {
  const c = WORD_ITEMS[Math.floor(Math.random() * WORD_ITEMS.length)];
  const [n, t] = Math.random() < 0.5 ? [table, other] : [other, table];
  return {
    text: `Є ${n} ${pl(n, c.box[0], c.box[1])}. ${c.each} — по ${t} ${pl(t, c.thing[0], c.thing[1])}. Скільки ${c.thing[1]} усього?`,
    expr: `w:${c.box[0]}:${n}x${t}`,
    ans: n * t
  };
}

// 10 tasks: 5 word problems, 3 multiplication examples, 2 add/sub (topped up if a pool is short)
function buildMathQs(table) {
  const multMax = [0,0, 4,5, 5, 6, 7, 8, 9,10,10][table];
  const all = buildExprPool(table);
  const multPool = all.filter(x => x.expr.includes('×'));
  const addPool  = all.filter(x => !x.expr.includes('×'));
  const words = [], seen = new Set();
  for (let tries = 0; words.length < 5 && tries < 60; tries++) {
    const w = wordProblem(table, 2 + Math.floor(Math.random() * (multMax - 1)));
    if (!seen.has(w.text)) { seen.add(w.text); words.push(w); }
  }
  const qs = [...words, ...shuffled(multPool).slice(0, 3), ...shuffled(addPool).slice(0, 2)];
  const rest = shuffled(all).filter(x => !qs.includes(x));
  while (qs.length < 10 && rest.length) qs.push(rest.shift());
  return shuffled(qs).slice(0, 10);
}
function mathWrongOpts(correct, table) {
  const offsets = [1, 2, 3, table, table + 1];
  const opts = new Set([correct]);
  let attempts = 0;
  while (opts.size < 4 && attempts < 200) {
    attempts++;
    const d = offsets[Math.floor(Math.random() * offsets.length)];
    const sign = Math.random() < 0.5 ? 1 : -1;
    const w = correct + sign * d;
    if (w > 0 && w !== correct) opts.add(w);
  }
  const arr = [...opts];
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}

function setProgress(fillId, ctrId, idx, total) {
  document.getElementById(fillId).style.width = ((idx + 1) / total * 100) + '%';
  document.getElementById(ctrId).textContent  = `${idx + 1}/${total}`;
}

/* ============================================================
   START MODE
============================================================ */
function startMode(mode) {
  curMode = mode; qIdx = 0; sessionStars = 0; sessionCorrect = 0; mixedReview = false;
  if (mode === 'flash' || mode === 'flashAll') {
    if (mode === 'flashAll') {
      const arr = [1,2,3,4,5,6,7,8,9,10];
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      srsQueue = arr.map(b => ({ t: curTable, b, requeueCount: 0 }));
    } else {
      srsQueue = buildSRSQueue(curTable);
    }
    srsQueueIdx = 0; srsBaseTotal = srsQueue.length;
    renderFlash(); showScreen('sFlash');
  } else {
    if (mode === 'math') {
      questions = buildMathQs(curTable);
      renderMath(); showScreen('sMath');
    } else {
      questions = mode === 'exam' ? buildQs(curTable) : buildWeightedQs(curTable);
      if (mode === 'choice') { renderChoice(); showScreen('sChoice'); }
      if (mode === 'typing') { renderTyping(); showScreen('sTyping'); }
      if (mode === 'exam')   { renderExam();   showScreen('sExam');   }
    }
  }
}
function restartCurrentMode() { startMode(curMode); }

function startMixedReview() {
  const queue = buildMixedQueue();
  if (!queue.length) return;
  curMode = 'flash'; qIdx = 0; sessionStars = 0; sessionCorrect = 0;
  srsQueue = queue; srsQueueIdx = 0; srsBaseTotal = queue.length;
  mixedReview = true;
  renderFlash(); showScreen('sFlash');
}
function flashBack() { if (mixedReview) goHome(); else showScreen('sMode'); }

/* ============================================================
   FLASH CARDS
============================================================ */
function renderFlash() {
  if (srsQueueIdx >= srsQueue.length) {
    const seenCards = srsBaseTotal || srsQueueIdx;
    document.getElementById('flashDoneText').textContent = mixedReview
      ? `Переглянуто ${seenCards} карток — змішане повторення`
      : `Переглянуто ${seenCards} карток — таблиця на ${curTable}`;
    ['flashDoneHint', 'flashDoneTestBtn', 'flashDoneTypeBtn'].forEach(id => {
      document.getElementById(id).style.display = mixedReview ? 'none' : '';
    });
    const back = document.getElementById('flashDoneBackBtn');
    back.textContent = mixedReview ? '🏠 На головну' : '← Назад до режимів';
    back.onclick = flashBack;
    showScreen('sFlashDone');
    return;
  }
  const { t, b } = srsQueue[srsQueueIdx];
  document.getElementById('flashQ').innerHTML = `${t} <span class="times">×</span> ${b}`;
  document.getElementById('flashAnsNum').textContent = t * b;

  const cd = getCardData(t, b);
  const srsEl = document.getElementById('flashSrsInfo');
  if (cd.interval > 0) {
    const dots = [1,2,3,4,5].map(d => `<div class="srs-dot ${d <= Math.min(cd.interval,5) ? 'ok' : ''}"></div>`).join('');
    srsEl.innerHTML = dots + `<span>наступний повтор через ${cd.interval} д.</span>`;
  } else {
    srsEl.innerHTML = '';
  }

  const flipCard = document.getElementById('flipCard');
  flipCard.style.transition = 'none';
  flipCard.classList.remove('flipped');
  flipCard.offsetHeight; // force reflow so snap applies before re-enabling
  flipCard.style.transition = '';
  document.getElementById('flashRevealBtn').style.display = '';
  document.getElementById('flashRatingRow').style.display  = 'none';
  document.getElementById('flashLabel').textContent = 'Скільки буде?';

  const total = srsBaseTotal || srsQueue.length;
  document.getElementById('flashProg').style.width = (Math.min(srsQueueIdx, total) / total * 100) + '%';
  document.getElementById('flashCtr').textContent  = `${Math.min(srsQueueIdx + 1, total)}/${total}`;

  document.getElementById('flashHintBox').style.display = 'none';
  document.getElementById('flashDots').innerHTML = dotArrayHTML(t, b);
  document.getElementById('flashHint').textContent = `💡 ${strategyHint(t, b)}`;
  flashRevealed = false;
}

function revealFlash() {
  if (flashRevealed) return;
  flashRevealed = true;
  document.getElementById('flipCard').classList.add('flipped');
  document.getElementById('flashHintBox').style.display = '';
  document.getElementById('flashRevealBtn').style.display = 'none';
  document.getElementById('flashRatingRow').style.display  = 'flex';
}

function rateCard(rating) {
  const item   = srsQueue[srsQueueIdx];
  const result = applyRating(item.t, item.b, rating);
  if (result.requeue && item.requeueCount < 3) {
    const at = Math.min(srsQueueIdx + 3, srsQueue.length);
    srsQueue.splice(at, 0, { t: item.t, b: item.b, requeueCount: item.requeueCount + 1 });
  }
  srsQueueIdx++;
  renderFlash();
}

/* ============================================================
   CHOICE
============================================================ */
function renderChoice() {
  const q = questions[qIdx];
  document.getElementById('choiceQ').innerHTML = qFmt(q) + ' = ?';
  setProgress('choiceProg', 'choiceCtr', qIdx, questions.length);
  updateStarsBadges();
  document.getElementById('choiceStrip').classList.remove('show','ok','err');
  document.getElementById('choiceNextBtn').style.display = 'none';
  const opts = wrongOpts(q);
  const grid = document.getElementById('choiceGrid');
  grid.innerHTML = '';
  opts.forEach(val => {
    const btn = document.createElement('button');
    btn.className = 'choice-opt'; btn.textContent = val;
    btn.onclick = () => answerChoice(btn, val, q.ans);
    grid.appendChild(btn);
  });
}

function answerChoice(btn, val, correct) {
  document.querySelectorAll('.choice-opt').forEach(b => { b.onclick = null; });
  const strip = document.getElementById('choiceStrip');
  if (val === correct) {
    btn.classList.add('correct');
    document.querySelectorAll('.choice-opt').forEach(b => { if (b !== btn) b.classList.add('dim'); });
    totalStars += 2; sessionStars += 2; sessionCorrect++;
    updateStarsBadges();
    strip.className = 'answer-strip show ok';
    launchMiniConfetti();
    document.getElementById('choiceStripIcon').textContent  = '🎉';
    document.getElementById('choiceStripTitle').textContent = 'Правильно!';
    document.getElementById('choiceStripSub').textContent   = '+2 зірочки';
  } else {
    btn.classList.add('wrong');
    recordMistake(questions[qIdx]);
    document.querySelectorAll('.choice-opt').forEach(b => {
      if (parseInt(b.textContent) === correct) b.classList.add('correct');
      else if (b !== btn) b.classList.add('dim');
    });
    strip.className = 'answer-strip show err';
    document.getElementById('choiceStripIcon').textContent  = '😅';
    document.getElementById('choiceStripTitle').textContent = 'Не правильно';
    document.getElementById('choiceStripSub').textContent   = `Правильна відповідь: ${correct}. ${strategyHint(questions[qIdx].a, questions[qIdx].b)}`;
  }
  document.getElementById('choiceNextBtn').style.display = 'block';
}

/* ============================================================
   TYPING
============================================================ */
function renderTyping() {
  const q = questions[qIdx];
  document.getElementById('typingQ').innerHTML = qFmt(q);
  setProgress('typingProg', 'typingCtr', qIdx, questions.length);
  updateStarsBadges();
  const inp = document.getElementById('typingInput');
  inp.value = ''; inp.className = 'typing-input'; inp.disabled = false;
  document.getElementById('typingStrip').classList.remove('show','ok','err');
  document.getElementById('typingCheckBtn').style.display = 'block';
  document.getElementById('typingNextBtn').style.display  = 'none';
  setTimeout(() => inp.focus(), 100);
}

function checkTyping() {
  const q   = questions[qIdx];
  const inp = document.getElementById('typingInput');
  if (inp.disabled) return;
  const val = parseInt(inp.value);
  if (!/^\d{1,3}$/.test(inp.value.trim())) return;
  inp.disabled = true;
  document.getElementById('typingCheckBtn').style.display = 'none';
  document.getElementById('typingNextBtn').style.display  = 'block';
  const strip = document.getElementById('typingStrip');
  if (val === q.ans) {
    inp.classList.add('correct');
    totalStars += 3; sessionStars += 3; sessionCorrect++;
    updateStarsBadges();
    strip.className = 'answer-strip show ok';
    launchMiniConfetti();
    document.getElementById('typingStripIcon').textContent  = '🌟';
    document.getElementById('typingStripTitle').textContent = 'Правильно!';
    document.getElementById('typingStripSub').textContent   = '+3 зірочки';
  } else {
    inp.classList.add('wrong'); inp.value = q.ans;
    recordMistake(q);
    strip.className = 'answer-strip show err';
    document.getElementById('typingStripIcon').textContent  = '😅';
    document.getElementById('typingStripTitle').textContent = 'Не правильно';
    document.getElementById('typingStripSub').textContent   = `Правильна відповідь: ${q.ans}. ${strategyHint(q.a, q.b)}`;
  }
}
document.getElementById('typingInput').addEventListener('keydown', e => { if (e.key === 'Enter') checkTyping(); });
document.getElementById('examInput').addEventListener('keydown', e => { if (e.key === 'Enter') checkExam(); });

/* ============================================================
   EXAM
============================================================ */
function renderExam() {
  const q = questions[qIdx];
  document.getElementById('examQ').innerHTML = qFmt(q);
  setProgress('examProg', 'examCtr', qIdx, questions.length);
  updateStarsBadges();
  const inp = document.getElementById('examInput');
  inp.value = ''; inp.className = 'typing-input'; inp.disabled = false;
  document.getElementById('examStrip').className = 'answer-strip';
  document.getElementById('examCheckBtn').style.display = 'block';
  document.getElementById('examNextBtn').style.display  = 'none';
  setTimeout(() => inp.focus(), 100);
}

function checkExam() {
  const q   = questions[qIdx];
  const inp = document.getElementById('examInput');
  if (inp.disabled) return;
  const val = parseInt(inp.value);
  if (!/^\d{1,3}$/.test(inp.value.trim())) return;
  inp.disabled = true;
  document.getElementById('examCheckBtn').style.display = 'none';
  document.getElementById('examNextBtn').style.display  = 'block';
  const strip = document.getElementById('examStrip');
  if (val === q.ans) {
    inp.classList.add('correct');
    totalStars += 3; sessionStars += 3; sessionCorrect++;
    updateStarsBadges();
    strip.className = 'answer-strip show ok';
    launchMiniConfetti();
    document.getElementById('examStripIcon').textContent  = '🌟';
    document.getElementById('examStripTitle').textContent = 'Правильно!';
    document.getElementById('examStripSub').textContent   = '+3 зірочки';
  } else {
    inp.classList.add('wrong'); inp.value = q.ans;
    recordMistake(q);
    strip.className = 'answer-strip show err';
    document.getElementById('examStripIcon').textContent  = '😅';
    document.getElementById('examStripTitle').textContent = 'Не правильно';
    document.getElementById('examStripSub').textContent   = `Правильна відповідь: ${q.ans}. ${strategyHint(q.a, q.b)}`;
  }
}

function showExamDone() {
  const score = sessionCorrect * 10;
  let emoji = '😅', level = 'Продовжуй тренуватись';
  if (score === 100)    { emoji = '🏆'; level = 'Відмінник!'; }
  else if (score >= 80) { emoji = '🥇'; level = 'Чудово!'; }
  else if (score >= 60) { emoji = '🥈'; level = 'Добре!'; }
  else if (score >= 40) { emoji = '🥉'; level = 'Непогано'; }
  else if (score >= 20) { emoji = '📚'; level = 'Треба повчити'; }
  saveExamScore(curTable, score);
  const eb = document.getElementById('examLastScore');
  if (eb) { eb.textContent = `${getExamScore(curTable)} б.`; eb.style.display = 'inline'; }
  document.getElementById('examTableTitle').textContent  = `Таблиця на ${curTable}`;
  document.getElementById('examPrizeEmoji').textContent  = emoji;
  document.getElementById('examScoreNum').textContent    = score;
  document.getElementById('examLevelText').textContent   = level;
  document.getElementById('examDetail').textContent      = `${sessionCorrect} з ${questions.length} правильних`;
  document.getElementById('examStarsEarned').textContent = `+${sessionStars}`;
  document.getElementById('examTotalStars').textContent  = totalStars;
  showScreen('sExamDone');
  if (score >= 60) launchConfetti();
}

function launchConfetti() {
  const canvas = document.getElementById('confettiCanvas');
  const ctx    = canvas.getContext('2d');
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  const colors = ['#5B3BF5','#FFB800','#3DC95B','#FF4B4B','#FF6B9D','#00D4FF','#FFA500'];
  const particles = Array.from({ length: 130 }, () => ({
    x: Math.random() * canvas.width,
    y: -10 - Math.random() * 120,
    w: 8 + Math.random() * 8,
    h: 4 + Math.random() * 6,
    color: colors[Math.floor(Math.random() * colors.length)],
    vx: (Math.random() - 0.5) * 4,
    vy: 2 + Math.random() * 4,
    rot: Math.random() * Math.PI * 2,
    vr: (Math.random() - 0.5) * 0.18,
    opacity: 1
  }));
  let start = null;
  const duration = 3500;
  function animate(ts) {
    if (!start) start = ts;
    const elapsed = ts - start;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => {
      p.x  += p.vx;
      p.y  += p.vy;
      p.rot += p.vr;
      p.vy += 0.06;
      if (elapsed > duration * 0.65) p.opacity = Math.max(0, p.opacity - 0.025);
      ctx.save();
      ctx.globalAlpha = p.opacity;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    });
    if (elapsed < duration + 500) requestAnimationFrame(animate);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  requestAnimationFrame(animate);
}

/* ============================================================
   MATH EXERCISES — RENDER & ANSWER
============================================================ */
function renderMath() {
  const q = questions[qIdx];
  const mq = document.getElementById('mathQ');
  mq.textContent = q.text || (q.expr + ' = ?');
  mq.classList.toggle('word', !!q.text);
  setProgress('mathProg', 'mathCtr', qIdx, questions.length);
  updateStarsBadges();
  document.getElementById('mathStrip').classList.remove('show','ok','err');
  document.getElementById('mathNextBtn').style.display = 'none';
  const opts = mathWrongOpts(q.ans, curTable);
  const grid = document.getElementById('mathGrid');
  grid.innerHTML = '';
  opts.forEach(val => {
    const btn = document.createElement('button');
    btn.className = 'choice-opt'; btn.textContent = val;
    btn.onclick = () => answerMath(btn, val, q.ans);
    grid.appendChild(btn);
  });
}
function answerMath(btn, val, correct) {
  document.querySelectorAll('#mathGrid .choice-opt').forEach(b => { b.onclick = null; });
  const strip = document.getElementById('mathStrip');
  if (val === correct) {
    btn.classList.add('correct');
    document.querySelectorAll('#mathGrid .choice-opt').forEach(b => { if (b !== btn) b.classList.add('dim'); });
    totalStars += 2; sessionStars += 2; sessionCorrect++;
    updateStarsBadges();
    strip.className = 'answer-strip show ok';
    launchMiniConfetti();
    document.getElementById('mathStripIcon').textContent  = '🎉';
    document.getElementById('mathStripTitle').textContent = 'Правильно!';
    document.getElementById('mathStripSub').textContent   = '+2 зірочки';
  } else {
    btn.classList.add('wrong');
    document.querySelectorAll('#mathGrid .choice-opt').forEach(b => {
      if (parseInt(b.textContent) === correct) b.classList.add('correct');
      else if (b !== btn) b.classList.add('dim');
    });
    strip.className = 'answer-strip show err';
    document.getElementById('mathStripIcon').textContent  = '😅';
    document.getElementById('mathStripTitle').textContent = 'Не правильно';
    document.getElementById('mathStripSub').textContent   = `Правильна відповідь: ${correct}`;
  }
  document.getElementById('mathNextBtn').style.display = 'block';
  saveStars();
}

/* ============================================================
   NEXT / DONE
============================================================ */
function nextQ(mode) {
  qIdx++;
  if (mode === 'exam') {
    if (qIdx >= questions.length) { showExamDone(); return; }
    renderExam();
    return;
  }
  if (qIdx >= questions.length) { showDone(); return; }
  if (mode === 'choice') renderChoice();
  if (mode === 'typing') renderTyping();
  if (mode === 'math')   renderMath();
}
function showDone() {
  const total = questions.length;
  const pct   = Math.round(sessionCorrect / total * 100);
  let emoji = '🏆', title = 'Ідеально!';
  if (pct < 100 && pct >= 70) { emoji = '🎉'; title = 'Молодець!'; }
  else if (pct < 70 && pct >= 40) { emoji = '💪'; title = 'Добре, тренуймось!'; }
  else if (pct < 40) { emoji = '📖'; title = 'Поглянь на картки ще раз'; }
  document.getElementById('doneEmoji').textContent       = emoji;
  document.getElementById('doneTitle').textContent       = title;
  document.getElementById('doneScore').textContent       = `${sessionCorrect} з ${total} правильно (${pct}%)`;
  document.getElementById('doneStarsEarned').textContent = `+${sessionStars} зірочок`;
  document.getElementById('doneTotalStars').textContent  = totalStars;
  showScreen('sDone');
}

function launchMiniConfetti() {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:50;';
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  document.body.appendChild(canvas);
  const ctx    = canvas.getContext('2d');
  const colors = ['#5B3BF5','#FFB800','#3DC95B','#FF4B4B','#FF6B9D','#00D4FF'];
  const particles = Array.from({ length: 55 }, () => ({
    x: Math.random() * canvas.width,
    y: -8 - Math.random() * 60,
    w: 7 + Math.random() * 7,
    h: 3 + Math.random() * 5,
    color: colors[Math.floor(Math.random() * colors.length)],
    vx: (Math.random() - 0.5) * 4,
    vy: 2.5 + Math.random() * 3,
    rot: Math.random() * Math.PI * 2,
    vr: (Math.random() - 0.5) * 0.2,
    opacity: 1
  }));
  let start = null;
  const duration = 1400;
  function animate(ts) {
    if (!start) start = ts;
    const elapsed = ts - start;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => {
      p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.vy += 0.07;
      if (elapsed > duration * 0.6) p.opacity = Math.max(0, p.opacity - 0.04);
      ctx.save();
      ctx.globalAlpha = p.opacity;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    });
    if (elapsed < duration + 300) requestAnimationFrame(animate);
    else canvas.remove();
  }
  requestAnimationFrame(animate);
}

/* ============================================================
   TABLE REFERENCE
============================================================ */
function buildTableRef() {
  const scroll = document.getElementById('tablerefScroll');
  const dots   = document.getElementById('tablerefDots');
  scroll.innerHTML = '';
  dots.innerHTML   = '';

  for (let n = 2; n <= 10; n++) {
    const page = document.createElement('div');
    page.className = 'tableref-page';

    let rows = '';
    for (let b = 1; b <= 10; b++) {
      rows += `<div class="tableref-row">
        <span class="tableref-expr">${n} <span class="times">×</span> ${b}</span>
        <span class="tableref-eq">=</span>
        <span class="tableref-result">${n * b}</span>
      </div>`;
    }
    page.innerHTML = `<div class="tableref-list"><div class="tableref-card">${rows}</div></div>`;
    scroll.appendChild(page);

    const dot = document.createElement('div');
    dot.className = 'tableref-dot' + (n === 2 ? ' active' : '');
    dot.onclick = () => scrollToTable(n - 2);
    dots.appendChild(dot);
  }

  scroll.addEventListener('scroll', () => {
    const idx = Math.round(scroll.scrollLeft / scroll.clientWidth);
    document.querySelectorAll('.tableref-dot').forEach((d, i) => {
      d.classList.toggle('active', i === idx);
    });
    const title = document.getElementById('tablerefTitle');
    if (title) title.textContent = `× ${idx + 2}`;
  }, { passive: true });
}

function scrollToTable(idx) {
  const scroll = document.getElementById('tablerefScroll');
  scroll.scrollTo({ left: idx * scroll.clientWidth, behavior: 'smooth' });
}

function openTableRef(startN = 2) {
  showScreen('sTableRef');
  const title = document.getElementById('tablerefTitle');
  if (title) title.textContent = `× ${startN}`;
  requestAnimationFrame(() => {
    const scroll = document.getElementById('tablerefScroll');
    scroll.scrollLeft = (startN - 2) * scroll.clientWidth;
    document.querySelectorAll('.tableref-dot').forEach((d, i) => {
      d.classList.toggle('active', i === startN - 2);
    });
  });
}

/* ============================================================
   INIT
============================================================ */
buildTableRef();
refreshTableBadges();
refreshHomeDashboard();
