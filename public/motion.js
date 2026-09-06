(() => {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // scroll-progress (skill.md ~3562)
  const bar = document.querySelector(".scroll-progress .bar");
  if (bar) {
    const update = () => {
      const h = document.documentElement;
      const max = h.scrollHeight - h.clientHeight;
      const p = max > 0 ? h.scrollTop / max : 0;
      bar.style.width = `${p * 100}%`;
    };
    window.addEventListener("scroll", update, { passive: true });
    update();
  }

  // scroll-reveal (skill.md ~3590)
  document.querySelectorAll(".scroll-reveal").forEach((el) => {
    if (reduce) {
      el.classList.add("in");
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            el.classList.add("in");
            io.unobserve(el);
          }
        });
      },
      { threshold: 0.2 },
    );
    io.observe(el);
  });

  // magnetic-button (skill.md ~2695)
  const magBtn = document.querySelector(".mag-btn");
  if (magBtn && !reduce) {
    const radius = 96;
    window.addEventListener(
      "mousemove",
      (e) => {
        const r = magBtn.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        const dist = Math.hypot(dx, dy);
        if (dist < radius) {
          magBtn.style.transform = `translate(${dx * 0.28}px, ${dy * 0.28}px)`;
        } else {
          magBtn.style.transform = "";
        }
      },
      { passive: true },
    );
  }

  // parallax-mouse (skill.md ~2604)
  const parallax = document.getElementById("hero-parallax");
  if (parallax && !reduce) {
    parallax.addEventListener(
      "mousemove",
      (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5;
        const y = (e.clientY - r.top) / r.height - 0.5;
        e.currentTarget.querySelectorAll(".layer").forEach((l) => {
          const d = Number(l.dataset.depth) || 1;
          // Prefer CSS `translate` so scale-pulse / float keyframes keep owning `transform`.
          if (l.classList.contains("scale-pulse-soft") || l.classList.contains("visual-core")) {
            l.style.translate = `${x * d * 18}px ${y * d * 18}px`;
          } else {
            l.style.transform = `translate(${x * d * 18}px, ${y * d * 18}px)`;
          }
        });
      },
      { passive: true },
    );
    parallax.addEventListener("mouseleave", () => {
      parallax.querySelectorAll(".layer").forEach((l) => {
        l.style.transform = "";
        l.style.translate = "";
      });
    });
  }

  // canvas-starfield (skill.md ~4493) — soft teal drift, not warp-speed
  const canvas = document.getElementById("stars");
  if (canvas && !reduce) {
    const ctx = canvas.getContext("2d");
    let stars = [];
    let raf = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.min(160, Math.floor((window.innerWidth * window.innerHeight) / 14000));
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        r: Math.random() * 1.4 + 0.3,
        a: Math.random() * 0.5 + 0.15,
        vx: (Math.random() - 0.5) * 0.15,
        vy: (Math.random() - 0.5) * 0.12,
      }));
    };

    const tick = () => {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      for (const s of stars) {
        s.x += s.vx;
        s.y += s.vy;
        if (s.x < 0) s.x = window.innerWidth;
        if (s.x > window.innerWidth) s.x = 0;
        if (s.y < 0) s.y = window.innerHeight;
        if (s.y > window.innerHeight) s.y = 0;
        ctx.beginPath();
        ctx.fillStyle = `rgba(180, 235, 220, ${s.a})`;
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(tick);
    };

    resize();
    tick();
    window.addEventListener("resize", resize, { passive: true });
    window.addEventListener("pagehide", () => cancelAnimationFrame(raf));
  }
})();
