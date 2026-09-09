(() => {
  const mount = document.querySelector("[data-labs-physics]");
  if (!mount || !window.Matter) return;

  const {
    Engine,
    Render,
    Runner,
    Bodies,
    Body,
    Composite,
    Mouse,
    MouseConstraint,
    Events,
    Query,
  } = Matter;

  const COLORS = {
    blue: "#4285F4",
    orange: "#FA7B17",
    green: "#34A853",
    pink: "#FFB0C8",
    yellow: "#FBBC04",
  };

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let engine = null;
  let render = null;
  let runner = null;
  let mouseConstraint = null;
  let walls = [];
  let toys = [];
  let started = false;
  let rafFit = 0;

  const cloverVertices = (cx, cy, lobeR) => {
    // Four overlapping circles approximated as a soft clover polygon.
    const pts = [];
    const lobes = [
      [0, -lobeR * 0.72],
      [lobeR * 0.72, 0],
      [0, lobeR * 0.72],
      [-lobeR * 0.72, 0],
    ];
    for (const [ox, oy] of lobes) {
      for (let i = 0; i < 10; i++) {
        const a = (Math.PI * 2 * i) / 10;
        pts.push({
          x: cx + ox + Math.cos(a) * lobeR * 0.62,
          y: cy + oy + Math.sin(a) * lobeR * 0.62,
        });
      }
    }
    // Convex hull of lobe samples (gift wrap).
    pts.sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lower = [];
    for (const p of pts) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
        lower.pop();
      }
      lower.push(p);
    }
    const upper = [];
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
        upper.pop();
      }
      upper.push(p);
    }
    upper.pop();
    lower.pop();
    return lower.concat(upper);
  };

  const makeClover = (x, y, scale) => {
    const lobeR = 42 * scale;
    const verts = cloverVertices(0, 0, lobeR);
    return Bodies.fromVertices(
      x,
      y,
      [verts],
      {
        restitution: 0.35,
        friction: 0.25,
        frictionAir: 0.02,
        density: 0.0014,
        render: { fillStyle: COLORS.yellow, strokeStyle: "transparent", lineWidth: 0 },
      },
      true,
    );
  };

  const spawnToys = (w, h, scale) => {
    const floorY = h - 4;
    const dropY = Math.min(h * 0.28, 90 * scale);
    const specs = [
      () =>
        Bodies.circle(w * 0.12, dropY, 58 * scale, {
          restitution: 0.45,
          friction: 0.2,
          frictionAir: 0.015,
          density: 0.0012,
          render: { fillStyle: COLORS.blue, strokeStyle: "transparent" },
        }),
      () =>
        Bodies.polygon(w * 0.28, dropY - 20, 5, 52 * scale, {
          restitution: 0.3,
          friction: 0.28,
          frictionAir: 0.02,
          density: 0.0015,
          angle: -0.25,
          render: { fillStyle: COLORS.orange, strokeStyle: "transparent" },
        }),
      () =>
        Bodies.polygon(w * 0.42, dropY + 10, 6, 48 * scale, {
          restitution: 0.35,
          friction: 0.25,
          frictionAir: 0.018,
          density: 0.0013,
          render: { fillStyle: COLORS.green, strokeStyle: "transparent" },
        }),
      () =>
        Bodies.rectangle(w * 0.56, dropY, 96 * scale, 96 * scale, {
          chamfer: { radius: 28 * scale },
          restitution: 0.28,
          friction: 0.3,
          frictionAir: 0.02,
          density: 0.0014,
          angle: 0.15,
          render: { fillStyle: COLORS.pink, strokeStyle: "transparent" },
        }),
      () =>
        Bodies.circle(w * 0.7, dropY - 30, 62 * scale, {
          restitution: 0.45,
          friction: 0.2,
          frictionAir: 0.015,
          density: 0.0012,
          render: { fillStyle: COLORS.blue, strokeStyle: "transparent" },
        }),
      () => makeClover(w * 0.86, dropY + 5, scale),
      () =>
        Bodies.polygon(w * 0.5, dropY - 70, 6, 36 * scale, {
          restitution: 0.35,
          friction: 0.25,
          frictionAir: 0.02,
          density: 0.0011,
          render: { fillStyle: COLORS.green, strokeStyle: "transparent" },
        }),
    ];

    const bodies = specs
      .map((fn) => {
        try {
          return fn();
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    // Keep toys above the floor on spawn.
    for (const b of bodies) {
      if (b.bounds.max.y > floorY - 8) {
        Body.translate(b, { x: 0, y: floorY - 8 - b.bounds.max.y });
      }
    }
    return bodies;
  };

  const buildWalls = (w, h) => {
    const t = 80;
    return [
      Bodies.rectangle(w / 2, h + t / 2 - 2, w + 200, t, {
        isStatic: true,
        render: { visible: false },
      }),
      Bodies.rectangle(-t / 2, h / 2, t, h * 2, {
        isStatic: true,
        render: { visible: false },
      }),
      Bodies.rectangle(w + t / 2, h / 2, t, h * 2, {
        isStatic: true,
        render: { visible: false },
      }),
    ];
  };

  const sizeOf = () => {
    const rect = mount.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(320, Math.floor(rect.width));
    const h = Math.max(160, Math.floor(rect.height));
    return { w, h, dpr };
  };

  const teardown = () => {
    if (runner) Runner.stop(runner);
    if (render) {
      Render.stop(render);
      if (render.canvas && render.canvas.parentNode) {
        render.canvas.parentNode.removeChild(render.canvas);
      }
      render.textures = {};
    }
    if (engine) {
      Composite.clear(engine.world, false);
      Engine.clear(engine);
    }
    engine = null;
    render = null;
    runner = null;
    mouseConstraint = null;
    walls = [];
    toys = [];
  };

  const start = () => {
    teardown();
    const { w, h } = sizeOf();
    const scale = Math.max(0.55, Math.min(1.15, w / 1100));

    engine = Engine.create({ gravity: { x: 0, y: reduceMotion ? 0.55 : 1.05 } });
    render = Render.create({
      element: mount,
      engine,
      options: {
        width: w,
        height: h,
        background: "#F3EFEA",
        wireframes: false,
        pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
        hasBounds: false,
      },
    });

    render.canvas.style.width = "100%";
    render.canvas.style.height = "100%";
    render.canvas.style.display = "block";
    render.canvas.style.touchAction = "none";
    render.canvas.setAttribute("aria-hidden", "true");

    walls = buildWalls(w, h);
    toys = spawnToys(w, h, scale);
    Composite.add(engine.world, [...walls, ...toys]);

    const mouse = Mouse.create(render.canvas);
    mouseConstraint = MouseConstraint.create(engine, {
      mouse,
      constraint: {
        stiffness: 0.2,
        render: { visible: false },
      },
    });
    Composite.add(engine.world, mouseConstraint);
    render.mouse = mouse;

    // Prevent page scroll while dragging a toy.
    Events.on(mouseConstraint, "startdrag", () => {
      mount.classList.add("is-dragging");
    });
    Events.on(mouseConstraint, "enddrag", () => {
      mount.classList.remove("is-dragging");
      // Impart a little throw from last mouse velocity.
      if (mouseConstraint.body) {
        /* body already released by Matter */
      }
    });

    // Soft ceiling bounce for toys that fly too high.
    Events.on(engine, "beforeUpdate", () => {
      for (const b of toys) {
        if (b.position.y < -120) {
          Body.setVelocity(b, { x: b.velocity.x * 0.5, y: Math.abs(b.velocity.y) * 0.4 });
          Body.setPosition(b, { x: b.position.x, y: -40 });
        }
      }
    });

    Render.run(render);
    runner = Runner.create();
    Runner.run(runner, engine);
    started = true;

    // Nudge a couple pieces so the pile settles like the Labs screenshot.
    if (!reduceMotion) {
      window.setTimeout(() => {
        for (const b of toys.slice(0, 3)) {
          Body.applyForce(b, b.position, {
            x: (Math.random() - 0.5) * 0.04 * scale,
            y: 0.01 * scale,
          });
        }
      }, 400);
    }
  };

  const refit = () => {
    if (!started) return;
    cancelAnimationFrame(rafFit);
    rafFit = requestAnimationFrame(() => start());
  };

  const setRunning = (visible) => {
    if (visible && !started) start();
    else if (!visible && runner) Runner.stop(runner);
    else if (visible && runner && started) Runner.run(runner, engine);
  };

  const io = new IntersectionObserver(
    (entries) => {
      setRunning(entries.some((e) => e.isIntersecting));
    },
    { rootMargin: "160px 0px", threshold: 0.01 },
  );
  io.observe(mount);

  // Kick immediately if already near the viewport (IO can miss the first frame).
  const boot = mount.getBoundingClientRect();
  const near =
    boot.top < window.innerHeight + 200 && boot.bottom > -200 && boot.width > 0;
  if (near) setRunning(true);

  let resizeTimer = 0;
  window.addEventListener(
    "resize",
    () => {
      clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(refit, 180);
    },
    { passive: true },
  );

  // Expose a tiny helper for proof scripts / debugging.
  window.MadeAPIFooterPhysics = {
    restart: start,
    Query,
  };
})();
