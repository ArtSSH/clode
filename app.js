/* ============================================================
   STATE
============================================================ */
const STARS_KEY = 'mult_stars_v1';
function loadStars() { return parseInt(localStorage.getItem(STARS_KEY) || '0'); }
function saveStars() { localStorage.setItem(STARS_KEY, totalStars); }

const EXAM_SCORES_KEY = 'mult_exam_scores_v1';
function loadExamScores() { try { return JSON.parse(localStorage.getItem(EXAM_SCORES_KEY) || '{}'); } catch { return {}; } }
function saveExamScore(table, score) { const d = loadExamScores(); d[table] = score; localStorage.setItem(EXAM_SCORES_KEY, JSON.stringify(d)); }
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
  document.getElementById('examStars').textContent    = totalStars;
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
  for (let t = 2; t <= 10; t++) {
    const s = getExamScore(t);
    if (s !== null && s >= 80) mastered++;
  }
  document.getElementById('statMastered').textContent = mastered;
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
  if (mode === 'flash' || mode === 'flashAll') {
    if (mode === 'flashAll') {
      const arr = [1,2,3,4,5,6,7,8,9,10];
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      srsQueue = arr.map(b => ({ b, requeueCount: 0 }));
    } else {
      srsQueue = buildSRSQueue(curTable);
    }
    srsQueueIdx = 0;
    renderFlash(); showScreen('sFlash');
  } else {
    questions = buildQs(curTable);
    if (mode === 'choice') { renderChoice(); showScreen('sChoice'); }
    if (mode === 'typing') { renderTyping(); showScreen('sTyping'); }
    if (mode === 'exam')   { renderExam();   showScreen('sExam');   }
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

  document.getElementById('flipCard').classList.remove('flipped');
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
  document.getElementById('flipCard').classList.add('flipped');
  document.getElementById('flashRevealBtn').style.display = 'none';
  document.getElementById('flashRatingRow').style.display  = 'flex';
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
    launchMiniConfetti();
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
    launchMiniConfetti();
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
  const val = parseInt(inp.value);
  if (isNaN(val) || inp.value.trim() === '') return;
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
    strip.className = 'answer-strip show err';
    document.getElementById('examStripIcon').textContent  = '😅';
    document.getElementById('examStripTitle').textContent = 'Не правильно';
    document.getElementById('examStripSub').textContent   = `Правильна відповідь: ${q.ans}`;
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
  if (eb) { eb.textContent = `${score} б.`; eb.style.display = 'inline'; }
  document.getElementById('examTableTitle').textContent  = `Таблиця множення на ${curTable}`;
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
