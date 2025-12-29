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

  // ====== Game params ======
  const GAME_TIME = 20.0;
  const SPAWN_MS = 520;

  // 全色同じ速度、時間経過で加速
  const BASE_FALL_SPEED = 120; // px/sec
  const SPEED_RAMP = 2.2;

  const MAX_DROPS = 18;

  // 見た目サイズ（CSS .drop img と合わせる）
  const VISUAL_SIZE = 110;

  // 当たり判定 ちょい甘め
  const HIT_SCALE = 1.18;

  // スコア（確定）
  const SCORE = {
    green: +10,
    yellow: +30,
    red: +50,
    blue: -10,
    purple: -30,
  };

  // 画像
  const IMG = {
    green: "images/slime_green.png",
    yellow: "images/slime_yellow.png",
    red: "images/slime_red.png",
    blue: "images/slime_blue.png",
    purple: "images/slime_purple.png",
  };

  // 出現率（合計1.0）
  const SPAWN_RATE = [
    { kind: "green", p: 0.40 },
    { kind: "yellow", p: 0.22 },
    { kind: "red", p: 0.12 },
    { kind: "blue", p: 0.16 },
    { kind: "purple", p: 0.10 },
  ];

  // ====== State ======
  let running = false;
  let score = 0;
  let streak = 0;
  let bestStreak = 0;
  let timeLeft = GAME_TIME;

  let timerId = null;
  let spawnId = null;
  let rafId = null;
  let lastFrame = 0;

  /** drops: {el, x, y, vy, kind, hitSize} */
  const drops = [];

  // ====== Audio（SE + BGM） ======
  let audioCtx = null;

  function ensureAudio() {
    if (!UI.soundToggle.checked) return;
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
  }

  function tone({ freq = 660, dur = 0.06, type = "sine", gain = 0.08, slide = 0 } = {}) {
    if (!UI.soundToggle.checked) return;
    ensureAudio();
    if (!audioCtx) return;

    const t0 = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide !== 0) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, freq * (1 + slide)), t0 + dur);
    }

    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    osc.connect(g);
    g.connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + dur);
  }

  // ====== SE（前のまま：ぷにっ / ぼよん） ======
  function sePuni(mode = "base") {
    if (mode === "red") {
      tone({ freq: 820, dur: 0.055, type: "triangle", gain: 0.10, slide: 0.16 });
      setTimeout(() => tone({ freq: 1180, dur: 0.040, type: "sine", gain: 0.06, slide: 0.10 }), 12);
      return;
    }
    if (mode === "yellow") {
      tone({ freq: 760, dur: 0.050, type: "triangle", gain: 0.09, slide: 0.13 });
      setTimeout(() => tone({ freq: 1080, dur: 0.038, type: "sine", gain: 0.055, slide: 0.10 }), 12);
      return;
    }
    tone({ freq: 720, dur: 0.048, type: "triangle", gain: 0.085, slide: 0.10 });
    setTimeout(() => tone({ freq: 980, dur: 0.035, type: "sine", gain: 0.05, slide: 0.08 }), 12);
  }

  function seBoyon(mode = "blue") {
    if (mode === "purple") {
      tone({ freq: 210, dur: 0.11, type: "sine", gain: 0.10, slide: -0.18 });
      setTimeout(() => tone({ freq: 155, dur: 0.12, type: "sine", gain: 0.07, slide: -0.10 }), 55);
      return;
    }
    tone({ freq: 260, dur: 0.09, type: "sine", gain: 0.09, slide: -0.16 });
    setTimeout(() => tone({ freq: 190, dur: 0.10, type: "sine", gain: 0.06, slide: -0.10 }), 45);
  }

  function seMiss() {
    tone({ freq: 320, dur: 0.06, type: "sine", gain: 0.05, slide: -0.25 });
  }

  function seEnd() {
    tone({ freq: 420, dur: 0.12, type: "sine", gain: 0.06, slide: -0.35 });
    setTimeout(() => tone({ freq: 260, dur: 0.14, type: "sine", gain: 0.06, slide: -0.25 }), 90);
  }

  // ====== BGM（ピコピコ寄り） ======
  let bgmOn = false;
  let bgmTimer = null;

  // Cメジャー系：明るいピコピコ
  const BGM_NOTES = [523.25, 659.25, 783.99, 659.25]; // C5 E5 G5 E5

  function bgmBeep(freq) {
    if (!UI.soundToggle.checked) return;
    ensureAudio();
    if (!audioCtx) return;

    const t0 = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();

    osc.type = "square"; // ピコピコ
    osc.frequency.setValueAtTime(freq, t0);

    // 短いプチ音
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.05, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);

    osc.connect(g);
    g.connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.20);
  }

  function startBGM() {
    if (!UI.soundToggle.checked) return;
    ensureAudio();
    if (!audioCtx) return;
    if (bgmOn) return;

    bgmOn = true;
    let step = 0;

    const loop = () => {
      if (!bgmOn) return;
      bgmBeep(BGM_NOTES[step % BGM_NOTES.length]);
      step++;
      bgmTimer = setTimeout(loop, 220); // テンポ
    };

    loop();
  }

  function stopBGM() {
    bgmOn = false;
    if (bgmTimer) {
      clearTimeout(bgmTimer);
      bgmTimer = null;
    }
  }

  // 効果音トグルOFFでBGMも止める
  UI.soundToggle.addEventListener("change", () => {
    if (!UI.soundToggle.checked) stopBGM();
  });

  // ====== FX（弾ける） ======
  // CSSで .spark のアニメがある前提（前のstyle.cssに入ってるやつ）
  function burstEffect(x, y, n = 10, color = "rgba(255,122,182,.9)") {
    for (let i = 0; i < n; i++) {
      const s = document.createElement("div");
      s.className = "spark";
      s.style.left = x + "px";
      s.style.top = y + "px";
      s.style.background = color;
      s.style.boxShadow = `0 0 18px ${color}`;

      const ang = Math.random() * Math.PI * 2;
      const dist = 22 + Math.random() * 34;
      s.style.setProperty("--dx", Math.cos(ang) * dist + "px");
      s.style.setProperty("--dy", Math.sin(ang) * dist + "px");

      UI.arena.appendChild(s);
      s.addEventListener("animationend", () => s.remove(), { once: true });
    }
  }

  function spawnFloat(text, x, y, color) {
    const el = document.createElement("div");
    el.className = "float";
    el.textContent = text;
    el.style.left = x + "px";
    el.style.top = y + "px";
    el.style.fontSize = "18px";
    el.style.color = color || "rgba(255, 122, 182, .95)";
    UI.arena.appendChild(el);
    el.addEventListener("animationend", () => el.remove(), { once: true });
  }

  // ====== UI ======
  function setUI() {
    UI.score.textContent = score;
    UI.streak.textContent = streak;
    UI.time.textContent = timeLeft.toFixed(1);
  }

  function showOverlay(show) {
    UI.overlay.style.display = show ? "flex" : "none";
  }

  // ====== Helpers ======
  function rand(min, max) {
    return Math.random() * (max - min) + min;
  }

  function pickKind() {
    const r = Math.random();
    let acc = 0;
    for (const it of SPAWN_RATE) {
      acc += it.p;
      if (r <= acc) return it.kind;
    }
    return SPAWN_RATE[SPAWN_RATE.length - 1].kind;
  }

  // ====== Drop spawn ======
  function spawnDrop() {
    if (!running) return;
    if (drops.length >= MAX_DROPS) return;

    const w = UI.arena.clientWidth;
    const kind = pickKind();

    const hitSize = Math.round(VISUAL_SIZE * HIT_SCALE);

    const el = document.createElement("div");
    el.className = `drop slime ${kind}`;
    el.style.width = hitSize + "px";
    el.style.height = hitSize + "px";

    const img = document.createElement("img");
    img.src = IMG[kind];
    img.alt = kind;
    img.draggable = false;
    el.appendChild(img);

    UI.arena.appendChild(el);

    const x = rand(8, w - hitSize - 8);
    const y = -hitSize - rand(0, 80);

    // 時間経過で加速（全色共通）
    const t = 1 - timeLeft / GAME_TIME; // 0→1
    const speedMul = 1 + t * SPEED_RAMP;
    const vy = BASE_FALL_SPEED * speedMul;

    const drop = { el, x, y, vy, kind, hitSize };
    el.style.left = x + "px";
    el.style.top = y + "px";

    el.addEventListener(
      "pointerdown",
      (e) => {
        e.preventDefault();
        ensureAudio();
        if (!running) return;

        const rect = UI.arena.getBoundingClientRect();
        const tx = e.clientX - rect.left;
        const ty = e.clientY - rect.top;

        const delta = SCORE[kind];

        if (delta > 0) {
          streak++;
          bestStreak = Math.max(bestStreak, streak);

          if (kind === "red") sePuni("red");
          else if (kind === "yellow") sePuni("yellow");
          else sePuni("base");

          score += delta;

          // 色別に“弾け方”ちょい変える
          const c =
            kind === "red"
              ? "rgba(255,107,138,.95)"
              : kind === "yellow"
              ? "rgba(255,210,90,.95)"
              : "rgba(120,220,150,.95)";
          burstEffect(tx, ty, kind === "red" ? 14 : 11, c);
          spawnFloat(`+${delta}`, tx, ty, c);

          if (navigator.vibrate) navigator.vibrate(8);
        } else {
          streak = 0;

          if (kind === "purple") seBoyon("purple");
          else seBoyon("blue");

          score = Math.max(0, score + delta);

          const c = kind === "purple" ? "rgba(140,110,220,.95)" : "rgba(120,170,255,.95)";
          burstEffect(tx, ty, 10, c);
          spawnFloat(`${delta}`, tx, ty, c);

          if (navigator.vibrate) navigator.vibrate(14);
        }

        setUI();
        removeDrop(drop);
      },
      { passive: false }
    );

    drops.push(drop);
  }

  function removeDrop(drop) {
    const idx = drops.indexOf(drop);
    if (idx >= 0) drops.splice(idx, 1);
    drop.el.remove();
  }

  // ====== Game loop ======
  function loop(ts) {
    if (!running) return;
    if (!lastFrame) lastFrame = ts;
    const dt = (ts - lastFrame) / 1000;
    lastFrame = ts;

    const arenaH = UI.arena.clientHeight;

    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      d.y += d.vy * dt;
      d.el.style.top = d.y + "px";

      // 下まで落ちた：ミス（プラスのみ）
      if (d.y > arenaH + 80) {
        if (SCORE[d.kind] > 0) {
          streak = 0;
          seMiss();
          setUI();
        }
        removeDrop(d);
      }
    }

    rafId = requestAnimationFrame(loop);
  }

  // ====== Timer / start / reset ======
  function stopAll() {
    if (timerId) clearInterval(timerId);
    if (spawnId) clearInterval(spawnId);
    if (rafId) cancelAnimationFrame(rafId);
    timerId = spawnId = rafId = null;
    lastFrame = 0;
  }

  function clearDrops() {
    while (drops.length) removeDrop(drops[0]);
  }

  function resetGame() {
    stopAll();
    running = false;
    score = 0;
    streak = 0;
    bestStreak = 0;
    timeLeft = GAME_TIME;
    clearDrops();
    setUI();
    showOverlay(false);
    UI.start.textContent = "START";
    stopBGM();
  }

  function finishGame() {
    if (!running) return;
    running = false;
    stopAll();
    stopBGM();
    seEnd();

    UI.resultScore.textContent = score;
    UI.bestStreak.textContent = bestStreak;
    showOverlay(true);
    UI.start.textContent = "START";
  }

  function startGame() {
    if (running) return;

    // ユーザー操作の中で AudioContext を起こす
    ensureAudio();

    resetGame();
    running = true;
    UI.start.textContent = "PLAYING…";
    showOverlay(false);

    startBGM();

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
  UI.again.addEventListener("click", () => {
    showOverlay(false);
    startGame();
  });
  UI.close.addEventListener("click", () => showOverlay(false));

  // 初期表示
  setUI();
})();
