/* ==========================================================================
   ROLLING BITES — sparkle-trail.js
   Premium cursor "sparkle dust" effect. Vanilla JS, no dependencies.

   - Tiny white glowing particles (2–6px) spawn slightly behind / below the
     pointer while the mouse moves, drift down with a little sideways wobble
     and fade out in 500–1000ms. Occasionally a small 4-point star appears.
   - One fixed <canvas>, pre-rendered sprites, a hard particle cap and a
     render loop that only runs while particles are alive → negligible cost.
   - Spawning happens inside the pointermove handler and is interpolated along
     the mouse path, so the trail follows fast movement with no gaps or lag.
   - Nothing is drawn when the mouse is still (no permanent trail).
   - Desktop / mouse only: disabled on touch & coarse pointers, and when the
     user prefers reduced motion.
   ========================================================================== */
(function () {
  "use strict";

  var win = window, doc = document;
  if (win.__rbSparkleTrail) return;
  win.__rbSparkleTrail = true;

  /* ---- Only run for real mouse devices, and respect reduced motion ---- */
  var mqFine = win.matchMedia("(hover: hover) and (pointer: fine)");
  var mqReduce = win.matchMedia("(prefers-reduced-motion: reduce)");
  if (!mqFine.matches || mqReduce.matches) return;

  /* ---- Tunables ---- */
  var MAX_PARTICLES = 70;      // hard cap (pool size)
  var SPAWN_EVERY = 11;        // px of pointer travel per sparkle
  var MAX_PER_EVENT = 4;       // never burst more than this per mouse event
  var MIN_SIZE = 2, MAX_SIZE = 6;
  var MIN_LIFE = 500, MAX_LIFE = 1000; // ms
  var STAR_CHANCE = 0.16;      // share of sparkles drawn as tiny stars
  var GRAVITY = 70;            // px / s²  (gentle downward acceleration)
  var TELEPORT = 220;          // px jump treated as re-entry, not a stroke

  /* ---- Canvas (first child of <body> so positioned page layers stack above it) ---- */
  var canvas = doc.createElement("canvas");
  canvas.className = "rb-sparkle-canvas";
  canvas.setAttribute("aria-hidden", "true");
  var ctx = canvas.getContext("2d");
  if (!ctx) return;

  var W = 0, H = 0, DPR = 1;
  function resize() {
    DPR = Math.min(win.devicePixelRatio || 1, 2);
    W = doc.documentElement.clientWidth || win.innerWidth;
    H = doc.documentElement.clientHeight || win.innerHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  /* ---- Pre-rendered sprites (drawImage is far cheaper than live blur) ---- */
  var SPR = 64, C = SPR / 2;

  function makeGlowSprite() {
    var c = doc.createElement("canvas");
    c.width = c.height = SPR;
    var g = c.getContext("2d");
    // faint warm halo so the sparkle still reads on light/cream sections
    var halo = g.createRadialGradient(C, C, 0, C, C, C);
    halo.addColorStop(0.22, "rgba(255,176,70,0.16)");
    halo.addColorStop(1, "rgba(255,176,70,0)");
    g.fillStyle = halo;
    g.fillRect(0, 0, SPR, SPR);
    // soft white glow + solid white core
    var glow = g.createRadialGradient(C, C, 0, C, C, C);
    glow.addColorStop(0, "rgba(255,255,255,1)");
    glow.addColorStop(0.3, "rgba(255,255,255,1)");
    glow.addColorStop(0.38, "rgba(255,255,255,0.75)");
    glow.addColorStop(0.62, "rgba(255,255,255,0.26)");
    glow.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = glow;
    g.fillRect(0, 0, SPR, SPR);
    return c;
  }

  function makeStarSprite() {
    var c = doc.createElement("canvas");
    c.width = c.height = SPR;
    var g = c.getContext("2d");
    var halo = g.createRadialGradient(C, C, 0, C, C, C);
    halo.addColorStop(0.1, "rgba(255,176,70,0.16)");
    halo.addColorStop(1, "rgba(255,176,70,0)");
    g.fillStyle = halo;
    g.fillRect(0, 0, SPR, SPR);
    var soft = g.createRadialGradient(C, C, 0, C, C, C * 0.7);
    soft.addColorStop(0, "rgba(255,255,255,0.75)");
    soft.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = soft;
    g.fillRect(0, 0, SPR, SPR);
    // 4-point star
    var R = 27, k = 3.2;
    g.shadowColor = "rgba(255,255,255,0.95)";
    g.shadowBlur = 7;
    g.fillStyle = "#fff";
    g.beginPath();
    g.moveTo(C, C - R);
    g.quadraticCurveTo(C + k, C - k, C + R, C);
    g.quadraticCurveTo(C + k, C + k, C, C + R);
    g.quadraticCurveTo(C - k, C + k, C - R, C);
    g.quadraticCurveTo(C - k, C - k, C, C - R);
    g.closePath();
    g.fill();
    return c;
  }

  var glowSprite = makeGlowSprite();
  var starSprite = makeStarSprite();

  /* ---- Particle pool (allocated once, reused) ---- */
  var pool = [];
  for (var i = 0; i < MAX_PARTICLES; i++) {
    pool.push({ on: false, star: false, x: 0, y: 0, vx: 0, vy: 0, size: 0, born: 0, life: 0, a: 0, ph: 0 });
  }
  var cursorIdx = 0;

  function rand(a, b) { return a + Math.random() * (b - a); }

  function spawn(x, y, now) {
    // find a free slot; if the pool is full, recycle the oldest-round-robin slot
    var p = null;
    for (var n = 0; n < MAX_PARTICLES; n++) {
      var q = pool[(cursorIdx + n) % MAX_PARTICLES];
      if (!q.on) { p = q; cursorIdx = (cursorIdx + n + 1) % MAX_PARTICLES; break; }
    }
    if (!p) return; // at the cap — skip rather than recycle, keeps cost bounded

    var star = Math.random() < STAR_CHANCE;
    p.on = true;
    p.star = star;
    // slightly behind / below the pointer, never directly on top of it
    p.x = x + rand(-9, 9);
    p.y = y + rand(7, 18);
    p.vx = rand(-16, 16);          // slight random horizontal drift (px/s)
    p.vy = rand(8, 30);            // starts slow, gravity pulls it down
    p.size = star ? rand(3, MAX_SIZE) : rand(MIN_SIZE, MAX_SIZE);
    p.born = now;
    p.life = rand(MIN_LIFE, MAX_LIFE);
    p.a = rand(0.55, 0.95);
    p.ph = rand(0, 6.283);
    startLoop();
  }

  /* ---- Render loop (runs only while something is alive) ---- */
  var raf = 0, last = 0;

  function frame(now) {
    raf = 0;
    var dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    ctx.clearRect(0, 0, W, H);
    var alive = 0;

    for (var i = 0; i < MAX_PARTICLES; i++) {
      var p = pool[i];
      if (!p.on) continue;
      var age = now - p.born;
      if (age >= p.life) { p.on = false; continue; }
      alive++;

      var t = age / p.life;                       // 0 → 1
      p.vy += GRAVITY * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      // quick soft fade-in, then smooth ease-out to zero
      var fadeIn = t < 0.1 ? t / 0.1 : 1;
      var fadeOut = 1 - t;
      var alpha = p.a * fadeIn * fadeOut * fadeOut;
      if (alpha <= 0.01) continue;

      var d, spr;
      if (p.star) {
        // gentle twinkle
        var tw = 0.85 + 0.15 * Math.sin(p.ph + age * 0.02);
        d = p.size * 3.4 * tw;
        spr = starSprite;
      } else {
        d = p.size * 3.2;
        spr = glowSprite;
      }
      ctx.globalAlpha = alpha;
      ctx.drawImage(spr, p.x - d / 2, p.y - d / 2, d, d);
    }
    ctx.globalAlpha = 1;

    if (alive) raf = win.requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, W, H);
  }

  function startLoop() {
    if (raf) return;
    last = win.performance.now();
    raf = win.requestAnimationFrame(frame);
  }

  function clearAll() {
    for (var i = 0; i < MAX_PARTICLES; i++) pool[i].on = false;
    if (raf) { win.cancelAnimationFrame(raf); raf = 0; }
    ctx.clearRect(0, 0, W, H);
  }

  /* ---- Pointer tracking (spawns along the path, right inside the event) ---- */
  var lx = null, ly = null, acc = 0;

  function onMove(e) {
    if (e.pointerType && e.pointerType !== "mouse") return; // ignore touch / pen
    var x = e.clientX, y = e.clientY;

    if (lx === null) { lx = x; ly = y; acc = 0; return; }

    var dx = x - lx, dy = y - ly;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > TELEPORT) { lx = x; ly = y; acc = 0; return; } // re-entered window

    var now = win.performance.now();
    acc += dist;
    var made = 0;

    // interpolate so fast strokes stay continuous
    while (acc >= SPAWN_EVERY && made < MAX_PER_EVENT) {
      acc -= SPAWN_EVERY;
      var f = dist ? 1 - acc / dist : 1;
      if (f < 0) f = 0; else if (f > 1) f = 1;
      spawn(lx + dx * f, ly + dy * f, now);
      made++;
    }
    if (made === MAX_PER_EVENT) acc = 0;

    lx = x; ly = y;
  }

  function reset() { lx = ly = null; acc = 0; }

  function boot() {
    doc.body.insertBefore(canvas, doc.body.firstChild);
    resize();

    doc.addEventListener("pointermove", onMove, { passive: true });
    doc.documentElement.addEventListener("mouseleave", reset);
    win.addEventListener("blur", reset);
    win.addEventListener("resize", resize, { passive: true });
    doc.addEventListener("visibilitychange", function () { if (doc.hidden) { clearAll(); reset(); } });

    // if the user flips reduced-motion on mid-session, switch off cleanly
    var onReduce = function () {
      if (mqReduce.matches) {
        clearAll();
        doc.removeEventListener("pointermove", onMove);
      }
    };
    if (mqReduce.addEventListener) mqReduce.addEventListener("change", onReduce);
  }

  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
