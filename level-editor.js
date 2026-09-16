(() => {
  "use strict";

  const metadataLimits = {
    id: 120,
    name: 80,
    difficulty: 40,
    description: 1000,
    hint: 1000,
  };
  const degrees = (angle) => ((angle % 360) + 360) % 360;
  const clone = (value) => JSON.parse(JSON.stringify(value));

  function create({
    canvas,
    container,
    toWorld,
    onChange,
    onPlay,
    onCancel,
    onSave,
  }) {
    const physics = window.ParkingPhysics;
    let draft = null;
    let active = false;
    let selected = "start";
    let drag = null;
    let revision = 0;
    const inputErrors = new Map();
    container.classList.add("parking-editor");
    container.hidden = true;
    container.innerHTML = `
      <header class="editor-header">
        <p class="eyebrow">YOUR OWN PRACTICE SPACE</p>
        <h2>Layout editor</h2>
        <p>Choose an object or drag it on the lot. Positions snap to 0.1 m.</p>
      </header>
      <label class="editor-field">Layout name
        <input data-field="name" type="text" maxlength="80" autocomplete="off" required>
      </label>
      <label class="editor-field">Selected object
        <select data-field="selection"></select>
      </label>
      <div class="editor-grid">
        <label class="editor-field">X (m)<input data-field="x" type="number" step="any" required></label>
        <label class="editor-field">Y (m)<input data-field="y" type="number" step="any" required></label>
        <label class="editor-field editor-wide">Heading (degrees)<input data-field="angle" type="number" step="any" required></label>
        <label class="editor-field">Length (m)<input data-field="length" type="number" min="0.01" step="any" required></label>
        <label class="editor-field">Width (m)<input data-field="width" type="number" min="0.01" step="any" required></label>
      </div>
      <div class="editor-actions" role="group" aria-label="Rotate selected object">
        <button type="button" data-action="rotate-left">Rotate left 45&deg;</button>
        <button type="button" data-action="rotate-right">Rotate right 45&deg;</button>
      </div>
      <p class="editor-help">Click an object to select it, then rotate it in 45-degree steps. The playable car has fixed dimensions. Parked cars, blocks, and the bay can be resized. Heading 0 points right; 90 points down.</p>
      <div class="editor-actions">
        <button type="button" data-action="car">Add parked car</button>
        <button type="button" data-action="block">Add block</button>
        <button type="button" data-action="delete" class="editor-wide">Delete selected obstacle</button>
      </div>
      <div class="editor-validation" aria-live="polite" aria-atomic="true"></div>
      <div class="editor-actions editor-primary-actions">
        <button type="button" data-action="play" class="editor-primary">Play layout</button>
        <button type="button" data-action="save" class="editor-primary">Save locally</button>
        <button type="button" data-action="export">Export JSON</button>
        <button type="button" data-action="import">Import JSON</button>
        <button type="button" data-action="cancel" class="editor-wide">Cancel</button>
      </div>
      <input data-field="file" type="file" accept=".json,application/json" hidden aria-label="Import layout JSON">
      <p class="editor-message" role="status" aria-live="polite" aria-atomic="true"></p>
      <p class="editor-help">Nothing is saved until you choose Save locally. JSON imports must be valid and at most 100 KB.</p>`;

    const fields = Object.fromEntries(
      Array.from(container.querySelectorAll("[data-field]"), (element) => [
        element.dataset.field,
        element,
      ]),
    );
    const buttons = Object.fromEntries(
      Array.from(container.querySelectorAll("[data-action]"), (element) => [
        element.dataset.action,
        element,
      ]),
    );
    const validation = container.querySelector(".editor-validation");
    const message = container.querySelector(".editor-message");

    function selectedObject() {
      if (!draft) return null;
      return selected === "start"
        ? draft.start
        : selected === "bay"
          ? draft.bay
          : draft.obstacles.find((obstacle) => obstacle.id === selected);
    }

    function selectedBody() {
      if (!active) return null;
      const body = selectedObject();
      return selected === "start" ? physics.createCar(body) : body;
    }

    function feedback(text, error = false) {
      message.textContent = text;
      message.classList.toggle("is-error", error);
    }

    function metadataErrors(level) {
      return Object.entries(metadataLimits).flatMap(([key, max]) =>
        typeof level[key] !== "string" ||
        level[key].length > max ||
        (["id", "name", "difficulty"].includes(key) && !level[key].trim())
          ? [
              `${key} must be text${["id", "name", "difficulty"].includes(key) ? " (not blank)" : ""}, at most ${max} characters.`,
            ]
          : [],
      );
    }

    function errorsFor(level) {
      const result = physics.validateLevel(level);
      // Overlapping blocks can form walls; an obstructed bay is a solver question.
      return [...metadataErrors(level), ...result.errors];
    }

    function validate() {
      const errors = [...inputErrors.values(), ...errorsFor(draft)];
      validation.replaceChildren();
      validation.classList.toggle("is-error", errors.length > 0);
      if (errors.length) {
        const list = document.createElement("ul");
        for (const error of errors) {
          const item = document.createElement("li");
          item.textContent = error;
          list.append(item);
        }
        validation.append(list);
      } else {
        validation.textContent =
          "Layout geometry is valid. Use Validate from start to check for a safe route.";
      }
      buttons.play.disabled = buttons.save.disabled = errors.length > 0;
      buttons.car.disabled = buttons.block.disabled =
        draft.obstacles.length >= 40;
      return errors.length === 0;
    }

    function populate() {
      inputErrors.clear();
      const body = selectedBody();
      fields.name.value = draft.name;
      fields.selection.replaceChildren();
      const options = [
        ["start", "Start car"],
        ["bay", "Parking bay"],
        ...draft.obstacles.map((obstacle, index) => [
          obstacle.id,
          `${index + 1}. ${obstacle.kind === "car" ? "Parked car" : "Block"}`,
        ]),
      ];
      for (const [value, label] of options) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        fields.selection.append(option);
      }
      fields.selection.value = selected;
      for (const key of ["x", "y", "angle", "length", "width"]) {
        const value =
          key === "angle"
            ? degrees(((body.angle % (2 * Math.PI)) * 180) / Math.PI)
            : body[key];
        fields[key].value = String(Number(value.toFixed(6)));
        fields[key].removeAttribute("aria-invalid");
        if (key === "length" || key === "width") {
          fields[key].disabled = selected === "start";
        }
      }
      buttons.delete.disabled = selected === "start" || selected === "bay";
    }

    function changed(refresh = false) {
      revision++;
      feedback("");
      if (refresh) populate();
      validate();
      onChange(draft);
    }

    function endDrag() {
      if (!drag) return;
      const pointerId = drag.pointerId;
      drag = null;
      if (canvas.hasPointerCapture(pointerId))
        canvas.releasePointerCapture(pointerId);
    }

    function open(level) {
      endDrag();
      draft = clone(level);
      // Internal selection keys must never collide, including with imported IDs.
      draft.obstacles.forEach((obstacle, index) => {
        obstacle.id = `obstacle-${index + 1}`;
      });
      selected = "start";
      active = true;
      container.hidden = false;
      canvas.classList.add("parking-editor-canvas");
      changed(true);
    }

    function close() {
      endDrag();
      active = false;
      revision++;
      container.hidden = true;
      fields.file.value = "";
      canvas.classList.remove("parking-editor-canvas");
    }

    container.addEventListener("input", (event) => {
      if (!active) return;
      const key = event.target.dataset.field;
      if (key === "name") {
        draft.name = fields.name.value;
        changed();
      } else if (
        ["x", "y", "angle", "length", "width"].includes(key) &&
        !fields[key].disabled
      ) {
        const value = fields[key].valueAsNumber;
        const valid =
          Number.isFinite(value) &&
          (!(key === "length" || key === "width") || value > 0);
        fields[key].setAttribute("aria-invalid", String(!valid));
        if (!valid) {
          inputErrors.set(
            key,
            `${key} must be a finite${key === "length" || key === "width" ? " positive" : ""} number.`,
          );
        } else {
          inputErrors.delete(key);
          selectedObject()[key] =
            key === "angle" ? (degrees(value) * Math.PI) / 180 : value;
        }
        changed();
      }
    });

    container.addEventListener("change", (event) => {
      if (!active) return;
      if (event.target === fields.selection) {
        endDrag();
        selected = fields.selection.value;
        changed(true);
      } else if (event.target === fields.angle && !inputErrors.has("angle")) {
        fields.angle.value = String(
          Number(degrees((selectedObject().angle * 180) / Math.PI).toFixed(6)),
        );
      }
    });

    container.addEventListener("click", (event) => {
      const button = event.target.closest("[data-action]");
      if (!active || !button || button.disabled) return;
      const action = button.dataset.action;
      if (action === "rotate-left" || action === "rotate-right") {
        endDrag();
        const body = selectedObject();
        body.angle =
          (degrees(
            (body.angle * 180) / Math.PI +
              (action === "rotate-right" ? 45 : -45),
          ) *
            Math.PI) /
          180;
        changed(true);
      } else if (action === "car" || action === "block") {
        if (draft.obstacles.length >= 40) return;
        let number = 1;
        while (draft.obstacles.some((body) => body.id === `obstacle-${number}`))
          number++;
        selected = `obstacle-${number}`;
        draft.obstacles.push({
          id: selected,
          kind: action,
          x: 15,
          y: 11,
          angle: 0,
          length: action === "car" ? physics.constants.length : 3,
          width: action === "car" ? physics.constants.carWidth : 1.5,
          color: action === "car" ? "#65839b" : "#a99880",
        });
        changed(true);
      } else if (
        action === "delete" &&
        selected !== "start" &&
        selected !== "bay"
      ) {
        endDrag();
        draft.obstacles = draft.obstacles.filter(
          (body) => body.id !== selected,
        );
        selected = "start";
        changed(true);
      } else if (action === "play" && validate()) {
        onPlay(draft);
      } else if (action === "save" && validate()) {
        try {
          const result = onSave(draft);
          feedback(
            result?.message ||
              (result?.ok ? "Saved locally." : "Could not save this layout."),
            !result?.ok,
          );
        } catch (_) {
          feedback(
            "Could not save this layout. Browser storage may be unavailable or full.",
            true,
          );
        }
      } else if (action === "cancel") {
        close();
        onCancel();
      } else if (action === "import") {
        fields.file.click();
      } else if (action === "export") {
        const blob = new Blob([JSON.stringify(draft, null, 2)], {
          type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = "parking-layout.json";
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        feedback(
          "JSON exported. Invalid drafts can be exported, but cannot be played or saved.",
        );
      }
    });

    fields.file.addEventListener("change", async () => {
      const file = fields.file.files[0];
      fields.file.value = "";
      if (!active || !file) return;
      const importRevision = ++revision;
      try {
        if (file.size > 100 * 1024)
          throw new Error(
            "Import is too large. Choose a JSON file of at most 100 KB.",
          );
        const text = await file.text();
        if (!active || revision !== importRevision) return;
        const value = JSON.parse(text);
        if (!value || typeof value !== "object" || Array.isArray(value))
          throw new Error("Level must be an object.");
        const errors = errorsFor(value);
        if (errors.length) throw new Error(errors.join(" "));
        const pose = (body) => ({
          x: body.x,
          y: body.y,
          angle:
            (degrees(((body.angle % (2 * Math.PI)) * 180) / Math.PI) *
              Math.PI) /
            180,
        });
        const shape = (body) => ({
          ...pose(body),
          length: body.length,
          width: body.width,
        });
        const imported = Object.fromEntries(
          Object.keys(metadataLimits).map((key) => [key, value[key]]),
        );
        imported.start = pose(value.start);
        imported.bay = shape(value.bay);
        imported.bounds = Object.fromEntries(
          ["minX", "maxX", "minY", "maxY"].map((key) => [
            key,
            value.bounds[key],
          ]),
        );
        imported.obstacles = value.obstacles.map((body, index) => {
          if (
            typeof body.color !== "string" ||
            !/^#(?:[\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i.test(body.color)
          ) {
            throw new Error(
              `Obstacle ${index + 1} color must be a hex color, such as #65839b.`,
            );
          }
          return {
            ...shape(body),
            id: `obstacle-${index + 1}`,
            kind: body.kind,
            color: body.color,
          };
        });
        const normalizedErrors = errorsFor(imported);
        if (normalizedErrors.length)
          throw new Error(normalizedErrors.join(" "));
        open(imported);
        feedback("Layout imported as a draft. Choose Save locally to keep it.");
      } catch (error) {
        if (active && revision === importRevision) {
          feedback(
            error instanceof SyntaxError
              ? "Could not read JSON. Choose a valid layout JSON file."
              : error.message,
            true,
          );
        }
      }
    });

    canvas.addEventListener("pointerdown", (event) => {
      if (!active || drag || event.button !== 0) return;
      const point = toWorld(event.clientX, event.clientY);
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y))
        return;
      const bodies = [...draft.obstacles]
        .reverse()
        .map((body) => [body.id, body]);
      bodies.push(
        ["start", physics.createCar(draft.start)],
        ["bay", draft.bay],
      );
      const hit = bodies.find(([, body]) => {
        const dx = point.x - body.x,
          dy = point.y - body.y;
        const c = Math.cos(body.angle),
          s = Math.sin(body.angle);
        return (
          Math.abs(dx * c + dy * s) <= body.length / 2 &&
          Math.abs(-dx * s + dy * c) <= body.width / 2
        );
      });
      if (!hit) return;
      event.preventDefault();
      selected = hit[0];
      drag = {
        pointerId: event.pointerId,
        dx: point.x - hit[1].x,
        dy: point.y - hit[1].y,
      };
      canvas.setPointerCapture(event.pointerId);
      changed(true);
    });

    canvas.addEventListener("pointermove", (event) => {
      if (!active || !drag || event.pointerId !== drag.pointerId) return;
      const point = toWorld(event.clientX, event.clientY);
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y))
        return;
      event.preventDefault();
      const body = selectedBody();
      const c = Math.abs(Math.cos(body.angle)),
        s = Math.abs(Math.sin(body.angle));
      const rx = (body.length * c + body.width * s) / 2;
      const ry = (body.length * s + body.width * c) / 2;
      const bounds = draft.bounds;
      const clamp = (value, min, max) =>
        min <= max
          ? Math.min(max, Math.max(min, Math.round(value * 10) / 10))
          : (min + max) / 2;
      const target = selectedObject();
      target.x = clamp(point.x - drag.dx, bounds.minX + rx, bounds.maxX - rx);
      target.y = clamp(point.y - drag.dy, bounds.minY + ry, bounds.maxY - ry);
      changed(true);
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
      canvas.addEventListener(type, (event) => {
        if (drag && event.pointerId === drag.pointerId) endDrag();
      });
    }

    return {
      open,
      close,
      getLevel: () => draft,
      selectedBody,
      isOpen: () => active,
      isValid: () =>
        active && inputErrors.size === 0 && errorsFor(draft).length === 0,
    };
  }

  window.ParkingEditor = Object.freeze({ create });
})();
