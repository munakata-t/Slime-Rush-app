(() => {
  const UI = {
    score: document.getElementById("score"),
    streak: document.getElementById("streak"),
    time: document.getElementById("time"),
    start: document.getElementById("startBtn"),
    reset: document.getElementById("resetBtn"),
    arena: document.getElementById("arena"),
    overlay: document.getElementById("overlay"),
    resultScore: document.getElementById("resultScore"),
    bestStreak: document.getElementById("bestStreak"),
    again: document.getElementById("againBtn"),
    close: document.getElementById("closeBtn"),
    soundToggle: document.getElementById("soundToggle"),
  };

  // ====== Game params（微調整ポイント） ======
  const GAME_TIME = 20.0;
  const SPAWN_MS = 520;          // 落ちる頻度（小さいほど忙しい）
  const BASE_FALL_SPEED = 120;   // px / sec（基本速度）
  const SPEED_RAMP = 2.2;        // 後半の加速
  const MAX_DROPS = 18;          // 最大同時出現数（重さ対策）

  // ====== State ======
  let running = false;
  let score = 0;
  let streak = 0;
  let bestStreak = 0;
  let timeLeft = GAME_TIME;

  let timerId = null;
  let spawnId = null;
  let rafId = null;

  /** drops: {el, x, y, vy, kind, size} */
  const drops = [];

  // ====== Audio（音源ファイル不要） ======
  let audioCtx = null;
  function ensureAudio() {
    if (!UI.soundToggle.checked) return;
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
  }
  function beep({freq=660, dur=0.05, type="sine", gain=0.08, slide=0} = {}) {
    if (!UI.soundToggle.checked) return;
    ensureAudio();
    if (!audioCtx) return;

    const t0 = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide !== 0) osc.frequency.exponentialRampToValueAtTime(freq * (1 + slide), t0 + dur);

    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    osc.connect(g);
    g.connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + dur);
  }
  function goodSound(isCrit=false){
    if (isCrit){
      beep({freq: 900, dur: 0.06, type:"triangle", gain:0.11, slide:0.35});
      setTimeout(()=>beep({freq: 1400, dur: 0.05, type:"sine", gain:0.09, slide:0.25}), 12);
    } else {
      beep({freq: 700, dur: 0.045, type:"triangle", gain:0.08, slide:0.12});
      setTimeout(()=>beep({freq: 980, dur: 0.035, type:"sine", gain:0.04, slide:0.15}), 10);
    }
  }
  function badSound(){
    beep({freq: 220, dur: 0.08, type:"sine", gain:0.08, slide:-0.15});
  }
  function missSound(){
    beep({freq: 320, dur: 0.06, type:"sine", gain:0.05, slide:-0.25});
  }
  function endSound(){
    beep({freq: 420, dur: 0.12, type:"sine", gain:0.06, slide:-0.35});
    setTimeout(()=>beep({freq: 260, dur: 0.14, type:"sine", gain:0.06, slide:-0.25}), 90);
  }

  // ====== FX ======
  function spawnFloat(text, x, y, color){
    const el = document.createElement("div");
    el.className = "float";
    el.textContent = text;
    el.style.left = x + "px";
    el.style.top = y + "px";
    el.style.fontSize = "18px";
    el.style.color = color || "rgba(255, 122, 182, .95)";
    UI.arena.appendChild(el);
    el.addEventListener("animationend", () => el.remove(), {once:true});
  }
  function spawnSparks(x, y, n=8, color="rgba(255, 122, 182, .9)"){
    for (let i=0;i<n;i++){
      const s = document.createElement("div");
      s.className = "spark";
      s.style.left = x + "px";
      s.style.top = y + "px";
      s.style.background = color;
      s.style.boxShadow = `0 0 18px ${color}`;
      const ang = Math.random()*Math.PI*2;
      const dist = 22 + Math.random()*34;
      s.style.setProperty("--dx", (Math.cos(ang)*dist) + "px");
      s.style.setProperty("--dy", (Math.sin(ang)*dist) + "px");
      UI.arena.appendChild(s);
      s.addEventListener("animationend", () => s.remove(), {once:true});
    }
  }

  // ====== UI ======
  function setUI(){
    UI.score.textContent = score;
    UI.streak.textContent = streak;
    UI.time.textContent = timeLeft.toFixed(1);
  }
  function showOverlay(show){
    UI.overlay.style.display = show ? "flex" : "none";
  }

  // ====== Drop spawn ======
  function rand(min, max){ return Math.random()*(max-min)+min; }

  function spawnDrop(){
    if (!running) return;
    if (drops.length >= MAX_DROPS) return;

    const arenaRect = UI.arena.getBoundingClientRect();
    const w = arenaRect.width;

    // 種類：good / crit / bad
    const r = Math.random();
    let kind = "good";
    if (r < 0.10) kind = "bad";      // 10% 減点
    else if (r < 0.20) kind = "crit"; // 10% クリティカル

    const el = document.createElement("div");
    el.className = `drop ${kind}`;
    el.textContent = kind === "bad" ? "💣" : (kind === "crit" ? "🌟" : "🍬");
    UI.arena.appendChild(el);

    const size = 56;
    const x = rand(8, w - size - 8);
    const y = -size - rand(0, 80);

    // 時間が減るほど速く（後半ドキドキ）
    const t = 1 - (timeLeft / GAME_TIME); // 0→1
    const speedMul = 1 + t * SPEED_RAMP;
    const vy = rand(BASE_FALL_SPEED*0.85, BASE_FALL_SPEED*1.2) * speedMul;

    const drop = { el, x, y, vy, kind, size };
    el.style.left = x + "px";
    el.style.top = y + "px";

    // タップ処理
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      ensureAudio();
      if (!running) return;

      const rect = UI.arena.getBoundingClientRect();
      const tx = (e.clientX - rect.left);
      const ty = (e.clientY - rect.top);

      if (kind === "bad"){
        score = Math.max(0, score - 25);
        streak = 0;
        badSound();
        spawnSparks(tx, ty, 10, "rgba(255,107,138,.9)");
        spawnFloat("-25", tx, ty, "rgba(255,107,138,.95)");
        if (navigator.vibrate) navigator.vibrate(18);
      } else if (kind === "crit"){
        const add = 30 + Math.min(20, Math.floor(streak/3));
        score += add;
        streak++;
        bestStreak = Math.max(bestStreak, streak);
        goodSound(true);
        spawnSparks(tx, ty, 14, "rgba(125,215,255,.9)");
        spawnFloat(`+${add} CRIT!`, tx, ty, "rgba(18,142,200,.95)");
        if (navigator.vibrate) navigator.vibrate(12);
      } else {
        const add = 10 + Math.min(15, Math.floor(streak/3));
        score += add;
        streak++;
        bestStreak = Math.max(bestStreak, streak);
        goodSound(false);
        spawnSparks(tx, ty, 8, "rgba(255,122,182,.9)");
        spawnFloat(`+${add}`, tx, ty, "rgba(255,79,154,.95)");
        if (navigator.vibrate) navigator.vibrate(7);
      }

      setUI();
      removeDrop(drop);
    }, { passive:false });

    drops.push(drop);
  }

  function removeDrop(drop){
    const idx = drops.indexOf(drop);
    if (idx >= 0) drops.splice(idx, 1);
    drop.el.remove();
  }

  // ====== Game loop ======
  let lastFrame = 0;
  function loop(ts){
    if (!running) return;
    if (!lastFrame) lastFrame = ts;
    const dt = (ts - lastFrame) / 1000;
    lastFrame = ts;

    const arenaH = UI.arena.clientHeight;

    for (let i = drops.length - 1; i >= 0; i--){
      const d = drops[i];
      d.y += d.vy * dt;
      d.el.style.top = d.y + "px";

      // 下まで落ちた：ミス扱い（good/critだけ）
      if (d.y > arenaH + 80){
        if (d.kind !== "bad"){
          streak = 0;
          missSound();
          setUI();
        }
        removeDrop(d);
      }
    }

    rafId = requestAnimationFrame(loop);
  }

  // ====== Timer / start / reset ======
  function stopAll(){
    if (timerId) clearInterval(timerId);
    if (spawnId) clearInterval(spawnId);
    if (rafId) cancelAnimationFrame(rafId);
    timerId = spawnId = rafId = null;
    lastFrame = 0;
  }

  function clearDrops(){
    while (drops.length) removeDrop(drops[0]);
  }

  function resetGame(){
    stopAll();
    running = false;
    score = 0; streak = 0; bestStreak = 0;
    timeLeft = GAME_TIME;
    clearDrops();
    setUI();
    showOverlay(false);
    UI.start.textContent = "START";
  }

  function finishGame(){
    if (!running) return;
    running = false;
    stopAll();
    endSound();
    UI.resultScore.textContent = score;
    UI.bestStreak.textContent = bestStreak;
    showOverlay(true);
    UI.start.textContent = "START";
  }

  function startGame(){
    if (running) return;
    ensureAudio();

    // 初期化してから開始
    resetGame();
    running = true;
    UI.start.textContent = "PLAYING…";
    showOverlay(false);

    timerId = setInterval(() => {
      timeLeft = Math.max(0, timeLeft - 0.1);
      UI.time.textContent = timeLeft.toFixed(1);
      if (timeLeft <= 0) finishGame();
    }, 100);

    spawnId = setInterval(spawnDrop, SPAWN_MS);
    rafId = requestAnimationFrame(loop);
  }

  // ====== Events ======
  UI.start.addEventListener("click", startGame);
  UI.reset.addEventListener("click", resetGame);
  UI.again.addEventListener("click", () => { showOverlay(false); startGame(); });
  UI.close.addEventListener("click", () => showOverlay(false));

  // 初期表示
  setUI();
})();
