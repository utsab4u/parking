(() => {
  "use strict";
  const canvas = document.querySelector("#game");
  const ctx = canvas.getContext("2d");
  const ui = Object.fromEntries(
    [
      "speed",
      "gear",
      "angle",
      "steer-marker",
      "status",
      "status-dot",
      "success",
      "result",
      "guide",
    ].map((id) => [id, document.getElementById(id)]),
  );
  // Physics and validation deliberately share one geometry implementation.
  const physics = window.ParkingPhysics;
  const { corners, move, isParked, validateLevel } = physics;
  const config = { width: 30, height: 20, ...physics.constants };
  const $ = (id) => document.getElementById(id);
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const storageKey = "small-hours.custom-levels.v1";
  let savedLevels = [],
    activeLevel = clone(window.PARKING_LEVELS[0]);
  let editing = false,
    editor,
    beforeEdit,
    searchController = null,
    solution = null,
    attemptLevel,
    selectingTow = false,
    towTarget = null,
    towMission = null,
    towCount = 0;
  const sceneLevel = () => (editing ? activeLevel : attemptLevel);
  const collision = (body) => physics.collision(body, sceneLevel());
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) || "[]");
    if (Array.isArray(stored))
      savedLevels = stored
        .slice(0, 50)
        .filter(
          (level) =>
            validateLevel(level).valid &&
            typeof level.id === "string" &&
            level.id.startsWith("custom-") &&
            typeof level.name === "string" &&
            level.name.length <= 80,
        );
  } catch (_) {
    showMessage(
      "Local storage is unavailable or unreadable. You can still play and export your layouts.",
    );
  }
  const keys = new Set();
  const humanReactions = new Map();
  let car,
    elapsed,
    contacts,
    hold,
    won,
    started,
    impactTimer,
    assist = false;
  let scale = 1,
    offsetX = 0,
    offsetY = 0,
    viewWidth = 0,
    viewHeight = 0;
  const clamp = (v, low, high) => Math.max(low, Math.min(high, v));
  const formatTime = (seconds) =>
    `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
  const toWorld = (clientX, clientY) => {
    const bounds = canvas.getBoundingClientRect();
    return {
      x: (clientX - bounds.left - offsetX) / scale,
      y: (clientY - bounds.top - offsetY) / scale,
    };
  };

  function updateTowUI() {
    const cars = sceneLevel().obstacles.filter((body) => body.kind === "car");
    $("tow").disabled = editing || won || Boolean(towMission) || !cars.length;
    $("tow").textContent = towMission
      ? "Helicopter at work..."
      : selectingTow
        ? "Cancel tow selection"
        : "Tow a car (+5:00)";
    $("tow").setAttribute(
      "aria-expanded",
      String(selectingTow || Boolean(towMission)),
    );
    $("tow-panel").hidden = !selectingTow && !towMission;
    $("tow-choices").hidden = !selectingTow;
    $("tow-message").textContent = towMission
      ? "Helicopter dispatched. +5:00 penalty added. Driving resumes after pickup."
      : "Select a highlighted parked car on the lot or from the list, then confirm. Escape cancels without a penalty.";
    const select = $("tow-target");
    select.replaceChildren(new Option("Choose a parked car", ""));
    cars.forEach((body, index) =>
      select.add(
        new Option(
          `Car ${index + 1} (${body.x.toFixed(1)}, ${body.y.toFixed(1)} m)`,
          String(index),
        ),
      ),
    );
    select.value = towTarget ? String(cars.indexOf(towTarget)) : "";
    $("dispatch-tow").disabled = !towTarget || !selectingTow;
    $("validate-level").disabled =
      Boolean(searchController || selectingTow || towMission) ||
      (editing && !editor.isValid());
    canvas.classList.toggle("tow-selecting", selectingTow);
    document.querySelectorAll("[data-key]").forEach((button) => {
      button.disabled = editing || selectingTow || Boolean(towMission);
    });
  }

  function toggleTowSelection() {
    if (editing || won || towMission) return;
    if (
      !selectingTow &&
      !attemptLevel.obstacles.some((body) => body.kind === "car")
    )
      return;
    selectingTow = !selectingTow;
    towTarget = null;
    releaseControls();
    clearValidation();
    updateTowUI();
    canvas.focus({ preventScroll: true });
  }

  function dispatchTow() {
    if (!selectingTow || !towTarget || towMission || editing || won) return;
    clearValidation();
    releaseControls();
    towMission = {
      target: towTarget,
      elapsed: 0,
      reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)")
        .matches,
    };
    selectingTow = false;
    towTarget = null;
    elapsed += 300;
    towCount++;
    started = true;
    hold = 0;
    updateTowUI();
    canvas.focus({ preventScroll: true });
  }

  function showMessage(message) {
    $("app-message").textContent = message;
    $("app-message").hidden = !message;
  }

  function allLevels() {
    const levels = [...window.PARKING_LEVELS, ...savedLevels];
    if (!levels.some((level) => level.id === activeLevel.id))
      levels.push(activeLevel);
    return levels;
  }

  function updateLevelUI() {
    const index = window.PARKING_LEVELS.findIndex(
      (level) => level.id === activeLevel.id,
    );
    const number =
      index < 0
        ? "CUSTOM LAYOUT"
        : `${String(index + 1).padStart(2, "0")} / 20 LEVELS`;
    $("lesson-count").textContent = number;
    $("lesson-name").textContent = activeLevel.name;
    $("mission-number").textContent = number;
    $("mission-name").textContent = activeLevel.name;
    $("mission-description").textContent =
      activeLevel.description ||
      "Park entirely inside the bay and come to a full stop. Either heading is accepted.";
    $("level-hint").textContent =
      activeLevel.hint ||
      "Leave space for the turning circle. Reverse to adjust your approach.";
    $("bay-size").textContent =
      `${activeLevel.bay.length.toFixed(1)} × ${activeLevel.bay.width.toFixed(1)} m`;
    $("level-difficulty").textContent = activeLevel.difficulty || "Custom";
    $("success-next").hidden =
      index < 0 || index === window.PARKING_LEVELS.length - 1;
    const select = $("level-select");
    select.replaceChildren();
    for (const [i, level] of allLevels().entries()) {
      const label =
        i < 20
          ? `${String(i + 1).padStart(2, "0")} · ${level.name}`
          : `Custom · ${level.name}`;
      select.add(new Option(label, level.id));
    }
    select.value = activeLevel.id;
    select.disabled = editing;
    $("previous-level").disabled =
      editing || allLevels()[0].id === activeLevel.id;
    $("next-level").disabled =
      editing || allLevels().at(-1).id === activeLevel.id;
    $("edit-level").disabled = editing;
    $("new-level").disabled = editing;
    $("reset").disabled = editing;
    $("guide").disabled = editing;
    document.body.classList.toggle("editing", editing);
    $("scene-mode").textContent = editing ? "LAYOUT EDITOR" : "YOUR CAR";
    $("scene-instruction").textContent = editing
      ? "Select and drag. Fine-tune in the panel."
      : "Follow the green space.";
    canvas.setAttribute(
      "aria-label",
      editing
        ? "Level editor. Drag objects or use the numeric fields to position them."
        : "Parking game. Arrow keys drive and steer. Release to stop. Space brakes.",
    );
    document.querySelectorAll("[data-key]").forEach((button) => {
      button.disabled = editing;
    });
    updateTowUI();
  }

  function clearValidation() {
    searchController?.abort();
    searchController = null;
    solution = null;
    $("validate-level").disabled = false;
    $("cancel-solver").hidden = true;
    $("route-controls").hidden = true;
    $("solver-status").dataset.state = "idle";
    $("solver-status").textContent =
      "Search from the starting pose. A found route confirms feasibility; no route found is inconclusive.";
  }

  function loadLevel(level) {
    const validation = validateLevel(level);
    if (!validation.valid) {
      showMessage(validation.errors.join(" "));
      return;
    }
    editor?.close();
    editing = false;
    activeLevel = clone(level);
    reset();
    updateLevelUI();
    canvas.focus({ preventScroll: true });
  }

  function navigateLevel(delta) {
    if (editing) return;
    const levels = allLevels(),
      index = levels.findIndex((level) => level.id === activeLevel.id);
    const next = levels[index + delta];
    if (next) loadLevel(next);
  }

  function beginEdit(blank) {
    beforeEdit = clone(activeLevel);
    const draft = blank
      ? {
          name: "My parking spot",
          difficulty: "custom",
          description: "Park inside your custom bay.",
          hint: "Try different approaches and validate the layout.",
          bounds: { minX: 1.45, maxX: 28.55, minY: 3.55, maxY: 18.25 },
          start: { x: 7, y: 11, angle: 0 },
          bay: { x: 22, y: 8, angle: 0, length: 5.8, width: 2.8 },
          obstacles: [],
        }
      : clone(activeLevel);
    if (blank || !draft.id.startsWith("custom-")) {
      draft.id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      if (!blank) draft.name = `${draft.name} (copy)`;
    }
    editing = true;
    releaseControls();
    clearValidation();
    editor.open(draft);
    updateLevelUI();
  }

  function saveCustomLevel(level) {
    const validation = validateLevel(level);
    if (!validation.valid)
      return { ok: false, message: validation.errors.join(" ") };
    const copy = clone(level);
    if (!copy.id.startsWith("custom-")) copy.id = `custom-${Date.now()}`;
    const next = savedLevels.filter((saved) => saved.id !== copy.id);
    if (next.length >= 50)
      return {
        ok: false,
        message:
          "Local library is full (50 layouts). Export this level as JSON instead.",
      };
    next.push(copy);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      savedLevels = next;
      level.id = copy.id;
      updateLevelUI();
      return {
        ok: true,
        message: "Saved in this browser. Export JSON for a portable backup.",
      };
    } catch (_) {
      return {
        ok: false,
        message:
          "Could not save locally. Storage may be blocked or full; export JSON instead.",
      };
    }
  }

  async function runValidation() {
    if (selectingTow || towMission) return;
    if (editing && !editor.isValid()) {
      $("solver-status").textContent =
        "Fix the editor's geometry or input errors before searching.";
      return;
    }
    clearValidation();
    releaseControls();
    car.speed = 0;
    const controller = new AbortController();
    searchController = controller;
    $("validate-level").disabled = true;
    $("cancel-solver").hidden = false;
    $("solver-status").dataset.state = "searching";
    $("solver-status").textContent =
      "Searching forward and reverse maneuvers...";
    let progressAt = 0;
    try {
      const result = await window.ParkingSolver.solve(sceneLevel(), {
        signal: controller.signal,
        onProgress: ({ expanded }) => {
          if (
            searchController === controller &&
            performance.now() - progressAt > 200
          ) {
            $("solver-status").textContent =
              `Searching... ${expanded.toLocaleString()} positions explored.`;
            progressAt = performance.now();
          }
        },
      });
      if (searchController !== controller) return;
      $("solver-status").dataset.state = result.status;
      if (result.status === "solved") {
        solution = result;
        $("solver-status").textContent =
          `Solvable in this model${towCount ? " after towing" : ""}. Verified ${result.distance.toFixed(1)} m route using 8 cm safety padding at samples. ${result.expanded.toLocaleString()} positions explored.`;
        $("route-controls").hidden = false;
        $("route-toggle").checked = false;
        $("route-position").max = result.path.length - 1;
        $("route-position").value = 0;
        $("route-progress").textContent = "0%";
      } else {
        const label =
          result.status === "invalid"
            ? "Invalid layout"
            : result.status === "cancelled"
              ? "Cancelled"
              : "Inconclusive";
        $("solver-status").textContent = `${label}. ${result.message}`;
      }
    } catch (_) {
      if (searchController === controller) {
        $("solver-status").dataset.state = "inconclusive";
        $("solver-status").textContent =
          "Inconclusive. The search could not finish. Try again or simplify the layout.";
      }
    } finally {
      if (searchController === controller) {
        searchController = null;
        $("validate-level").disabled = false;
        $("cancel-solver").hidden = true;
      }
    }
  }

  function reset() {
    clearValidation();
    attemptLevel = clone(activeLevel);
    selectingTow = false;
    towTarget = towMission = null;
    towCount = 0;
    humanReactions.clear();
    car = { ...physics.createCar(activeLevel.start), color: "#b7dbbd" };
    elapsed = contacts = hold = impactTimer = 0;
    won = started = false;
    keys.clear();
    document
      .querySelectorAll("[data-key]")
      .forEach((button) => button.classList.remove("active"));
    ui.success.hidden = true;
    updateTowUI();
  }

  function step(dt) {
    for (const [human, remaining] of humanReactions) {
      if (remaining <= dt) humanReactions.delete(human);
      else humanReactions.set(human, remaining - dt);
    }
    if (won || editing || searchController) return;
    if (towMission) {
      const previous = towMission.elapsed;
      towMission.elapsed += dt;
      elapsed += dt;
      if (
        previous < window.ParkingHelicopter.liftAt &&
        towMission.elapsed >= window.ParkingHelicopter.liftAt
      ) {
        attemptLevel.obstacles = attemptLevel.obstacles.filter(
          (body) => body !== towMission.target,
        );
      }
      if (towMission.elapsed >= window.ParkingHelicopter.duration) {
        towMission = null;
        releaseControls();
        updateTowUI();
      }
      return;
    }
    if (selectingTow) return;
    impactTimer = Math.max(0, impactTimer - dt);
    const steering =
      Number(keys.has("ArrowRight")) - Number(keys.has("ArrowLeft"));
    car.steer = clamp(
      car.steer + steering * config.steerRate * dt,
      -config.maxSteer,
      config.maxSteer,
    );
    const throttle =
      Number(keys.has("ArrowUp")) - Number(keys.has("ArrowDown"));
    if (throttle || steering) started = true;
    if (started) elapsed += dt;
    car.speed = keys.has("Space") ? 0 : throttle * config.driveSpeed;
    const previous = { ...car };
    move(car, car.speed * dt);
    if (collision(car)) {
      // Test the attempted pose before collision handling moves the car back.
      for (const obstacle of attemptLevel.obstacles) {
        if (obstacle.kind === "human" && physics.overlaps(car, obstacle))
          humanReactions.set(obstacle, 2.5);
      }
      Object.assign(car, {
        x: previous.x,
        y: previous.y,
        angle: previous.angle,
        speed: 0,
      });
      if (impactTimer === 0) contacts++;
      impactTimer = 0.85;
    }
    hold =
      isParked(car, activeLevel.bay) && Math.abs(car.speed) < 0.08
        ? hold + dt
        : 0;
    if (hold > 1.2) {
      won = true;
      car.speed = 0;
      ui.result.textContent = `${formatTime(elapsed)} elapsed · ${contacts} contact${contacts === 1 ? "" : "s"}${towCount ? ` · ${towCount} tow${towCount === 1 ? "" : "s"} (+${formatTime(towCount * 300)})` : ""} · Parked with care.`;
      ui.success.hidden = false;
      keys.clear();
      updateTowUI();
    }
  }

  function rect(x, y, w, h, color, radius = 0) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius);
    ctx.fill();
  }

  function line(x1, y1, x2, y2, color, width = 0.035) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  function text(value, x, y, size, color, align = "center") {
    ctx.fillStyle = color;
    ctx.font = `500 ${size}px "DM Sans", sans-serif`;
    ctx.textAlign = align;
    ctx.fillText(value, x, y);
  }

  function tree(x, y, radius) {
    ctx.fillStyle = "#182c2440";
    ctx.beginPath();
    ctx.ellipse(
      x + 0.45,
      y + 0.4,
      radius * 1.1,
      radius * 0.9,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    for (const [dx, dy, r, color] of [
      [0, 0, 1, "#445c41"],
      [-0.32, -0.15, 0.68, "#536c49"],
      [0.32, -0.25, 0.57, "#607951"],
      [0.05, 0.33, 0.57, "#4b6645"],
      [-0.25, -0.4, 0.4, "#708359"],
    ]) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x + dx * radius, y + dy * radius, r * radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawCar(body, playable = false) {
    ctx.save();
    ctx.translate(body.x, body.y);
    ctx.rotate(body.angle);
    ctx.scale(body.length / config.length, body.width / config.carWidth);
    const l = config.length,
      w = config.carWidth;
    rect(-l / 2 + 0.12, -w / 2 + 0.14, l, w, "#15241d60", 0.22);
    for (const x of [-config.wheelbase / 2, config.wheelbase / 2]) {
      for (const y of [-w / 2, w / 2]) {
        ctx.save();
        ctx.translate(x, y);
        if (playable && x > 0) ctx.rotate(body.steer);
        rect(-0.34, -0.13, 0.68, 0.26, "#17231f", 0.06);
        ctx.restore();
      }
    }
    rect(-l / 2, -w / 2, l, w, body.color, 0.24);
    rect(-l / 2 + 0.12, -w / 2 + 0.13, l - 0.24, w - 0.26, "#ffffff12", 0.18);
    rect(-1.08, -w / 2 + 0.17, 2.25, w - 0.34, "#2b403c", 0.25);
    rect(-0.65, -w / 2 + 0.2, 1.2, w - 0.4, body.color, 0.16);
    line(0.87, -0.57, 1.01, 0.54, "#a6c2b54a", 0.06);
    line(-0.99, -0.5, -0.91, 0.5, "#a6c2b53a", 0.05);
    line(1.47, -0.65, 1.47, 0.65, "#203e2e26", 0.025);
    line(-1.55, -0.66, -1.55, 0.66, "#203e2e26", 0.025);
    for (const y of [-w / 2 + 0.13, w / 2 - 0.37]) {
      rect(l / 2 - 0.16, y, 0.12, 0.24, "#eff3c9", 0.03);
      rect(
        -l / 2 + 0.04,
        y,
        0.09,
        0.24,
        playable &&
          (keys.has("Space") ||
            car.speed *
              (Number(keys.has("ArrowUp")) - Number(keys.has("ArrowDown"))) <
              0)
          ? "#ff6d59"
          : "#a76f61",
        0.025,
      );
    }
    rect(0.63, -w / 2 - 0.12, 0.26, 0.18, body.color, 0.04);
    rect(0.63, w / 2 - 0.06, 0.26, 0.18, body.color, 0.04);
    if (playable) {
      ctx.fillStyle = "#496953";
      ctx.beginPath();
      ctx.moveTo(0.05, -0.15);
      ctx.lineTo(0.28, 0);
      ctx.lineTo(0.05, 0.15);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  function drawPath() {
    if (!assist || won || editing || selectingTow || towMission) return;
    const ghost = { ...car };
    const direction = car.speed < -0.01 || keys.has("ArrowDown") ? -1 : 1;
    ctx.save();
    ctx.setLineDash([0.13, 0.15]);
    ctx.lineWidth = 0.035;
    ctx.strokeStyle = "#c6e3b96b";
    ctx.beginPath();
    ctx.moveTo(car.x, car.y);
    for (let i = 0; i < 45; i++) {
      move(ghost, direction * 0.12);
      if (collision(ghost)) break;
      ctx.lineTo(ghost.x, ghost.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.23;
    const points = corners(ghost);
    ctx.beginPath();
    points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  function drawObstacle(body) {
    if (body.kind === "car") {
      drawCar(body);
      return;
    }
    ctx.save();
    ctx.translate(body.x, body.y);
    ctx.rotate(body.angle);
    if (body.kind === "human") {
      ctx.scale(body.length, body.width);
      // A static top-down person inside the same rectangular collision footprint.
      rect(-0.5, -0.5, 1, 1, "#eed7af28", 0.18);
      rect(-0.38, -0.29, 0.4, 0.19, "#263e38", 0.08);
      rect(-0.38, 0.1, 0.4, 0.19, "#263e38", 0.08);
      rect(-0.23, -0.44, 0.42, 0.88, body.color || "#d89a66", 0.18);
      rect(0.09, -0.44, 0.23, 0.18, "#e6bc91", 0.08);
      rect(0.09, 0.26, 0.23, 0.18, "#e6bc91", 0.08);
      ctx.fillStyle = "#e6bc91";
      ctx.beginPath();
      ctx.arc(0.12, 0, 0.24, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#493e34";
      ctx.beginPath();
      ctx.arc(0.07, 0, 0.2, Math.PI / 2, Math.PI * 1.5);
      ctx.fill();
      ctx.restore();
      return;
    }
    rect(
      -body.length / 2 + 0.1,
      -body.width / 2 + 0.1,
      body.length,
      body.width,
      "#18271e55",
      0.08,
    );
    rect(
      -body.length / 2,
      -body.width / 2,
      body.length,
      body.width,
      body.color || "#a99880",
      0.08,
    );
    ctx.strokeStyle = "#e2d8ba88";
    ctx.lineWidth = 0.05;
    ctx.strokeRect(-body.length / 2, -body.width / 2, body.length, body.width);
    ctx.restore();
  }

  function drawHumanReactions() {
    const unit = Math.max(1, 20 / scale);
    const w = 4.6 * unit,
      h = 1.3 * unit,
      radius = 0.3 * unit;
    for (const [human, remaining] of humanReactions) {
      const top =
        human.y -
        (Math.abs(Math.sin(human.angle)) * human.length +
          Math.abs(Math.cos(human.angle)) * human.width) /
          2;
      const x = clamp(human.x, w / 2 + 0.1, config.width - w / 2 - 0.1);
      const y = Math.max(0.1, top - h - 0.35 * unit);
      ctx.save();
      ctx.globalAlpha = Math.min(1, remaining / 0.6);
      ctx.translate(x, y);
      ctx.fillStyle = "#fff0d5";
      ctx.strokeStyle = "#b75439";
      ctx.lineWidth = 0.055 * unit;
      ctx.beginPath();
      ctx.moveTo(-w / 2 + radius, 0);
      ctx.lineTo(w / 2 - radius, 0);
      ctx.quadraticCurveTo(w / 2, 0, w / 2, radius);
      ctx.lineTo(w / 2, h - radius);
      ctx.quadraticCurveTo(w / 2, h, w / 2 - radius, h);
      ctx.lineTo(0.25 * unit, h);
      ctx.lineTo(clamp(human.x - x, -w / 2, w / 2), h + 0.3 * unit);
      ctx.lineTo(-0.25 * unit, h);
      ctx.lineTo(-w / 2 + radius, h);
      ctx.quadraticCurveTo(-w / 2, h, -w / 2, h - radius);
      ctx.lineTo(-w / 2, radius);
      ctx.quadraticCurveTo(-w / 2, 0, -w / 2 + radius, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      text("Arey Prateek!!!", 0, 0.82 * unit, 0.48 * unit, "#903f2f");
      ctx.restore();
    }
  }

  function drawVerifiedRoute() {
    if (!solution || !$("route-toggle").checked) return;
    ctx.save();
    ctx.strokeStyle = "#f2d68fc0";
    ctx.lineWidth = 0.065;
    ctx.setLineDash([0.16, 0.09]);
    ctx.beginPath();
    solution.path.forEach((point, index) =>
      index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y),
    );
    ctx.stroke();
    ctx.setLineDash([]);
    const point = solution.path[Number($("route-position").value)];
    ctx.globalAlpha = 0.7;
    drawCar({ ...physics.createCar(point), ...point, color: "#e8ce8c" }, true);
    ctx.restore();
  }

  function render() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, viewWidth, viewHeight);
    ctx.fillStyle = "#414b44";
    ctx.fillRect(0, 0, viewWidth, viewHeight);
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);
    rect(0, 0, 30, 20, "#444e47");
    // Deterministic asphalt grain, without image assets or network dependencies.
    for (let i = 0; i < 1100; i++) {
      const x = ((i * 7919) % 3000) / 100,
        y = ((i * 6271) % 2000) / 100;
      rect(x, y, 0.022, 0.022, i % 2 ? "#ffffff0b" : "#00000010");
    }
    const bounds = activeLevel.bounds;
    rect(0, 0, 30, bounds.minY, "#87917b");
    rect(0, 0, 30, 1.4, "#738469");
    for (let x = 0; x < 30; x += 1.4) {
      line(x, 1.45, x, 3.45, "#697760", 0.025);
      line(x, 2.5, x + 1.4, 2.5, "#75836c", 0.025);
    }
    rect(0, bounds.minY - 0.19, 30, 0.19, "#b9bfac");
    rect(0, bounds.maxY, 30, 20 - bounds.maxY, "#7b896e");
    rect(0, bounds.maxY, 30, 0.15, "#b1baa2");
    rect(0, bounds.minY, bounds.minX, bounds.maxY - bounds.minY, "#788669");
    rect(
      bounds.maxX,
      bounds.minY,
      30 - bounds.maxX,
      bounds.maxY - bounds.minY,
      "#788669",
    );
    rect(
      bounds.minX - 0.16,
      bounds.minY,
      0.16,
      bounds.maxY - bounds.minY,
      "#a9b29b",
    );
    rect(bounds.maxX, bounds.minY, 0.16, bounds.maxY - bounds.minY, "#a9b29b");
    if (editing) {
      for (let x = Math.ceil(bounds.minX); x < bounds.maxX; x++)
        line(x, bounds.minY, x, bounds.maxY, "#d4dec314", 0.02);
      for (let y = Math.ceil(bounds.minY); y < bounds.maxY; y++)
        line(bounds.minX, y, bounds.maxX, y, "#d4dec314", 0.02);
    }
    const bay = activeLevel.bay;
    ctx.save();
    ctx.translate(bay.x, bay.y);
    ctx.rotate(bay.angle);
    rect(
      -bay.length / 2,
      -bay.width / 2,
      bay.length,
      bay.width,
      "#c2da9120",
      0.08,
    );
    ctx.strokeStyle = hold > 0 ? "#e3f5b4" : "#c6db94";
    ctx.lineWidth = 0.055;
    ctx.setLineDash([0.27, 0.19]);
    ctx.strokeRect(-bay.length / 2, -bay.width / 2, bay.length, bay.width);
    ctx.setLineDash([]);
    text("P", 0, 0.31, 0.87, "#d7e7b27a");
    text("YOUR SPACE", 0, bay.width / 2 + 0.5, 0.25, "#d0dda7");
    ctx.restore();
    for (const x of [4.3, 25.5]) {
      rect(x, 2.05, 1.7, 0.45, "#4d5d45", 0.08);
      for (let j = 0; j < 3; j++)
        line(
          x + 0.1,
          2.1 + j * 0.12,
          x + 1.6,
          2.1 + j * 0.12,
          "#a6a38a",
          0.075,
        );
    }
    drawPath();
    sceneLevel().obstacles.forEach(drawObstacle);
    if (selectingTow) {
      sceneLevel()
        .obstacles.filter((body) => body.kind === "car")
        .forEach((body, index) => {
          ctx.save();
          ctx.translate(body.x, body.y);
          ctx.rotate(body.angle);
          ctx.strokeStyle = body === towTarget ? "#fff2a8" : "#f2d68f99";
          ctx.lineWidth = body === towTarget ? 0.12 : 0.05;
          ctx.strokeRect(
            -body.length / 2 - 0.15,
            -body.width / 2 - 0.15,
            body.length + 0.3,
            body.width + 0.3,
          );
          ctx.restore();
          rect(body.x - 0.32, body.y - 0.32, 0.64, 0.64, "#f2d68f", 0.15);
          text(String(index + 1), body.x, body.y + 0.14, 0.38, "#20362e");
        });
    }
    drawCar(car, true);
    drawVerifiedRoute();
    if (editing && editor?.selectedBody()) {
      const body = editor.selectedBody();
      ctx.save();
      ctx.translate(body.x, body.y);
      ctx.rotate(body.angle);
      ctx.strokeStyle = "#f8df9e";
      ctx.lineWidth = 0.065;
      ctx.setLineDash([0.16, 0.1]);
      ctx.strokeRect(
        -body.length / 2 - 0.12,
        -body.width / 2 - 0.12,
        body.length + 0.24,
        body.width + 0.24,
      );
      ctx.restore();
    }
    if (impactTimer > 0) {
      const points = corners(car);
      ctx.strokeStyle = "#eca688";
      ctx.lineWidth = 0.075;
      ctx.beginPath();
      points.forEach((p, i) =>
        i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y),
      );
      ctx.closePath();
      ctx.stroke();
    }
    tree(2.2, 1.12, 1.25);
    tree(11, 0.65, 1.12);
    tree(21.6, 0.7, 1.2);
    tree(28.3, 1.15, 1.45);
    tree(0.25, 9.4, 1.05);
    tree(29.9, 12.6, 1.1);
    tree(2.5, 19.6, 1.05);
    tree(26.8, 19.7, 1.4);
    text("THE COURTYARD", 15, 1.02, 0.27, "#dbe1c885");
    drawHumanReactions();
    if (towMission) window.ParkingHelicopter.draw(ctx, towMission, drawCar);
    $("elapsed").textContent = formatTime(elapsed);
    $("tow-penalty").textContent = towCount
      ? `Includes +${formatTime(towCount * 300)} towing`
      : "No tow penalties";
    ui.speed.textContent = (Math.abs(car.speed) * 3.6).toFixed(1);
    ui.gear.textContent =
      car.speed > 0.02 ? "D" : car.speed < -0.02 ? "R" : "N";
    ui.angle.textContent = `${Math.round((car.steer * 180) / Math.PI)}°`;
    ui["steer-marker"].style.left =
      `${50 + (car.steer / config.maxSteer) * 50}%`;
    ui.status.textContent = towMission
      ? "Helicopter towing..."
      : selectingTow
        ? "Select a parked car"
        : editing
          ? "Editing layout"
          : searchController
            ? "Checking route..."
            : won
              ? "Perfectly parked"
              : impactTimer > 0
                ? humanReactions.size
                  ? "Watch out! Give people space."
                  : "Contact. Ease away."
                : hold > 0
                  ? "Hold it there…"
                  : keys.has("Space")
                    ? "Braking"
                    : Math.abs(car.speed) > 0.08
                      ? "Take your time"
                      : "Ready when you are";
    ui["status-dot"].style.background = impactTimer > 0 ? "#e5a183" : "#bfd895";
  }

  function resize() {
    const bounds = canvas.getBoundingClientRect();
    viewWidth = bounds.width;
    viewHeight = bounds.height;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(viewWidth * dpr);
    canvas.height = Math.round(viewHeight * dpr);
    scale = Math.min(viewWidth / config.width, viewHeight / config.height);
    offsetX = (viewWidth - config.width * scale) / 2;
    offsetY = (viewHeight - config.height * scale) / 2;
  }
  const drivingKeys = [
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "Space",
  ];
  window.addEventListener("keydown", (event) => {
    if (event.code === "Escape" && selectingTow) {
      event.preventDefault();
      toggleTowSelection();
      return;
    }
    if (
      editing ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.target.closest(
        "input, select, textarea, summary, a, [contenteditable='true']",
      )
    )
      return;
    if (event.target instanceof HTMLButtonElement && event.code === "Space")
      return;
    if (drivingKeys.includes(event.code)) {
      event.preventDefault();
      if (selectingTow || towMission) return;
      if (searchController) clearValidation();
      keys.add(event.code);
    }
    if (event.code === "KeyR" && !event.repeat) reset();
    if (event.code === "KeyP" && !event.repeat) toggleAssist();
  });
  window.addEventListener("keyup", (event) => {
    keys.delete(event.code);
  });
  function releaseControls() {
    keys.clear();
    if (car) car.speed = 0;
    document
      .querySelectorAll("[data-key]")
      .forEach((button) => button.classList.remove("active"));
  }
  window.addEventListener("blur", releaseControls);
  document.addEventListener("focusin", (event) => {
    if (
      event.target.closest("input, select, textarea, [contenteditable='true']")
    )
      releaseControls();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) releaseControls();
  });
  document.querySelectorAll("[data-key]").forEach((button) => {
    button.addEventListener("pointerdown", (event) => {
      if (editing || selectingTow || towMission) return;
      event.preventDefault();
      if (searchController) clearValidation();
      button.setPointerCapture(event.pointerId);
      keys.add(button.dataset.key);
      button.classList.add("active");
    });
    const release = () => {
      keys.delete(button.dataset.key);
      button.classList.remove("active");
    };
    button.addEventListener("pointerup", release);
    button.addEventListener("pointercancel", release);
    button.addEventListener("lostpointercapture", release);
  });
  function toggleAssist() {
    assist = !assist;
    ui.guide.setAttribute("aria-pressed", String(assist));
    ui.guide.querySelector("span").textContent = assist ? "ON" : "OFF";
  }
  ui.guide.addEventListener("click", () => {
    toggleAssist();
    canvas.focus({ preventScroll: true });
  });
  for (const id of ["reset", "again"])
    document.getElementById(id).addEventListener("click", () => {
      reset();
      canvas.focus({ preventScroll: true });
    });
  $("level-select").addEventListener("change", (event) => {
    const level = allLevels().find((item) => item.id === event.target.value);
    if (level) loadLevel(level);
  });
  $("previous-level").addEventListener("click", () => navigateLevel(-1));
  $("next-level").addEventListener("click", () => navigateLevel(1));
  $("success-next").addEventListener("click", () => navigateLevel(1));
  $("edit-level").addEventListener("click", () => beginEdit(false));
  $("new-level").addEventListener("click", () => beginEdit(true));
  $("tow").addEventListener("click", toggleTowSelection);
  $("dispatch-tow").addEventListener("click", dispatchTow);
  $("tow-target").addEventListener("change", (event) => {
    const cars = attemptLevel.obstacles.filter((body) => body.kind === "car");
    towTarget =
      event.target.value === "" ? null : cars[Number(event.target.value)];
    updateTowUI();
  });
  canvas.addEventListener("pointerdown", (event) => {
    if (!selectingTow || event.button !== 0) return;
    const point = toWorld(event.clientX, event.clientY);
    towTarget =
      [...attemptLevel.obstacles].reverse().find((body) => {
        if (body.kind !== "car") return false;
        const dx = point.x - body.x,
          dy = point.y - body.y;
        const c = Math.cos(body.angle),
          s = Math.sin(body.angle);
        return (
          Math.abs(dx * c + dy * s) <= body.length / 2 &&
          Math.abs(-dx * s + dy * c) <= body.width / 2
        );
      }) || null;
    event.preventDefault();
    updateTowUI();
  });
  $("validate-level").addEventListener("click", runValidation);
  $("cancel-solver").addEventListener("click", () => searchController?.abort());
  $("route-position").addEventListener("input", () => {
    const range = $("route-position");
    $("route-progress").textContent =
      `${Math.round((Number(range.value) / Math.max(1, Number(range.max))) * 100)}%`;
  });
  editor = window.ParkingEditor.create({
    canvas,
    container: $("editor-panel"),
    toWorld,
    onChange: (draft) => {
      if (!draft.id.startsWith("custom-"))
        draft.id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      activeLevel = draft;
      reset();
      updateLevelUI();
      $("validate-level").disabled = !editor.isValid();
    },
    onPlay: loadLevel,
    onCancel: () => loadLevel(beforeEdit),
    onSave: saveCustomLevel,
  });
  new ResizeObserver(resize).observe(canvas);
  reset();
  updateLevelUI();
  resize();
  let last = performance.now(),
    accumulator = 0;
  function frame(now) {
    // Fixed 120 Hz integration prevents frame-rate-dependent steering and tunneling.
    accumulator += Math.min((now - last) / 1000, 0.05);
    last = now;
    while (accumulator >= 1 / 120) {
      step(1 / 120);
      accumulator -= 1 / 120;
    }
    render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
