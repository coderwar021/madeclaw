(() => {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Sticky header solidifies after scroll
  const header = document.querySelector(".header");
  if (header) {
    const sync = () => header.classList.toggle("is-scrolled", window.scrollY > 8);
    window.addEventListener("scroll", sync, { passive: true });
    sync();
  }

  // Scroll reveal
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
      { threshold: 0.12 },
    );
    io.observe(el);
  });

  // Featured hero carousel + progress bars
  const hero = document.querySelector("[data-hero]");
  if (hero) {
    const slides = [...hero.querySelectorAll("[data-hero-slide]")];
    const fills = [...hero.querySelectorAll(".featured-hero__progress-fill")];
    const tracks = [...hero.querySelectorAll("[data-hero-goto]")];
    let index = 0;
    let timer = null;

    const show = (next) => {
      index = ((next % slides.length) + slides.length) % slides.length;
      slides.forEach((s, i) => s.classList.toggle("is-active", i === index));
      fills.forEach((f, i) => {
        f.classList.remove("is-running");
        f.style.width = i < index ? "100%" : "0";
        void f.offsetWidth;
        if (i === index && !reduce) f.classList.add("is-running");
        else if (i === index && reduce) f.style.width = "100%";
      });
    };

    const arm = () => {
      if (timer) clearTimeout(timer);
      if (reduce || slides.length < 2) return;
      timer = setTimeout(() => show(index + 1), 6500);
    };

    tracks.forEach((btn) => {
      btn.addEventListener("click", () => {
        show(Number(btn.getAttribute("data-hero-goto") || 0));
        arm();
      });
    });

    fills.forEach((f) => {
      f.addEventListener("animationend", () => {
        if (f.classList.contains("is-running")) {
          show(index + 1);
          arm();
        }
      });
    });

    show(0);
    arm();
  }

  // Category filters (Labs All/Create/Develop/Explore/Learn)
  const filterBtns = [...document.querySelectorAll("[data-filter]")];
  const cards = [...document.querySelectorAll("[data-experiment-grid] .carousel-card")];
  if (filterBtns.length && cards.length) {
    const apply = (cat) => {
      document.body.dataset.category = cat;
      filterBtns.forEach((b) => b.classList.toggle("active", b.dataset.filter === cat));
      cards.forEach((card) => {
        const tags = (card.getAttribute("data-tags") || "").split(/\s+/);
        const show = cat === "all" || tags.includes(cat);
        card.hidden = !show;
      });
    };
    filterBtns.forEach((btn) => {
      btn.addEventListener("click", () => apply(btn.dataset.filter || "all"));
    });
  }
})();
