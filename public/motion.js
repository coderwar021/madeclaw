(() => {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // 1) Thin scroll progress
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

  // 2) Header solidifies after scroll — chrome motion
  const top = document.querySelector(".top");
  if (top) {
    const syncTop = () => {
      top.classList.toggle("is-scrolled", window.scrollY > 8);
    };
    window.addEventListener("scroll", syncTop, { passive: true });
    syncTop();
  }

  // 3) Gentle scroll reveal
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
      { threshold: 0.14 },
    );
    io.observe(el);
  });
})();
