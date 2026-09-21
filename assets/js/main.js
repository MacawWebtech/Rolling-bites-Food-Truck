/* ==========================================================================
   ROLLING BITES — main.js
   Sticky nav, theme toggle, RTL demo toggle, filters, search, form
   validation, animated stats, scroll reveal (fallback), back-to-top, mobile menu.
   NOTE: scroll animation / parallax now lives in scroll-experience.js.
   ========================================================================== */
(function () {
  "use strict";

  var root = document.documentElement;
  var prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------------- Theme (Light / Dark) ---------------- */
  function initTheme() {
    var stored = localStorage.getItem("rb-theme");
    var systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    var theme = stored || (systemDark ? "dark" : "light");
    root.setAttribute("data-theme", theme);
    document.querySelectorAll("[data-theme-toggle]").forEach(function (btn) {
      btn.setAttribute("aria-pressed", theme === "dark");
    });
  }

  function toggleTheme() {
    var current = root.getAttribute("data-theme") === "dark" ? "dark" : "light";
    var next = current === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    localStorage.setItem("rb-theme", next);
    document.querySelectorAll("[data-theme-toggle]").forEach(function (btn) {
      btn.setAttribute("aria-pressed", next === "dark");
    });
  }

  document.querySelectorAll("[data-theme-toggle]").forEach(function (btn) {
    btn.addEventListener("click", toggleTheme);
  });

  /* ---------------- RTL demo toggle ---------------- */
  function initRTL() {
    var stored = localStorage.getItem("rb-dir");
    if (stored) root.setAttribute("dir", stored);
    document.querySelectorAll("[data-rtl-toggle]").forEach(function (btn) {
      btn.setAttribute("aria-pressed", root.getAttribute("dir") === "rtl");
    });
  }
  document.querySelectorAll("[data-rtl-toggle]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var next = root.getAttribute("dir") === "rtl" ? "ltr" : "rtl";
      root.setAttribute("dir", next);
      localStorage.setItem("rb-dir", next);
      document.querySelectorAll("[data-rtl-toggle]").forEach(function (b) {
        b.setAttribute("aria-pressed", next === "rtl");
      });
    });
  });

  /* ---------------- Sticky header ---------------- */
  var header = document.querySelector(".site-header");
  function onScrollHeader() {
    if (!header) return;
    if (window.scrollY > 60) header.classList.add("is-scrolled");
    else header.classList.remove("is-scrolled");
  }
  window.addEventListener("scroll", onScrollHeader, { passive: true });

  /* ---------------- Back to top ---------------- */
  var backBtn = document.querySelector(".back-to-top");
  function onScrollBack() {
    if (!backBtn) return;
    if (window.scrollY > 500) backBtn.classList.add("show");
    else backBtn.classList.remove("show");
  }
  window.addEventListener("scroll", onScrollBack, { passive: true });
  if (backBtn) {
    backBtn.addEventListener("click", function () {
      if (window.RBMotion && window.RBMotion.scrollTo && !prefersReduced) window.RBMotion.scrollTo(0);
      else window.scrollTo({ top: 0, behavior: prefersReduced ? "auto" : "smooth" });
    });
  }

  /* ---------------- Scroll indicator (hero "Scroll" button) ---------------- */
  document.querySelectorAll(".scroll-indicator").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var section = btn.closest("section");
      var target = section ? section.nextElementSibling : null;
      if (target && window.RBMotion && window.RBMotion.scrollTo && !prefersReduced) {
        window.RBMotion.scrollTo(target);
      } else if (target) {
        target.scrollIntoView({ behavior: prefersReduced ? "auto" : "smooth", block: "start" });
      } else {
        window.scrollTo({ top: window.innerHeight, behavior: prefersReduced ? "auto" : "smooth" });
      }
    });
  });

  /* ---------------- Scroll reveal (IntersectionObserver) ---------------- */
  function initReveal() {
    /* When the scroll-experience engine is running it owns every reveal. It falls
       back to its own observer if GSAP can't load, so nothing is ever left hidden. */
    if (window.RBMotion && !prefersReduced) return;
    var targets = document.querySelectorAll(
      ".reveal, .reveal-left, .reveal-right, .reveal-zoom, .reveal-img"
    );
    if (!("IntersectionObserver" in window) || prefersReduced) {
      targets.forEach(function (el) { el.classList.add("in-view"); });
      return;
    }
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("in-view");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -60px 0px" }
    );
    targets.forEach(function (el) { io.observe(el); });
  }

  /* ---------------- Animated stats counters ---------------- */
  function animateCount(el) {
    var target = parseFloat(el.getAttribute("data-count"));
    var suffix = el.getAttribute("data-suffix") || "";
    var duration = 1600;
    var start = null;
    function step(ts) {
      if (!start) start = ts;
      var progress = Math.min((ts - start) / duration, 1);
      var value = Math.floor(progress * target);
      el.textContent = value.toLocaleString() + suffix;
      if (progress < 1) requestAnimationFrame(step);
      else el.textContent = target.toLocaleString() + suffix;
    }
    requestAnimationFrame(step);
  }

  function initStats() {
    var stats = document.querySelectorAll("[data-count]");
    if (!stats.length) return;
    if (!("IntersectionObserver" in window) || prefersReduced) {
      stats.forEach(function (el) {
        el.textContent = el.getAttribute("data-count") + (el.getAttribute("data-suffix") || "");
      });
      return;
    }
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            animateCount(entry.target);
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.5 }
    );
    stats.forEach(function (el) { io.observe(el); });
  }

  /* ---------------- Menu / Blog filters ---------------- */
  function initFilters() {
    document.querySelectorAll("[data-filter-group]").forEach(function (group) {
      var buttons = group.querySelectorAll(".filter-btn");
      var targetSelector = group.getAttribute("data-filter-group");
      var items = document.querySelectorAll(targetSelector);
      buttons.forEach(function (btn) {
        btn.addEventListener("click", function () {
          buttons.forEach(function (b) { b.classList.remove("active"); b.setAttribute("aria-pressed", "false"); });
          btn.classList.add("active");
          btn.setAttribute("aria-pressed", "true");
          var filter = btn.getAttribute("data-filter");
          items.forEach(function (item) {
            var cats = (item.getAttribute("data-category") || "").split(" ");
            var show = filter === "all" || cats.indexOf(filter) !== -1;
            item.classList.toggle("show", show);
            if (show) item.style.display = "";
            else item.style.display = "none";
          });
        });
      });
    });
  }

  /* ---------------- Blog search ---------------- */
  function initSearch() {
    var input = document.querySelector("[data-blog-search]");
    if (!input) return;
    input.addEventListener("input", function () {
      var q = input.value.trim().toLowerCase();
      document.querySelectorAll("[data-search-item]").forEach(function (card) {
        var title = (card.getAttribute("data-title") || card.textContent).toLowerCase();
        card.style.display = title.indexOf(q) !== -1 ? "" : "none";
      });
    });
  }

  /* ---------------- Form validation (Bootstrap pattern) ---------------- */
  function initForms() {
    document.querySelectorAll("form.needs-validation").forEach(function (form) {
      form.addEventListener("submit", function (e) {
        if (!form.checkValidity()) {
          e.preventDefault();
          e.stopPropagation();
        } else {
          e.preventDefault();
          var alertBox = form.querySelector(".form-success");
          form.reset();
          form.classList.remove("was-validated");
          if (alertBox) {
            alertBox.classList.remove("d-none");
            setTimeout(function () { alertBox.classList.add("d-none"); }, 5000);
          }
        }
        form.classList.add("was-validated");
      });
    });
  }

  /* ---------------- Newsletter form (demo) ---------------- */
  function initNewsletter() {
    document.querySelectorAll("[data-newsletter-form]").forEach(function (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var msg = form.querySelector("[data-newsletter-msg]");
        if (msg) {
          msg.textContent = "Thanks! You're on the list for weekly specials.";
          msg.classList.remove("d-none");
        }
        form.reset();
      });
    });
  }

  /* ---------------- Countdown (Coming Soon) ---------------- */
  function initCountdown() {
    var el = document.querySelector("[data-countdown]");
    if (!el) return;
    var target = new Date(el.getAttribute("data-countdown")).getTime();
    var dEl = el.querySelector("[data-c-days]"),
      hEl = el.querySelector("[data-c-hours]"),
      mEl = el.querySelector("[data-c-min]"),
      sEl = el.querySelector("[data-c-sec]");
    function tick() {
      var now = Date.now();
      var diff = Math.max(target - now, 0);
      var d = Math.floor(diff / 86400000);
      var h = Math.floor((diff % 86400000) / 3600000);
      var m = Math.floor((diff % 3600000) / 60000);
      var s = Math.floor((diff % 60000) / 1000);
      if (dEl) dEl.textContent = String(d).padStart(2, "0");
      if (hEl) hEl.textContent = String(h).padStart(2, "0");
      if (mEl) mEl.textContent = String(m).padStart(2, "0");
      if (sEl) sEl.textContent = String(s).padStart(2, "0");
    }
    tick();
    setInterval(tick, 1000);
  }

  /* ---------------- Nav active state by page ---------------- */
  function markActiveNav() {
    var path = location.pathname.split("/").pop() || "index.html";
    document.querySelectorAll(".site-nav .nav-link, .offcanvas-menu .nav-link").forEach(function (link) {
      var href = (link.getAttribute("href") || "").split("/").pop();
      if (href === path) link.classList.add("active");
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    initTheme();
    initRTL();
    onScrollHeader();
    initReveal();
    initStats();
    initFilters();
    initSearch();
    initForms();
    initNewsletter();
    initCountdown();
    markActiveNav();
  });
})();
