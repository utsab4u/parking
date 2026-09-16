(() => {
  "use strict";

  class MinHeap {
    constructor() {
      this.items = [];
    }
    push(node) {
      const items = this.items;
      let i = items.length;
      items.push(node);
      while (i > 0) {
        const parent = (i - 1) >> 1;
        if (items[parent].priority <= node.priority) break;
        items[i] = items[parent];
        i = parent;
      }
      items[i] = node;
    }
    pop() {
      const items = this.items,
        first = items[0],
        last = items.pop();
      if (items.length) {
        let i = 0;
        while (2 * i + 1 < items.length) {
          let child = 2 * i + 1;
          if (
            child + 1 < items.length &&
            items[child + 1].priority < items[child].priority
          )
            child++;
          if (items[child].priority >= last.priority) break;
          items[i] = items[child];
          i = child;
        }
        items[i] = last;
      }
      return first;
    }
  }

  /** Find a conservative geometric route; steering transitions require stationary pauses. */
  async function solve(
    level,
    { signal, onProgress, maxNodes = 50000, timeLimitMs = 12000 } = {},
  ) {
    const started = performance.now();
    let expanded = 0;
    const result = (status, message, extra = {}) => ({
      status,
      message,
      expanded,
      durationMs: performance.now() - started,
      distance: 0,
      ...extra,
    });
    const cancelled = () => signal && signal.aborted;
    if (cancelled()) return result("cancelled", "Search cancelled.");
    const physics = window.ParkingPhysics;
    if (!physics)
      return result("invalid", "Load parking-core.js before solving.");
    if (
      !Number.isInteger(maxNodes) ||
      maxNodes < 1 ||
      !Number.isFinite(timeLimitMs) ||
      timeLimitMs <= 0
    ) {
      return result(
        "invalid",
        "Search budgets must be finite and positive; maxNodes must be an integer.",
      );
    }

    // Own all geometry for the duration of the asynchronous search.
    let snapshot;
    try {
      const validation = physics.validateLevel(level);
      if (!validation.valid)
        return result("invalid", validation.errors.join(" "));
      const shape = (body) => ({
        x: body.x,
        y: body.y,
        angle: body.angle,
        length: body.length,
        width: body.width,
      });
      snapshot = {
        start: { x: level.start.x, y: level.start.y, angle: level.start.angle },
        bay: shape(level.bay),
        bounds: {
          minX: level.bounds.minX,
          maxX: level.bounds.maxX,
          minY: level.bounds.minY,
          maxY: level.bounds.maxY,
        },
        obstacles: level.obstacles.map((body) => ({
          ...shape(body),
          kind: body.kind,
        })),
      };
      const validationCopy = physics.validateLevel(snapshot);
      if (!validationCopy.valid)
        return result("invalid", validationCopy.errors.join(" "));
    } catch (_) {
      return result("invalid", "Level data could not be copied safely.");
    }
    const { constants, createCar, collision, move, isParked } = physics;
    const start = createCar(snapshot.start);
    start.angle = Math.atan2(Math.sin(start.angle), Math.cos(start.angle));
    const clearance = 0.08,
      sampleDistance = 0.04,
      primitiveSamples = 15;
    // At maximum curvature each footprint point travels < 1.6 times center distance.
    // The 8 cm inflation therefore covers each entire 4 cm integration interval.
    if (collision(start, snapshot, clearance)) {
      return result(
        "inconclusive",
        "Start lacks the solver's 0.08 m safety clearance.",
      );
    }

    const point = (body) => ({
      x: body.x,
      y: body.y,
      angle: body.angle,
      steer: body.steer,
    });
    if (isParked(start, snapshot.bay))
      return result("solved", "Start is already parked.", {
        path: [point(start)],
      });
    const bay = snapshot.bay,
      bc = Math.cos(bay.angle),
      bs = Math.sin(bay.angle);
    const slackX = (bay.length - constants.length) / 2 - 0.06;
    const slackY = (bay.width - constants.carWidth) / 2 - 0.06;
    const heuristic = (body) => {
      const dx = body.x - bay.x,
        dy = body.y - bay.y;
      const longitudinal = Math.max(0, Math.abs(dx * bc + dy * bs) - slackX);
      const lateral = Math.max(0, Math.abs(-dx * bs + dy * bc) - slackY);
      const delta = body.angle - bay.angle;
      const alignment =
        Math.abs(Math.atan2(Math.sin(2 * delta), Math.cos(2 * delta))) / 2;
      // Deliberately weighted, not an optimality claim. Lateral error encourages setup turns.
      return (
        Math.hypot(longitudinal, lateral) + 1.3 * lateral + 1.5 * alignment
      );
    };
    const key = (body) => {
      const heading =
        ((Math.round(body.angle / (Math.PI / 24)) % 48) + 48) % 48;
      return (
        (Math.round(body.x / 0.3) * 70 + Math.round(body.y / 0.3)) * 48 +
        heading
      );
    };
    const open = new MinHeap(),
      best = new Map();
    const root = {
      body: start,
      parent: null,
      g: 0,
      priority: 2.4 * heuristic(start),
      key: key(start),
      samples: 0,
    };
    open.push(root);
    best.set(root.key, root);
    const steers = [
      0,
      -constants.maxSteer / 2,
      constants.maxSteer / 2,
      -constants.maxSteer,
      constants.maxSteer,
    ];
    let batchStart = performance.now();
    const yieldBatch = async () => {
      if (typeof onProgress === "function") {
        // UI callbacks must not be able to damage search state or abort the promise.
        try {
          onProgress({
            expanded,
            frontier: open.items.length,
            durationMs: performance.now() - started,
          });
        } catch (_) {
          /* Observer only. */
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
      batchStart = performance.now();
    };
    const stop = () => {
      if (cancelled()) return result("cancelled", "Search cancelled.");
      if (performance.now() - started >= timeLimitMs)
        return result(
          "inconclusive",
          "Time budget reached; no safe route was confirmed.",
        );
      return null;
    };

    async function finish(goal) {
      const segments = [];
      for (let node = goal; node.parent; node = node.parent)
        segments.push(node);
      segments.reverse();
      const body = createCar(snapshot.start);
      body.angle = start.angle;
      const path = [point(body)];
      let distance = 0;
      for (const segment of segments) {
        if (body.steer !== segment.body.steer) {
          body.steer = segment.body.steer;
          path.push(point(body));
        }
        for (let i = 0; i < segment.samples; i++) {
          move(body, segment.direction * sampleDistance);
          if (collision(body, snapshot, clearance))
            return result(
              "inconclusive",
              "Route verification failed; no route returned.",
            );
          path.push(point(body));
          distance += sampleDistance;
          if (performance.now() - batchStart >= 8) await yieldBatch();
          const stopped = stop();
          if (stopped) return stopped;
        }
      }
      if (!isParked(body, bay))
        return result(
          "inconclusive",
          "Endpoint verification failed; no route returned.",
        );
      return result(
        "solved",
        "Safe route found. Pause at steering transitions before moving.",
        { path, distance },
      );
    }

    while (open.items.length) {
      const stopped = stop();
      if (stopped) return stopped;
      if (expanded >= maxNodes)
        return result(
          "inconclusive",
          "Node budget reached; no safe route was confirmed.",
        );
      if (performance.now() - batchStart >= 8) {
        await yieldBatch();
        continue;
      }
      const current = open.pop();
      if (best.get(current.key) !== current) continue;
      expanded++;
      for (const direction of [1, -1]) {
        for (const steer of steers) {
          const body = { ...current.body, steer };
          let safe = true;
          for (let sample = 1; sample <= primitiveSamples; sample++) {
            move(body, direction * sampleDistance);
            if (collision(body, snapshot, clearance)) {
              safe = false;
              break;
            }
            if (isParked(body, bay)) {
              return finish({
                body,
                parent: current,
                direction,
                samples: sample,
              });
            }
          }
          if (!safe) continue;
          const stateKey = key(body);
          const g =
            current.g +
            primitiveSamples *
              sampleDistance *
              (1 +
                (direction < 0 ? 0.04 : 0) +
                (0.03 * Math.abs(steer)) / constants.maxSteer);
          const previous = best.get(stateKey);
          if (previous && previous.g <= g + 1e-9) continue;
          const next = {
            body,
            parent: current,
            direction,
            samples: primitiveSamples,
            g,
            key: stateKey,
            priority: g + 2.4 * heuristic(body),
          };
          best.set(stateKey, next);
          open.push(next);
        }
      }
    }
    return result(
      "inconclusive",
      "Discretized search exhausted; this does not establish that parking is impossible.",
    );
  }

  window.ParkingSolver = Object.freeze({ solve });
})();
