(() => {
  "use strict";

  const constants = Object.freeze({
    wheelbase: 2.65,
    length: 4.4,
    carWidth: 1.8,
    maxSteer: (35 * Math.PI) / 180,
    steerRate: (48 * Math.PI) / 180,
    driveSpeed: 1.4,
  });

  function createCar(start) {
    return {
      x: start.x,
      y: start.y,
      angle: start.angle,
      steer: 0,
      speed: 0,
      length: constants.length,
      width: constants.carWidth,
    };
  }

  function corners(body) {
    const c = Math.cos(body.angle),
      s = Math.sin(body.angle);
    const x = body.length / 2,
      y = body.width / 2;
    return [
      { x: body.x - x * c + y * s, y: body.y - x * s - y * c },
      { x: body.x + x * c + y * s, y: body.y + x * s - y * c },
      { x: body.x + x * c - y * s, y: body.y + x * s + y * c },
      { x: body.x - x * c - y * s, y: body.y - x * s + y * c },
    ];
  }

  function overlaps(a, b) {
    // SAT expressed as projected half-extents, without allocating corner arrays.
    const ac = Math.cos(a.angle),
      as = Math.sin(a.angle);
    const bc = Math.cos(b.angle),
      bs = Math.sin(b.angle);
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const c = Math.abs(ac * bc + as * bs);
    const s = Math.abs(ac * bs - as * bc);
    return (
      Math.abs(dx * ac + dy * as) <=
        a.length / 2 + (b.length / 2) * c + (b.width / 2) * s &&
      Math.abs(-dx * as + dy * ac) <=
        a.width / 2 + (b.length / 2) * s + (b.width / 2) * c &&
      Math.abs(dx * bc + dy * bs) <=
        b.length / 2 + (a.length / 2) * c + (a.width / 2) * s &&
      Math.abs(-dx * bs + dy * bc) <=
        b.width / 2 + (a.length / 2) * s + (a.width / 2) * c
    );
  }

  function collision(body, level, clearance = 0) {
    const inflated =
      clearance === 0
        ? body
        : {
            x: body.x,
            y: body.y,
            angle: body.angle,
            length: body.length + 2 * clearance,
            width: body.width + 2 * clearance,
          };
    const c = Math.abs(Math.cos(body.angle)),
      s = Math.abs(Math.sin(body.angle));
    const rx = (inflated.length / 2) * c + (inflated.width / 2) * s;
    const ry = (inflated.length / 2) * s + (inflated.width / 2) * c;
    const bounds = level.bounds;
    if (
      body.x - rx < bounds.minX ||
      body.x + rx > bounds.maxX ||
      body.y - ry < bounds.minY ||
      body.y + ry > bounds.maxY
    )
      return true;
    return level.obstacles.some((obstacle) => overlaps(inflated, obstacle));
  }

  function move(body, signedDistance) {
    // Distance is traveled by the body center, not the rear axle.
    const beta = Math.atan(0.5 * Math.tan(body.steer));
    const yaw =
      (signedDistance * Math.cos(beta) * Math.tan(body.steer)) /
      constants.wheelbase;
    const halfYaw = yaw / 2;
    const sinc =
      Math.abs(halfYaw) < 1e-8
        ? 1 - (halfYaw * halfYaw) / 6
        : Math.sin(halfYaw) / halfYaw;
    const heading = body.angle + beta + halfYaw;
    body.x += signedDistance * sinc * Math.cos(heading);
    body.y += signedDistance * sinc * Math.sin(heading);
    body.angle = Math.atan2(
      Math.sin(body.angle + yaw),
      Math.cos(body.angle + yaw),
    );
    return body;
  }

  function isParked(body, bay) {
    const delta = body.angle - bay.angle;
    if (
      Math.abs(Math.atan2(Math.sin(2 * delta), Math.cos(2 * delta))) / 2 >
      (8 * Math.PI) / 180
    )
      return false;
    const c = Math.cos(bay.angle),
      s = Math.sin(bay.angle);
    const halfLength = bay.length / 2 - 0.06,
      halfWidth = bay.width / 2 - 0.06;
    return corners(body).every((point) => {
      const x = point.x - bay.x,
        y = point.y - bay.y;
      return (
        Math.abs(x * c + y * s) <= halfLength + 1e-10 &&
        Math.abs(-x * s + y * c) <= halfWidth + 1e-10
      );
    });
  }

  function validateLevel(level) {
    const errors = [];
    try {
      const object = (value) =>
        value !== null && typeof value === "object" && !Array.isArray(value);
      if (!object(level))
        return { valid: false, errors: ["Level must be an object."] };
      const pose = (value, label) => {
        if (
          !object(value) ||
          ![value.x, value.y, value.angle].every(Number.isFinite)
        ) {
          errors.push(`${label} must have finite x, y and angle.`);
          return false;
        }
        return true;
      };
      const shape = (value, label) => {
        const validPose = pose(value, label);
        if (
          !object(value) ||
          !Number.isFinite(value.length) ||
          value.length <= 0 ||
          !Number.isFinite(value.width) ||
          value.width <= 0
        ) {
          errors.push(`${label} must have finite positive length and width.`);
          return false;
        }
        return validPose;
      };
      const bounds = level.bounds;
      const validBounds =
        object(bounds) &&
        [bounds.minX, bounds.maxX, bounds.minY, bounds.maxY].every(
          Number.isFinite,
        ) &&
        0 <= bounds.minX &&
        bounds.minX < bounds.maxX &&
        bounds.maxX <= 30 &&
        0 <= bounds.minY &&
        bounds.minY < bounds.maxY &&
        bounds.maxY <= 20;
      if (!validBounds)
        errors.push(
          "Bounds must be ordered finite limits inside the 30 by 20 world.",
        );
      const inside = (body, label) => {
        if (
          validBounds &&
          corners(body).some(
            (point) =>
              !Number.isFinite(point.x) ||
              !Number.isFinite(point.y) ||
              point.x < bounds.minX ||
              point.x > bounds.maxX ||
              point.y < bounds.minY ||
              point.y > bounds.maxY,
          )
        ) {
          errors.push(`${label} must be entirely within bounds.`);
        }
      };
      const validStart = pose(level.start, "Start");
      if (validStart) inside(createCar(level.start), "Start car");
      if (shape(level.bay, "Bay")) {
        inside(level.bay, "Bay");
        if (
          level.bay.length < constants.length + 0.12 ||
          level.bay.width < constants.carWidth + 0.12
        ) {
          errors.push("Bay must fit the car with a 0.06 m inset on each side.");
        }
      }
      let validObstacles =
        Array.isArray(level.obstacles) && level.obstacles.length <= 40;
      if (!validObstacles)
        errors.push("Obstacles must be an array of at most 40 shapes.");
      if (validObstacles) {
        for (let i = 0; i < level.obstacles.length; i++) {
          const obstacle = level.obstacles[i];
          if (shape(obstacle, `Obstacle ${i + 1}`))
            inside(obstacle, `Obstacle ${i + 1}`);
          else validObstacles = false;
          if (
            !object(obstacle) ||
            !["car", "block", "human"].includes(obstacle.kind)
          ) {
            errors.push(`Obstacle ${i + 1} kind must be car, block, or human.`);
          }
        }
      }
      if (
        validBounds &&
        validStart &&
        validObstacles &&
        collision(createCar(level.start), level)
      ) {
        errors.push("Start car must be collision-free.");
      }
    } catch (_) {
      errors.push("Level data could not be read safely.");
    }
    return { valid: errors.length === 0, errors };
  }

  window.ParkingPhysics = Object.freeze({
    constants,
    createCar,
    corners,
    overlaps,
    collision,
    move,
    isParked,
    validateLevel,
  });
})();
