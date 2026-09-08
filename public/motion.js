(() => {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Thin scroll progress — one intentional chrome motion
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

  // Gentle scroll reveal — second intentional motion
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
