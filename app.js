/* ============================================================
   STATE
============================================================ */
const STARS_KEY = 'mult_stars_v1';
function loadStars() { return parseInt(localStorage.getItem(STARS_KEY) || '0'); }
function saveStars() { localStorage.setItem(STARS_KEY, totalStars); }

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

/* ============================================================
   SRS  (localStorage)
============================================================ */
const SRS_KEY = 'mult_srs_v1';
function today() { return new Date().toISOString().slice(0, 10); }
function addDays(d, n) { const dt = new Date(d); dt.setDate(dt.getDate() + n); return dt.toISOString().slice(0, 10); }
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

function applyRating(table, b, rating) {
  const cd = getCardData(table, b);
  let { interval, ease, lapses } = cd;
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
  let queue = [...due.map(x => x.b), ...fresh];
  if (queue.length === 0) queue = [...upcoming];
  return queue.map(b => ({ b, requeueCount: 0 }));
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
function wrongOpts(correct) {
  const pool = new Set([correct]);
  while (pool.size < 4) pool.add((Math.floor(Math.random() * 10) + 1) * (Math.floor(Math.random() * 10) + 1));
  const arr = [...pool];
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}
function qFmt(q) { return `${q.a} <span class="times">×</span> ${q.b}`; }
function setProgress(fillId, ctrId, idx, total) {
  document.getElementById(fillId).style.width = ((idx + 1) / total * 100) + '%';
  document.getElementById(ctrId).textContent  = `${idx + 1}/${total}`;
}

/* ============================================================
   START MODE
============================================================ */
function startMode(mode) {
  curMode = mode; qIdx = 0; sessionStars = 0; sessionCorrect = 0;
  if (mode === 'flash') {
    srsQueue = buildSRSQueue(curTable); srsQueueIdx = 0;
    renderFlash(); showScreen('sFlash');
  } else {
    questions = buildQs(curTable);
    if (mode === 'choice') { renderChoice(); showScreen('sChoice'); }
    if (mode === 'typing') { renderTyping(); showScreen('sTyping'); }
  }
}
function restartCurrentMode() { startMode(curMode); }

/* ============================================================
   FLASH CARDS
============================================================ */
function renderFlash() {
  if (srsQueueIdx >= srsQueue.length) {
    document.getElementById('flashDoneText').textContent =
      `Переглянуто ${srsQueueIdx} карток — таблиця на ${curTable}`;
    showScreen('sFlashDone');
    return;
  }
  const { b } = srsQueue[srsQueueIdx];
  document.getElementById('flashQ').innerHTML = `${curTable} <span class="times">×</span> ${b}`;
  document.getElementById('flashAnsNum').textContent = curTable * b;

  const cd = getCardData(curTable, b);
  const srsEl = document.getElementById('flashSrsInfo');
  if (cd.interval > 0) {
    const dots = [1,2,3,4,5].map(d => `<div class="srs-dot ${d <= Math.min(cd.interval,5) ? 'ok' : ''}"></div>`).join('');
    srsEl.innerHTML = dots + `<span>наступний повтор через ${cd.interval} д.</span>`;
  } else {
    srsEl.innerHTML = '';
  }

  document.getElementById('flashAnsCard').classList.remove('visible');
  document.getElementById('flashRevealBtn').style.display = '';
  document.getElementById('flashRatingRow').style.display  = 'none';
  document.getElementById('flashLabel').textContent = 'Скільки буде?';

  const total = srsQueue.length;
  document.getElementById('flashProg').style.width = (srsQueueIdx / total * 100) + '%';
  document.getElementById('flashCtr').textContent  = `${srsQueueIdx + 1}/${total}`;
  flashRevealed = false;
}

function revealFlash() {
  if (flashRevealed) return;
  flashRevealed = true;
  document.getElementById('flashAnsCard').classList.add('visible');
  document.getElementById('flashRevealBtn').style.display = 'none';
  document.getElementById('flashRatingRow').style.display  = 'flex';
  document.getElementById('flashLabel').textContent = 'Як знав?';
}

function rateCard(rating) {
  const item   = srsQueue[srsQueueIdx];
  const result = applyRating(curTable, item.b, rating);
  if (result.requeue && item.requeueCount < 3) {
    const at = Math.min(srsQueueIdx + 3, srsQueue.length);
    srsQueue.splice(at, 0, { b: item.b, requeueCount: item.requeueCount + 1 });
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
  const opts = wrongOpts(q.ans);
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
    document.getElementById('choiceStripIcon').textContent  = '🎉';
    document.getElementById('choiceStripTitle').textContent = 'Правильно!';
    document.getElementById('choiceStripSub').textContent   = '+2 зірочки';
  } else {
    btn.classList.add('wrong');
    document.querySelectorAll('.choice-opt').forEach(b => {
      if (parseInt(b.textContent) === correct) b.classList.add('correct');
      else if (b !== btn) b.classList.add('dim');
    });
    strip.className = 'answer-strip show err';
    document.getElementById('choiceStripIcon').textContent  = '😅';
    document.getElementById('choiceStripTitle').textContent = 'Не правильно';
    document.getElementById('choiceStripSub').textContent   = `Правильна відповідь: ${correct}`;
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
  const val = parseInt(inp.value);
  if (isNaN(val) || inp.value.trim() === '') return;
  inp.disabled = true;
  document.getElementById('typingCheckBtn').style.display = 'none';
  document.getElementById('typingNextBtn').style.display  = 'block';
  const strip = document.getElementById('typingStrip');
  if (val === q.ans) {
    inp.classList.add('correct');
    totalStars += 3; sessionStars += 3; sessionCorrect++;
    updateStarsBadges();
    strip.className = 'answer-strip show ok';
    document.getElementById('typingStripIcon').textContent  = '🌟';
    document.getElementById('typingStripTitle').textContent = 'Правильно!';
    document.getElementById('typingStripSub').textContent   = '+3 зірочки';
  } else {
    inp.classList.add('wrong'); inp.value = q.ans;
    strip.className = 'answer-strip show err';
    document.getElementById('typingStripIcon').textContent  = '😅';
    document.getElementById('typingStripTitle').textContent = 'Не правильно';
    document.getElementById('typingStripSub').textContent   = `Правильна відповідь: ${q.ans}`;
  }
}
document.getElementById('typingInput').addEventListener('keydown', e => { if (e.key === 'Enter') checkTyping(); });

/* ============================================================
   NEXT / DONE
============================================================ */
function nextQ(mode) {
  qIdx++;
  if (qIdx >= questions.length) { showDone(); return; }
  if (mode === 'choice') renderChoice();
  if (mode === 'typing') renderTyping();
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

/* ============================================================
   INIT
============================================================ */
refreshTableBadges();
refreshHomeDashboard();
