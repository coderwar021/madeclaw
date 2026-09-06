(() => {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // scroll-progress
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

  // scroll-reveal
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
      { threshold: 0.18 },
    );
    io.observe(el);
  });
})();
