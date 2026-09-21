/* ==========================================================================
   ROLLING BITES — scroll-experience.js
   Premium scroll experience: smooth scrolling (Lenis), scroll-linked motion
   (GSAP + ScrollTrigger), masks, parallax, pinned scenes, cursor + magnetic
   micro-interactions, progress UI.

   - Replaces the old parallax.js.
   - Driven entirely by the site's existing class names (.reveal*, .stagger,
     .reveal-img, .parallax-section, .page-banner, card classes…) so no
     content or layout has to change.
   - Two opt-in attributes control pinned scenes:
        data-rb-pin="special" | "gallery"   data-rb-len="260"  (track length, vh)
   - Fails safe: if GSAP can't load, the original CSS/IO reveals in main.js
     run instead. Respects prefers-reduced-motion.
   ========================================================================== */
(function () {
  "use strict";

  var win = window, doc = document, root = doc.documentElement;
  var RB = (win.RBMotion = win.RBMotion || {});
  RB.state = "pending";
  RB.active = false;
  RB.lenis = null;

  /* ------------------------------------------------------------------------
     Environment
     ------------------------------------------------------------------------ */
  var mqReduce = win.matchMedia("(prefers-reduced-motion: reduce)");
  var mqSmall = win.matchMedia("(max-width: 767.98px)");
  var mqDesk = win.matchMedia("(min-width: 992px)");
  var mqFine = win.matchMedia("(hover: hover) and (pointer: fine)");
  var conn = navigator.connection || {};
  var lowPower = !!(
    conn.saveData ||
    (navigator.deviceMemory && navigator.deviceMemory <= 2) ||
    (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2)
  );

  var CDN = {
    gsap: ["https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"],
    st: ["https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/ScrollTrigger.min.js"],
    lenis: ["https://unpkg.com/lenis@1.1.20/dist/lenis.min.js"]
  };

  var gsap, ST, ctx = null;
  var M = {};            // current mode flags (see readMode)
  var BUILD = 0;         // build counter, used for claim bookkeeping
  var cleanups = [];     // event listeners etc. to undo on rebuild
  var entrances = [];    // pending once-only entrances (see onceIn / sweep)
  var lenis = null, lenisTick = null;
  var lateStart = false; // engine started after the load gate timed out

  function $(s, c) { return (c || doc).querySelector(s); }
  function $$(s, c) { return Array.prototype.slice.call((c || doc).querySelectorAll(s)); }
  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  function safe(fn, name) { try { fn(); } catch (e) { if (win.console) console.warn("[RBMotion] " + (name || "") + " failed:", e); } }
  function on(el, ev, fn, opt) {
    el.addEventListener(ev, fn, opt);
    cleanups.push(function () { el.removeEventListener(ev, fn, opt); });
  }

  function readMode() {
    M.small = mqSmall.matches;
    M.lite = M.small || lowPower;                       // lighter effects
    M.fine = mqFine.matches && mqDesk.matches && !lowPower; // desktop pointer effects
    M.pin = !M.lite && mqDesk.matches;                  // pinned scenes
    M.dir = root.getAttribute("dir") === "rtl" ? -1 : 1;
  }
  function toggleClass(c, on_) { root.classList[on_ ? "add" : "remove"](c); }
  function applyModeClasses() {
    toggleClass("rb-lite", M.lite);
    toggleClass("rb-fine", M.fine);
    toggleClass("rb-pin-on", M.pin);
  }

  /* ------------------------------------------------------------------------
     Scrolling helper (used by main.js, anchors, back-to-top)
     ------------------------------------------------------------------------ */
  function nativeScrollTo(target, opts) {
    opts = opts || {};
    var y = typeof target === "number" ? target :
      target.getBoundingClientRect().top + (win.pageYOffset || 0) + (opts.offset || 0);
    win.scrollTo({ top: y, behavior: mqReduce.matches ? "auto" : "smooth" });
  }
  RB.scrollTo = nativeScrollTo;

  /* ------------------------------------------------------------------------
     UI that works with or without GSAP (progress, header, back-to-top ring,
     nav indicator, anchors). Only touches CSS vars / transforms on tiny nodes.
     ------------------------------------------------------------------------ */
  function initUI() {
    root.classList.add("rb-ui");
    var bar = doc.createElement("div");
    bar.className = "rb-progress";
    bar.setAttribute("aria-hidden", "true");
    bar.innerHTML = "<span></span>";
    doc.body.appendChild(bar);
    var barFill = bar.firstChild;

    var header = $(".site-header");
    var topBtn = $(".back-to-top");
    var ringBar = null;
    if (topBtn && !topBtn.querySelector(".rb-ring")) {
      topBtn.insertAdjacentHTML("afterbegin",
        '<svg class="rb-ring" viewBox="0 0 46 46" aria-hidden="true" focusable="false">' +
        '<circle class="rb-ring-track" cx="23" cy="23" r="21"></circle>' +
        '<circle class="rb-ring-bar" cx="23" cy="23" r="21"></circle></svg>');
    }
    if (topBtn) ringBar = topBtn.querySelector(".rb-ring-bar");

    var ticking = false;
    function paint() {
      ticking = false;
      var y = win.pageYOffset || 0;
      var max = Math.max(1, root.scrollHeight - win.innerHeight);
      var p = clamp(y / max, 0, 1);
      barFill.style.transform = "scaleX(" + p.toFixed(4) + ")";
      if (ringBar) ringBar.style.strokeDashoffset = (131.95 * (1 - p)).toFixed(2);
      if (header) header.style.setProperty("--rb-hdr", clamp(y / 140, 0, 1).toFixed(3));
    }
    function req() { if (!ticking) { ticking = true; win.requestAnimationFrame(paint); } }
    win.addEventListener("scroll", req, { passive: true });
    win.addEventListener("resize", req);
    paint();

    /* Anchor links -> smooth scroller */
    doc.addEventListener("click", function (e) {
      var a = e.target.closest ? e.target.closest('a[href^="#"]') : null;
      if (!a || a.hasAttribute("data-bs-toggle")) return;
      var id = a.getAttribute("href");
      if (!id || id.length < 2) return;
      var t; try { t = doc.querySelector(id); } catch (err) { return; }
      if (!t) return;
      e.preventDefault();
      RB.scrollTo(t, { offset: 0 });
    });

    /* Bootstrap offcanvas: pause smooth-scroll while the menu is open */
    doc.addEventListener("show.bs.offcanvas", function () { if (RB.lenis) RB.lenis.stop(); });
    doc.addEventListener("hidden.bs.offcanvas", function () { if (RB.lenis) RB.lenis.start(); });
    $$(".offcanvas-body, .dropdown-menu").forEach(function (el) { el.setAttribute("data-lenis-prevent", ""); });

    /* Filters / search change page height */
    doc.addEventListener("click", function (e) {
      if (e.target.closest && e.target.closest(".filter-btn")) setTimeout(refresh, 90);
    });
    doc.addEventListener("input", function (e) {
      if (e.target.matches && e.target.matches("[data-blog-search]")) setTimeout(refresh, 90);
    });

    initNavIndicator();
  }

  function initNavIndicator() {
    var list = $(".site-nav-list");
    if (!list) return;
    var ind = list.querySelector(".nav-indicator");
    if (!ind) {
      ind = doc.createElement("li");
      ind.className = "nav-indicator";
      ind.setAttribute("aria-hidden", "true");
      ind.setAttribute("role", "presentation");
      list.appendChild(ind);
    }
    root.classList.add("rb-nav-ind");
    var links = $$(".nav-link", list);
    function active() { return list.querySelector(".nav-link.active"); }
    function place(link, animate) {
      if (!link || !list.offsetWidth) return;
      var lr = list.getBoundingClientRect(), r = link.getBoundingClientRect();
      if (animate === false) ind.style.transition = "none";
      ind.style.setProperty("--x", (r.left - lr.left).toFixed(1) + "px");
      ind.style.setProperty("--w", (r.width / lr.width).toFixed(4));
      if (animate === false) { void ind.offsetWidth; ind.style.transition = ""; }
    }
    function home() { place(active()); }
    links.forEach(function (l) {
      l.addEventListener("mouseenter", function () { place(l); });
      l.addEventListener("focus", function () { place(l); });
      l.addEventListener("blur", home);
    });
    list.addEventListener("mouseleave", home);
    win.addEventListener("resize", function () { place(active(), false); });
    /* draw the active underline in after load (grows from the left) */
    var a0 = active();
    if (a0) {
      var lr0 = list.getBoundingClientRect(), r0 = a0.getBoundingClientRect();
      ind.style.setProperty("--x", (r0.left - lr0.left).toFixed(1) + "px");
      ind.style.setProperty("--w", "0");
      win.setTimeout(function () { home(); }, 900);
    }
    if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(function () { place(active(), false); });
  }

  /* ------------------------------------------------------------------------
     Library loading (primary <script defer> tags live in the HTML; these are
     fallbacks if a CDN is blocked)
     ------------------------------------------------------------------------ */
  function loadFirst(urls, test, done) {
    if (test()) return done(true);
    var i = 0;
    (function next() {
      if (i >= urls.length) return done(test());
      var s = doc.createElement("script");
      s.src = urls[i++]; s.async = true;
      s.onload = function () { test() ? done(true) : next(); };
      s.onerror = next;
      doc.head.appendChild(s);
    })();
  }
  function ensureLibs(cb) {
    loadFirst(CDN.gsap, function () { return !!win.gsap; }, function (ok1) {
      if (!ok1) return cb(false);
      loadFirst(CDN.st, function () { return !!win.ScrollTrigger; }, function (ok2) {
        if (!ok2) return cb(false);
        cb(true);
      });
    });
  }

  /* ------------------------------------------------------------------------
     Boot
     ------------------------------------------------------------------------ */
  function fallbackReveal() {
    var t = $$(".reveal, .reveal-left, .reveal-right, .reveal-zoom, .reveal-img");
    if (!("IntersectionObserver" in win)) { t.forEach(function (el) { el.classList.add("in-view"); }); return; }
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in-view"); io.unobserve(e.target); } });
    }, { threshold: 0.15, rootMargin: "0px 0px -60px 0px" });
    t.forEach(function (el) { io.observe(el); });
  }
  function off(state) { RB.state = state; root.classList.add("rb-off"); }

  function boot() {
    initUI();
    if (mqReduce.matches) { off("reduced-motion"); return; }
    ensureLibs(function (ok) {
      if (!ok) { off("libs-unavailable"); fallbackReveal(); return; }
      try { startMotion(); } catch (e) {
        if (win.console) console.warn("[RBMotion] start failed:", e);
        try { if (ctx) ctx.revert(); } catch (_) {}
        RB.active = false; root.classList.remove("rb-motion");
        off("error"); fallbackReveal();
      }
    });
  }

  function startMotion() {
    gsap = win.gsap; ST = win.ScrollTrigger;
    gsap.registerPlugin(ST);
    gsap.config({ nullTargetWarn: false });
    ST.config({ ignoreMobileResize: true });

    lateStart = root.classList.contains("rb-off");
    RB.active = true; RB.state = "active";
    root.classList.add("rb-motion");
    build(true);
    root.classList.remove("rb-off");
    root.classList.add("rb-go");

    var introGo = function () { if (RB.intro) RB.intro.play(); };
    if (doc.fonts && doc.fonts.ready) {
      var fired = false;
      var go = function () { if (!fired) { fired = true; introGo(); ST.refresh(); } };
      doc.fonts.ready.then(go); win.setTimeout(go, 900);
    } else introGo();

    win.addEventListener("load", function () { win.setTimeout(refresh, 250); });

    /* Lenis is optional: if its primary tag failed on desktop, try a fallback host without delaying anything */
    if (M.fine && !win.Lenis) {
      loadFirst(CDN.lenis, function () { return !!win.Lenis; }, function (ok) { if (ok) safe(smoothScroll, "smoothScroll"); });
    }

    /* rebuild when the layout mode (breakpoint / pointer / direction) changes */
    var t;
    function schedule() { win.clearTimeout(t); t = win.setTimeout(rebuild, 220); }
    [mqSmall, mqDesk, mqFine].forEach(function (mq) {
      if (mq.addEventListener) mq.addEventListener("change", schedule); else if (mq.addListener) mq.addListener(schedule);
    });
    if ("MutationObserver" in win) {
      new MutationObserver(schedule).observe(root, { attributes: true, attributeFilter: ["dir"] });
    }
  }

  function refresh() { if (ST) ST.refresh(); }

  function teardown() {
    try { if (ctx) ctx.revert(); } catch (e) {}
    cleanups.forEach(function (f) { try { f(); } catch (e) {} });
    cleanups = []; entrances = []; RB.intro = null;
  }
  function rebuild() { teardown(); build(false); ST.refresh(); }

  /* ------------------------------------------------------------------------
     Build (everything that is scroll-driven lives inside one gsap.context so a
     breakpoint change can revert it cleanly)
     ------------------------------------------------------------------------ */
  function build(first) {
    BUILD++;
    readMode();
    applyModeClasses();
    ctx = null;
    safe(smoothScroll, "smoothScroll");
    ctx = gsap.context(function () {
      safe(function () { heroModule(first); }, "hero");
      safe(pinModules, "pin");
      safe(headings, "headings");          // split first so blocks below skip them
      safe(parallaxSections, "parallax");
      safe(images, "images");
      safe(cardGroups, "cards");
      safe(slides, "slides");
      safe(zooms, "zooms");
      safe(textBlocks, "text");
      safe(sectionDepth, "depth");
      safe(decor, "decor");
      safe(footerReveal, "footer");
      safe(hoverEffects, "hover");
    });
    safe(sweep, "sweep");
  }

  /* claim bookkeeping: an element is either handled itself ("own") or, with
     deep=true, handled together with everything inside it */
  function claim(el, deep) { el.__rbC = BUILD; el.__rbD = deep ? BUILD : 0; }
  function taken(el) {
    if (el.__rbC === BUILD) return true;
    for (var p = el.parentElement; p; p = p.parentElement) if (p.__rbD === BUILD) return true;
    return false;
  }
  function inCtx(fn) { if (ctx) ctx.add(fn); else fn(); }

  /* once-only entrance driven by ScrollTrigger, with a sweep for elements that
     are already above the viewport at build time (reload mid-page, anchors) */
  function onceIn(el, start, play) {
    var done = false, rec = { el: el, done: false };
    rec.go = function (instant) {
      if (done) return;
      done = true; rec.done = true;
      var tw;
      inCtx(function () { tw = play(); });
      if (instant && tw && tw.progress) tw.progress(1);
    };
    ST.create({ trigger: el, start: start || "top 88%", once: true, onEnter: function () { rec.go(false); } });
    entrances.push(rec);
    return rec;
  }
  function sweep() {
    entrances.forEach(function (e) {
      if (e.done) return;
      var r = e.el.getBoundingClientRect();
      if (r.bottom < 0) e.go(true);
    });
  }

  /* ------------------------------------------------------------------------
     Smooth scrolling (Lenis) — desktop pointers only; touch keeps native
     momentum scrolling, which is smoother on phones than any JS scroller.
     ------------------------------------------------------------------------ */
  function smoothScroll() {
    if (M.fine && win.Lenis && !lenis) {
      lenis = new win.Lenis({ lerp: 0.085, smoothWheel: true, wheelMultiplier: 1 });
      RB.lenis = lenis;
      lenis.on("scroll", ST.update);
      lenisTick = function (t) { lenis.raf(t * 1000); };
      gsap.ticker.add(lenisTick);
      gsap.ticker.lagSmoothing(0);
      RB.scrollTo = function (target, opts) {
        lenis.scrollTo(target, {
          offset: (opts && opts.offset) || 0, duration: 1.5,
          easing: function (t) { return 1 - Math.pow(1 - t, 4); }
        });
      };
    } else if (!M.fine && lenis) {
      gsap.ticker.remove(lenisTick);
      lenis.destroy(); lenis = null; RB.lenis = null; RB.scrollTo = nativeScrollTo;
    }
  }

  /* ------------------------------------------------------------------------
     Text helpers
     ------------------------------------------------------------------------ */
  /* split by <br> into block lines (used for big hero headings) */
  function lineify(h) {
    if (h.__rbLines) return h.__rbLines;
    var nodes = Array.prototype.slice.call(h.childNodes), lines = [], cur = null;
    h.innerHTML = "";
    nodes.forEach(function (n) {
      if (n.nodeName === "BR") { cur = null; return; }
      if (!cur) { cur = doc.createElement("span"); cur.className = "rb-line"; h.appendChild(cur); lines.push(cur); }
      cur.appendChild(n);
    });
    h.__rbLines = lines;
    return lines;
  }
  /* wrap every word in a mask + inner span; keeps existing inline markup (.stroke/.accent) */
  function splitWords(el) {
    if (el.__rbWords) return el.__rbWords;
    var words = [];
    el.setAttribute("aria-label", el.textContent.replace(/\s+/g, " ").trim());
    (function walk(node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (n) {
        if (n.nodeType === 3) {
          var frag = doc.createDocumentFragment();
          n.nodeValue.split(/(\s+)/).forEach(function (p) {
            if (!p) return;
            if (/^\s+$/.test(p)) { frag.appendChild(doc.createTextNode(" ")); return; }
            var w = doc.createElement("span"), i = doc.createElement("span");
            w.className = "rb-w"; w.setAttribute("aria-hidden", "true");
            i.className = "rb-wi"; i.textContent = p;
            w.appendChild(i); frag.appendChild(w); words.push(i);
          });
          node.replaceChild(frag, n);
        } else if (n.nodeType === 1 && n.nodeName !== "BR") walk(n);
      });
    })(el);
    el.__rbWords = words;
    return words;
  }

  /* generic text block: eyebrow line grows, other children rise with stagger.
     Headings that split themselves are left to the heading module. */
  function textBlock(el) {
    if (!el || taken(el)) return;
    claim(el, false);
    var kids = Array.prototype.filter.call(el.children, function (k) {
      return !taken(k) && !k.__rbWords && !k.classList.contains("stagger") &&
        !k.querySelector(".reveal-img") && k.nodeName !== "SCRIPT";
    });
    if (!el.children.length) kids = [el];
    if (!kids.length) return;
    kids.forEach(function (k) { claim(k, false); });
    var eb = kids.filter(function (k) { return k.classList.contains("eyebrow"); })[0];
    var rest = kids.filter(function (k) { return k !== eb; });
    var dist = M.lite ? 24 : 36;
    if (eb) gsap.set(eb, { opacity: 0, y: 14, "--rb-line": 0 });
    if (rest.length) gsap.set(rest, { opacity: 0, y: dist });
    onceIn(el, "top 86%", function () {
      var tl = gsap.timeline();
      if (eb) tl.to(eb, { opacity: 1, y: 0, "--rb-line": 1, duration: 1, ease: "power3.out", clearProps: "transform,opacity" }, 0);
      if (rest.length) tl.to(rest, { opacity: 1, y: 0, duration: 1.15, ease: "power3.out", stagger: M.lite ? 0.07 : 0.11, clearProps: "transform,opacity" }, eb ? 0.18 : 0);
      return tl;
    });
  }

  function headings() {
    $$(".section-title, .cta-band h3").forEach(function (h) {
      if (h.__rbIntro || h.__rbWords || taken(h)) return;
      var words = splitWords(h);
      if (!words.length) return;
      gsap.set(words, { yPercent: 118 });
      onceIn(h, "top 88%", function () {
        return gsap.to(words, { yPercent: 0, duration: 1.2, ease: "expo.out", stagger: M.lite ? 0.04 : 0.06 });
      });
    });
  }

  /* ------------------------------------------------------------------------
     HERO / BANNERS / STANDALONE PAGES
     ------------------------------------------------------------------------ */
  function heroModule(first) {
    var hero = $(".hero"), banner = $(".page-banner"), solo = $(".error-page, .coming-soon");
    var header = $(".site-header");
    var introOK = first && !lateStart && (win.pageYOffset || 0) < 80;
    var tl = introOK ? gsap.timeline({ paused: true, defaults: { ease: "expo.out" } }) : null;
    if (tl) RB.intro = tl;

    if (tl && header) tl.fromTo(header, { yPercent: -100, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 1.2, clearProps: "transform,opacity" }, 0.1);

    /* ---- homepage-style hero ---- */
    if (hero) {
      var bg = $(".hero-layer:not(.hero-smoke)", hero), smoke = $(".hero-smoke", hero), fg = $(".hero-fg", hero);
      var floats = $$(".float-el", hero), content = $(".hero-content", hero), h1 = $(".hero-heading", hero);
      var kids = $$(".eyebrow, .hero-desc, .hero-content .d-flex, .hero-content > .btn", hero);
      var lines = h1 ? lineify(h1) : [], words = h1 ? splitWords(h1) : [];
      if (h1) { h1.__rbIntro = true; claim(h1, true); }
      kids.forEach(function (k) { claim(k, true); });

      if (tl) {
        if (bg) tl.fromTo(bg, { "--rb-s": 1.25 }, { "--rb-s": 1, duration: 2.6 }, 0);
        if (words.length) tl.fromTo(words, { yPercent: 118 }, { yPercent: 0, duration: 1.35, stagger: 0.085 }, 0.25);
        if (kids.length) tl.fromTo(kids, { y: 38, opacity: 0 }, { y: 0, opacity: 1, duration: 1.2, stagger: 0.12, ease: "power3.out" }, 0.8);
        if (floats.length) tl.fromTo(floats, { scale: 0.4, opacity: 0 }, { scale: 1, opacity: 0.9, duration: 1.4, stagger: 0.15 }, 1.0);
      }

      var heroScroll = function () {
        var H = function () { return win.innerHeight; };
        var trig = { trigger: hero, start: "top top", end: "bottom top", scrub: M.lite ? true : 0.6, invalidateOnRefresh: true };
        if (!M.lite) {
          if (bg) gsap.fromTo(bg, { yPercent: 0, scale: 1 }, { yPercent: 16, scale: 1.1, ease: "none", scrollTrigger: trig });
          if (smoke) gsap.fromTo(smoke, { yPercent: 0, xPercent: 0 }, { yPercent: 10, xPercent: 8 * M.dir, ease: "none", scrollTrigger: trig });
          if (fg) gsap.fromTo(fg, { yPercent: 0 }, { yPercent: -14, ease: "none", scrollTrigger: trig });
          floats.forEach(function (f, i) {
            gsap.fromTo(f, { x: 0, y: 0 }, {
              x: (i % 2 ? -1 : 1) * 70 * M.dir,
              y: function () { return -H() * (0.16 + i * 0.09); },
              ease: "none", scrollTrigger: trig
            });
          });
          lines.forEach(function (ln, i) {
            gsap.fromTo(ln, { xPercent: 0 }, { xPercent: (i % 2 ? 1 : -1) * 6 * M.dir, ease: "none", scrollTrigger: trig });
          });
        }
        /* content leaves with a gentle scale (cheap: transform + opacity only) */
        if (content) gsap.fromTo(content, { scale: 1, transformOrigin: "50% 0%" }, { scale: 0.93, ease: "none", scrollTrigger: trig });
        var texts = (h1 ? [h1] : []).concat(kids);
        var ttrig = { trigger: hero, start: "top top", end: "70% top", scrub: true, invalidateOnRefresh: true };
        texts.forEach(function (el, i) {
          gsap.fromTo(el, { y: 0, opacity: 1 }, {
            y: function () { return -H() * (0.08 + i * 0.06); }, opacity: 0, ease: "none", scrollTrigger: ttrig
          });
        });
      };
      if (tl) tl.eventCallback("onComplete", function () { inCtx(heroScroll); });
      else heroScroll();
      return;
    }

    /* ---- inner-page banner ---- */
    if (banner) {
      var bbg = $(".banner-bg", banner), row = $(".breadcrumb-row", banner);
      var crumb = row && $(".breadcrumb-pill", row), bh = row && $("h1", row);
      var bw = bh ? (bh.__rbIntro = true, claim(bh, true), splitWords(bh)) : [];
      if (crumb) claim(crumb, true);
      if (tl) {
        if (bbg) tl.fromTo(bbg, { "--rb-s": 1.2 }, { "--rb-s": 1, duration: 2.2 }, 0);
        if (crumb) tl.fromTo(crumb, { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 1, ease: "power3.out" }, 0.3);
        if (bw.length) tl.fromTo(bw, { yPercent: 118 }, { yPercent: 0, duration: 1.3, stagger: 0.09 }, 0.4);
      }
      var bannerScroll = function () {
        var trig = { trigger: banner, start: "top top", end: "bottom top", scrub: M.lite ? true : 0.6, invalidateOnRefresh: true };
        if (!M.lite && bbg) gsap.fromTo(bbg, { yPercent: 0, scale: 1 }, { yPercent: 22, scale: 1.1, ease: "none", scrollTrigger: trig });
        if (row) gsap.fromTo(row, { y: 0, opacity: 1 }, {
          y: function () { return -win.innerHeight * 0.14; }, opacity: 0, ease: "none",
          scrollTrigger: { trigger: banner, start: "top top", end: "bottom 30%", scrub: true, invalidateOnRefresh: true }
        });
      };
      if (tl) tl.eventCallback("onComplete", function () { inCtx(bannerScroll); }); else bannerScroll();
      return;
    }

    /* ---- 404 / coming soon ---- */
    if (solo) {
      var sbg = $(".hero-layer", solo), box = $(".container-xl", solo), sh = $("h1", solo);
      var sw = sh ? (sh.__rbIntro = true, claim(sh, true), splitWords(sh)) : [];
      var skids = box ? Array.prototype.filter.call(box.children, function (k) { return k !== sh; }) : [];
      skids.forEach(function (k) { claim(k, true); });
      if (tl) {
        if (sbg) tl.fromTo(sbg, { "--rb-s": 1.25 }, { "--rb-s": 1, duration: 2.4 }, 0);
        if (sw.length) tl.fromTo(sw, { yPercent: 118 }, { yPercent: 0, duration: 1.3, stagger: 0.08 }, 0.3);
        if (skids.length) tl.fromTo(skids, { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 1.1, stagger: 0.1, ease: "power3.out" }, 0.55);
      }
    }
  }

  /* ------------------------------------------------------------------------
     Background layers + parallax sections
     ------------------------------------------------------------------------ */
  function ensureLayer(sec) {
    var l = sec.querySelector(":scope > .rb-bglayer");
    if (l) return l;
    var bg = win.getComputedStyle(sec).backgroundImage;
    if (!bg || bg === "none") return null;
    l = doc.createElement("div");
    l.className = "rb-bglayer"; l.setAttribute("aria-hidden", "true");
    l.style.backgroundImage = bg;
    sec.insertBefore(l, sec.firstChild);
    sec.classList.add("rb-has-layer");
    return l;
  }

  function parallaxSections() {
    if (M.lite) return;
    $$(".parallax-section").forEach(function (sec) {
      if (sec.hasAttribute("data-rb-pin") && M.pin) return;
      var layer = ensureLayer(sec);
      if (!layer) return;
      gsap.fromTo(layer, { yPercent: -7.5, scale: 1.08 }, {
        yPercent: 7.5, scale: 1, ease: "none",
        scrollTrigger: { trigger: sec, start: "top bottom", end: "bottom top", scrub: true }
      });
      var content = $(".container-xl", sec);
      var blocks = $$(".reveal, .reveal-left, .reveal-right, .reveal-zoom", sec);
      (blocks.length ? blocks : content ? [content] : []).forEach(function (b) { textBlock(b); });
      if (content) {
        gsap.fromTo(content, { y: 60 }, { y: -60, ease: "none", scrollTrigger: { trigger: sec, start: "top bottom", end: "bottom top", scrub: true } });
      }
      /* large typography drifts sideways against the scroll */
      var title = $(".section-title", sec);
      if (title) {
        gsap.fromTo(title, { x: -70 * M.dir }, { x: 70 * M.dir, ease: "none", scrollTrigger: { trigger: sec, start: "top bottom", end: "bottom top", scrub: true } });
      }
    });
  }

  /* ------------------------------------------------------------------------
     Pinned scenes (CSS sticky track + scrubbed timeline)
     ------------------------------------------------------------------------ */
  function ensureTrack(sec) {
    var p = sec.parentNode;
    if (p && p.classList && p.classList.contains("rb-pin-track")) return p;
    var t = doc.createElement("div");
    t.className = "rb-pin-track";
    t.style.setProperty("--rb-pin-len", (parseFloat(sec.getAttribute("data-rb-len")) || 260) + "vh");
    p.insertBefore(t, sec);
    t.appendChild(sec);
    return t;
  }

  function pinModules() {
    if (!M.pin) return;
    $$("[data-rb-pin]").forEach(function (sec) {
      var kind = sec.getAttribute("data-rb-pin");
      var track = ensureTrack(sec);
      claim(sec, true);
      if (kind === "special") pinSpecial(sec, track);
      else if (kind === "gallery") pinGallery(sec, track);
    });
  }

  function trackTrigger(track) {
    return { trigger: track, start: "top top", end: "bottom bottom", scrub: 0.7, invalidateOnRefresh: true };
  }

  /* Scene 1 — "Today's Special": background pushes in, overlay deepens, then the
     copy builds in stages while the section stays pinned. */
  function pinSpecial(sec, track) {
    var layer = ensureLayer(sec), overlay = $(".parallax-overlay", sec), content = $(".container-xl", sec);
    var eyebrow = $(".eyebrow", sec), title = $(".section-title", sec), desc = $("p.fs-5", sec);
    var price = $(".price-tag-big", sec), btn = $(".btn", sec);
    var words = title ? (title.__rbIntro = true, splitWords(title)) : [];
    var tl = gsap.timeline({ defaults: { ease: "none" }, scrollTrigger: trackTrigger(track) });
    if (layer) tl.fromTo(layer, { scale: 1.02, yPercent: -4 }, { scale: 1.22, yPercent: 4, duration: 1 }, 0);
    if (overlay) tl.fromTo(overlay, { opacity: 0.35 }, { opacity: 1, duration: 0.35 }, 0);
    if (eyebrow) tl.fromTo(eyebrow, { y: 24, opacity: 0 }, { y: 0, opacity: 1, ease: "power2.out", duration: 0.1 }, 0.04);
    words.forEach(function (w, i) {
      tl.fromTo(w, { yPercent: 118 }, { yPercent: 0, ease: "power3.out", duration: 0.14 }, 0.1 + i * 0.05);
    });
    if (desc) tl.fromTo(desc, { y: 34, opacity: 0 }, { y: 0, opacity: 1, ease: "power2.out", duration: 0.14 }, 0.36);
    if (price) tl.fromTo(price, { y: 30, scale: 0.7, opacity: 0 }, { y: 0, scale: 1, opacity: 1, ease: "back.out(1.6)", duration: 0.14 }, 0.54);
    if (btn) tl.fromTo(btn, { y: 30, opacity: 0 }, { y: 0, opacity: 1, ease: "power2.out", duration: 0.12 }, 0.7);
    if (content) tl.to(content, { y: -24, duration: 0.3 }, 0.7);
  }

  /* Scene 2 — Philosophy gallery: the quote lights up word by word, then the three
     photographs unveil one after another while the scene stays pinned. */
  function pinGallery(sec, track) {
    var quote = $(".font-editorial", sec), eyebrow = $(".eyebrow", sec);
    var hosts = $$(".reveal-img", sec);
    var qWords = quote ? (splitWords(quote)) : [];
    var tl = gsap.timeline({ defaults: { ease: "none" }, scrollTrigger: trackTrigger(track) });
    if (eyebrow) tl.fromTo(eyebrow, { opacity: 0, y: 14, "--rb-line": 0 }, { opacity: 1, y: 0, "--rb-line": 1, ease: "power2.out", duration: 0.08 }, 0);
    qWords.forEach(function (w, i) {
      tl.fromTo(w, { opacity: 0.14 }, { opacity: 1, duration: 0.05 }, 0.02 + i * (0.3 / Math.max(1, qWords.length)));
    });
    hosts.forEach(function (host, k) {
      claim(host, true);
      var frame = wrapFrame(host); if (!frame) return;
      var img = frame.querySelector("img"), s = k % 2 ? -1 : 1, start = 0.14 + k * 0.2;
      tl.fromTo(frame, { clipPath: clipStr("up", 0), scale: 0.9 }, { clipPath: OPEN(0), scale: 1, ease: "power3.out", duration: 0.26 }, start);
      tl.fromTo(host, { y: 60 }, { y: 0, ease: "power2.out", duration: 0.26 }, start);
      tl.fromTo(img, { scale: 1.36 }, { scale: 1.12, ease: "power2.out", duration: 0.34 }, start);
      tl.fromTo(img, { xPercent: -3 * s }, { xPercent: 3 * s, ease: "none", duration: 1 }, 0);
    });
  }

  /* ------------------------------------------------------------------------
     Images: clip-path reveal, zoom settle, exit scale-down, parallax / pan
     ------------------------------------------------------------------------ */
  function wrapFrame(host) {
    var f = host.querySelector(":scope > .rb-frame");
    if (f) return f;
    var img = host.querySelector(":scope > img");
    if (!img) return null;
    f = doc.createElement("div"); f.className = "rb-frame";
    host.insertBefore(f, img); f.appendChild(img);
    return f;
  }
  function clipStr(type, R) {
    var r = " round " + R + "px)";
    switch (type) {
      case "up": return "inset(100% 0% 0% 0%" + r;
      case "left": return "inset(0% 100% 0% 0%" + r;
      case "right": return "inset(0% 0% 0% 100%" + r;
      default: return "inset(24% 24% 24% 24%" + r;
    }
  }
  function OPEN(R) { return "inset(0% 0% 0% 0% round " + R + "px)"; }

  function images() {
    $$(".reveal-img").forEach(function (host) {
      if (taken(host)) return;
      claim(host, true);
      if (!host.offsetParent && win.getComputedStyle(host).position !== "fixed") return;   // hidden at this breakpoint
      var frame = wrapFrame(host);
      if (!frame) return;
      var img = frame.querySelector("img");
      var cs = win.getComputedStyle(host);
      var padded = parseFloat(cs.paddingLeft) > 0;
      var R = (!padded && /px$/.test(cs.borderTopLeftRadius)) ? Math.round(parseFloat(cs.borderTopLeftRadius)) : 0;
      var rect = host.getBoundingClientRect();
      var landscape = rect.width / Math.max(1, rect.height) > 1.15;
      var fromLeft = rect.left + rect.width / 2 < win.innerWidth / 2;
      var type = host.classList.contains("rounded-organic") ? "iris" : landscape ? (fromLeft ? "left" : "right") : "up";
      if (M.dir < 0 && (type === "left" || type === "right")) type = type === "left" ? "right" : "left";
      var s = fromLeft ? 1 : -1;

      if (M.lite) {
        gsap.set(frame, { clipPath: clipStr(type, R), scale: 0.94 });
        gsap.set(img, { scale: 1.2 });
        onceIn(host, "top 90%", function () {
          var tl = gsap.timeline();
          tl.to(frame, { clipPath: OPEN(R), scale: 1, duration: 1.3, ease: "expo.out", clearProps: "clipPath,transform" }, 0);
          tl.to(img, { scale: 1, duration: 1.8, ease: "expo.out" }, 0);
          return tl;
        });
        return;
      }

      var tl = gsap.timeline({
        scrollTrigger: { trigger: host, start: "top bottom", end: "bottom top", scrub: 0.7 }
      });
      tl.fromTo(frame, { clipPath: clipStr(type, R), scale: 0.92 }, { clipPath: OPEN(R), scale: 1, ease: "power3.out", duration: 0.34 }, 0);
      tl.fromTo(img, { scale: 1.34 }, { scale: 1.12, ease: "power2.out", duration: 0.42 }, 0);
      tl.to(frame, { scale: 0.95, ease: "power1.in", duration: 0.28 }, 0.72);
      /* horizontal pan for wide frames, vertical parallax for tall ones */
      var pan = landscape ? { xPercent: -4 * s } : { yPercent: -5 };
      var panTo = landscape ? { xPercent: 4 * s } : { yPercent: 5 };
      panTo.ease = "none";
      panTo.scrollTrigger = { trigger: host, start: "top bottom", end: "bottom top", scrub: true };
      gsap.fromTo(img, pan, panTo);
    });
  }

  /* ------------------------------------------------------------------------
     Cards / groups (staggered, 3D-tipped entrance)
     ------------------------------------------------------------------------ */
  var CARD_SEL = ".dish-card, .feature-card, .service-card, .blog-card, .team-card, .review-card, .pricing-card, .timeline-card, .schedule-card, .contact-info-card, .gallery-item, .sidebar-widget";
  function hasCard(el) { return el.matches(CARD_SEL) || !!el.querySelector(CARD_SEL); }
  /* a column that IS a card (or wraps exactly one card / a form), not a text column that merely contains one */
  function isCardWrap(c) {
    return c.matches(CARD_SEL) || (c.children.length === 1 && hasCard(c.children[0])) || !!c.querySelector("form.needs-validation");
  }
  function hiddenByCarousel(el) {
    var ci = el.closest(".carousel-item");
    return !!(ci && !ci.classList.contains("active"));
  }
  function isSlideCol(el) {
    return el.classList.contains("reveal-left") || el.classList.contains("reveal-right") ||
      el.classList.contains("reveal-img") || !!el.querySelector(".reveal-img");
  }

  function cardGroups() {
    var items = [];
    $$(".stagger").forEach(function (g) {
      claim(g, false);
      Array.prototype.forEach.call(g.children, function (c) { items.push(c); });
    });
    $$(".row").forEach(function (row) {
      if (row.__rbC === BUILD || hiddenByCarousel(row)) return;
      var kids = Array.prototype.filter.call(row.children, function (c) { return !isSlideCol(c) && isCardWrap(c); });
      if (!kids.length) return;
      claim(row, false);
      kids.forEach(function (c) { items.push(c); });
    });
    $$(".sidebar-widget").forEach(function (w) { items.push(w); });

    items = items.filter(function (el, i) { return items.indexOf(el) === i && !taken(el) && !hiddenByCarousel(el) && !isSlideCol(el); });

    /* index within its visual row, for the stagger delay */
    var tops = items.map(function (el) { return Math.round((el.getBoundingClientRect().top + (win.pageYOffset || 0)) / 12); });
    var counters = {};
    items.forEach(function (el, i) {
      var idx = counters[tops[i]] = (counters[tops[i]] === undefined ? 0 : counters[tops[i]] + 1);
      claim(el, true);
      cardEntrance(el, idx);
    });
  }

  function cardEntrance(el, idx) {
    var d = idx * (M.lite ? 0.07 : 0.12);
    var img = el.querySelector(".dish-img img, .blog-img img, .team-photo img, .service-card img, .gallery-item img");
    var isTile = el.matches(".gallery-item") || !!el.querySelector(".gallery-item");
    var isStat = !!el.querySelector(".stat-num");
    var settle = M.lite ? 1 : 1.12;   // resting scale (overscan keeps room for the horizontal pan)

    if (isStat) {
      gsap.set(el, { y: 34, opacity: 0 });
      onceIn(el, "top 92%", function () {
        return gsap.to(el, { y: 0, opacity: 1, duration: 1, delay: d, ease: "power3.out", clearProps: "transform,opacity" });
      });
      return;
    }
    if (isTile) {
      gsap.set(el, { clipPath: "inset(100% 0% 0% 0%)" });
      if (img) gsap.set(img, { "--rb-s": 1.34 });
      onceIn(el, "top 92%", function () {
        var tl = gsap.timeline({ delay: d });
        tl.to(el, { clipPath: "inset(0% 0% 0% 0%)", duration: 1.3, ease: "expo.out", clearProps: "clipPath" }, 0);
        if (img) tl.to(img, { "--rb-s": settle, duration: 1.9, ease: "expo.out" }, 0.05);
        return tl;
      });
      if (img && !M.lite) {
        var i = $$(".gallery-item").indexOf(el.matches(".gallery-item") ? el : el.querySelector(".gallery-item"));
        var sgn = i % 2 ? -1 : 1;
        gsap.fromTo(img, { "--rb-x": -4 * sgn + "%" }, {
          "--rb-x": 4 * sgn + "%", ease: "none",
          scrollTrigger: { trigger: el, start: "top bottom", end: "bottom top", scrub: true }
        });
      }
      return;
    }
    if (M.lite) gsap.set(el, { opacity: 0, y: 50, scale: 0.96 });
    else gsap.set(el, { opacity: 0, y: 84, rotationX: -8, scale: 0.94, transformPerspective: 1100, transformOrigin: "50% 100%" });
    if (img) gsap.set(img, { "--rb-s": 1.28 });
    onceIn(el, "top 90%", function () {
      var tl = gsap.timeline({ delay: d });
      tl.to(el, { opacity: 1, duration: 0.7, ease: "power2.out", clearProps: "opacity" }, 0);
      tl.to(el, { y: 0, rotationX: 0, scale: 1, duration: 1.3, ease: "expo.out", clearProps: "transform,transformPerspective,transformOrigin" }, 0);
      if (img) tl.to(img, { "--rb-s": 1, duration: 1.9, ease: "expo.out" }, 0.1);
      return tl;
    });
  }

  /* ------------------------------------------------------------------------
     Side-slide blocks (.reveal-left / .reveal-right) and zoom blocks
     ------------------------------------------------------------------------ */
  function slides() {
    $$(".reveal-left, .reveal-right").forEach(function (el) {
      if (taken(el)) return;
      if (el.classList.contains("reveal-img") || el.querySelector(".reveal-img")) { claim(el, false); return; }
      if (el.querySelector(".eyebrow, .section-title, h2, h3")) { textBlock(el); return; }
      claim(el, true);
      var side = (el.classList.contains("reveal-left") ? -1 : 1) * M.dir;
      var from = side < 0 ? "inset(0% 100% 0% 0%)" : "inset(0% 0% 0% 100%)";
      if (M.lite) gsap.set(el, { x: side * 36, opacity: 0 });
      else gsap.set(el, { x: side * 70, opacity: 0, clipPath: from });
      onceIn(el, "top 88%", function () {
        var tl = gsap.timeline();
        tl.to(el, { opacity: 1, duration: 0.8, ease: "power2.out", clearProps: "opacity" }, 0);
        tl.to(el, M.lite ? { x: 0, duration: 1.1, ease: "expo.out", clearProps: "transform" } :
          { x: 0, clipPath: "inset(0% 0% 0% 0%)", duration: 1.4, ease: "expo.out", clearProps: "transform,clipPath" }, 0);
        return tl;
      });
    });
  }

  function zooms() {
    $$(".reveal-zoom").forEach(function (el) {
      if (taken(el)) return;
      claim(el, false);
      var cs = win.getComputedStyle(el);
      var R = /px$/.test(cs.borderTopLeftRadius) ? Math.round(parseFloat(cs.borderTopLeftRadius)) : 0;
      if (M.lite) {
        gsap.set(el, { scale: 0.94, opacity: 0 });
        onceIn(el, "top 90%", function () {
          return gsap.to(el, { scale: 1, opacity: 1, duration: 1.2, ease: "expo.out", clearProps: "transform,opacity" });
        });
        return;
      }
      gsap.fromTo(el,
        { clipPath: "inset(10% 5% 10% 5% round " + R + "px)", scale: 0.9, opacity: 0 },
        {
          clipPath: "inset(0% 0% 0% 0% round " + R + "px)", scale: 1, opacity: 1, ease: "none",
          scrollTrigger: { trigger: el, start: "top 98%", end: "top 55%", scrub: 0.6 }
        });
    });
  }

  function textBlocks() {
    $$(".reveal").forEach(function (el) { if (!taken(el)) textBlock(el); });
  }

  /* ------------------------------------------------------------------------
     Depth: text columns drift at a different speed than their images
     ------------------------------------------------------------------------ */
  function sectionDepth() {
    if (M.lite) return;
    $$(".section").forEach(function (sec) {
      var row = sec.querySelector(".row.align-items-center");
      if (!row) return;
      var cols = Array.prototype.slice.call(row.children);
      var hasImg = cols.some(function (c) { return c.classList.contains("reveal-img") || c.querySelector(".reveal-img"); });
      var txt = cols.filter(function (c) { return !c.classList.contains("reveal-img") && !c.querySelector(".reveal-img") && c.querySelector(".eyebrow, .section-title"); })[0];
      if (!hasImg || !txt) return;
      gsap.fromTo(txt, { y: 44 }, { y: -44, ease: "none", scrollTrigger: { trigger: sec, start: "top bottom", end: "bottom top", scrub: true } });
    });
  }

  function decor() {
    if (M.lite) return;
    $$(".deco-photo-circle").forEach(function (el) {
      if (!el.offsetParent) return;
      var sec = el.closest("section") || el.parentNode;
      gsap.fromTo(el, { x: -30 * M.dir, y: 50 }, {
        x: 30 * M.dir, y: -50, ease: "none",
        scrollTrigger: { trigger: sec, start: "top bottom", end: "bottom top", scrub: true }
      });
    });
  }

  function footerReveal() {
    var footer = $(".site-footer");
    if (!footer) return;
    var cols = $$(".footer-col", footer), bottom = $(".footer-bottom", footer);
    if (cols.length) gsap.set(cols, { y: M.lite ? 30 : 60, opacity: 0 });
    if (bottom) gsap.set(bottom, { opacity: 0 });
    onceIn(footer, "top 92%", function () {
      var tl = gsap.timeline();
      if (cols.length) tl.to(cols, { y: 0, opacity: 1, duration: 1.2, ease: "power3.out", stagger: 0.1, clearProps: "transform,opacity" }, 0);
      if (bottom) tl.to(bottom, { opacity: 1, duration: 1, ease: "power2.out", clearProps: "opacity" }, 0.5);
      return tl;
    });
  }

  /* ------------------------------------------------------------------------
     Desktop pointer micro-interactions: card tilt, magnetic buttons, cursor
     ------------------------------------------------------------------------ */
  function hoverEffects() {
    if (!M.fine) return;

    /* 3D tilt on cards */
    $$(".dish-card, .service-card, .feature-card, .blog-card").forEach(function (card) {
      gsap.set(card, { transformPerspective: 900 });
      var rx = gsap.quickTo(card, "rotationX", { duration: 0.6, ease: "power3.out" });
      var ry = gsap.quickTo(card, "rotationY", { duration: 0.6, ease: "power3.out" });
      on(card, "pointerenter", function (e) {
        if (e.pointerType && e.pointerType !== "mouse") return;
        gsap.to(card, { y: -8, scale: 1.012, duration: 0.7, ease: "power3.out", overwrite: "auto" });
      });
      on(card, "pointermove", function (e) {
        if (e.pointerType && e.pointerType !== "mouse") return;
        var r = card.getBoundingClientRect();
        ry(((e.clientX - r.left) / r.width - 0.5) * 9);
        rx(-((e.clientY - r.top) / r.height - 0.5) * 7);
      });
      on(card, "pointerleave", function () {
        rx(0); ry(0);
        gsap.to(card, { y: 0, scale: 1, duration: 0.8, ease: "power3.out", overwrite: "auto" });
      });
    });

    /* magnetic buttons */
    $$(".btn, .social-circle").forEach(function (el) {
      var big = el.classList.contains("btn");
      var qx = gsap.quickTo(el, "x", { duration: 0.55, ease: "power3.out" });
      var qy = gsap.quickTo(el, "y", { duration: 0.55, ease: "power3.out" });
      on(el, "pointermove", function (e) {
        if (e.pointerType && e.pointerType !== "mouse") return;
        var r = el.getBoundingClientRect();
        qx((e.clientX - (r.left + r.width / 2)) * (big ? 0.22 : 0.3));
        qy((e.clientY - (r.top + r.height / 2)) * (big ? 0.3 : 0.3) - (big ? 2 : 0));
      });
      on(el, "pointerleave", function () { qx(0); qy(0); });
      on(el, "pointerdown", function () { gsap.to(el, { scale: 0.96, duration: 0.18, ease: "power2.out", overwrite: "auto" }); });
      on(el, "pointerup", function () { gsap.to(el, { scale: 1, duration: 0.5, ease: "power3.out", overwrite: "auto" }); });
    });

    /* cursor follower (the native cursor stays visible) */
    var cur = doc.createElement("div");
    cur.className = "rb-cursor"; cur.setAttribute("aria-hidden", "true");
    cur.innerHTML = '<span class="rb-cursor-dot"></span><span class="rb-cursor-ring"><i></i></span>';
    doc.body.appendChild(cur);
    cleanups.push(function () { if (cur.parentNode) cur.parentNode.removeChild(cur); });
    var dot = cur.firstChild, ring = cur.lastChild;
    var dx = gsap.quickTo(dot, "x", { duration: 0.12, ease: "power3" }), dy = gsap.quickTo(dot, "y", { duration: 0.12, ease: "power3" });
    var rxx = gsap.quickTo(ring, "x", { duration: 0.55, ease: "power3" }), ryy = gsap.quickTo(ring, "y", { duration: 0.55, ease: "power3" });
    var HOVER = "a, button, .btn, input, textarea, select, label, [data-cursor], .gallery-item, .dish-card, .service-card, .blog-card, .team-card";
    on(doc, "pointermove", function (e) {
      if (e.pointerType && e.pointerType !== "mouse") return;
      if (!cur.classList.contains("on")) {
        gsap.set([dot, ring], { x: e.clientX, y: e.clientY });
        cur.classList.add("on");
      }
      dx(e.clientX); dy(e.clientY); rxx(e.clientX); ryy(e.clientY);
      cur.classList.toggle("is-hover", !!(e.target.closest && e.target.closest(HOVER)));
    }, { passive: true });
    on(doc.documentElement, "mouseleave", function () { cur.classList.remove("on"); });
    on(doc, "pointerdown", function () { cur.classList.add("is-down"); });
    on(doc, "pointerup", function () { cur.classList.remove("is-down"); });
  }

  /* ------------------------------------------------------------------------ */
  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
