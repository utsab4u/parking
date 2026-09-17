(function () {
  "use strict";

  const duration = 6;
  const liftAt = 3.2;
  const clamp = (value) => Math.max(0, Math.min(1, value));
  const ease = (value) => {
    const t = clamp(value);
    return t * t * (3 - 2 * t);
  };

  function draw(ctx, mission, drawCar) {
    const target = mission.target;
    const t = Math.max(0, Math.min(duration, mission.elapsed));
    const reduced = Boolean(mission.reducedMotion);
    const lifted = t >= liftAt;
    // 0..2 arrive; 2..3.2 lower cable; 3.2..4.2 lift; 4.2..6 depart.
    const arrival = ease(t / 2);
    const lowering = reduced ? 1 : ease((t - 2) / (liftAt - 2));
    const reeling = reduced ? 0 : ease((t - liftAt) / (4.2 - liftAt));
    const departure = ease((t - 4.2) / (duration - 4.2));
    const padding = Math.hypot(target.length, target.width) + 7;
    const hoverX = target.x;
    const hoverY = target.y - 2.4;
    const x = reduced
      ? hoverX
      : -padding +
        (hoverX + padding) * arrival +
        (30 + padding - hoverX) * departure;
    const y = reduced
      ? hoverY
      : -padding +
        (hoverY + padding) * arrival +
        (-padding - hoverY) * departure;
    const carX = target.x + (x - hoverX);
    const carY = target.y + (y - hoverY) - reeling * 1.15;
    const hookY = lifted ? carY : y + 0.45 + lowering * 1.95;
    const rotorAngle = reduced ? 0.35 : t * 19;

    ctx.save();
    try {
      ctx.globalAlpha = reduced ? ease(t / 0.45) * (1 - departure) : 1;
      ctx.globalCompositeOperation = "source-over";
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      ctx.setLineDash([]);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      // Soft, offset air shadow stays behind both cable and cargo.
      ctx.fillStyle = "rgba(35, 57, 43, 0.10)";
      ctx.beginPath();
      ctx.ellipse(x + 0.55, y + 1.15, 2.55, 1.25, -0.18, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(35, 57, 43, 0.08)";
      ctx.beginPath();
      ctx.ellipse(x + 0.55, y + 1.15, 1.55, 0.75, -0.18, 0, Math.PI * 2);
      ctx.fill();

      if (lifted) {
        ctx.save();
        try {
          const scale = 1 - reeling * 0.065;
          ctx.translate(carX, carY);
          ctx.scale(scale, scale);
          ctx.translate(-target.x, -target.y);
          // A copy preserves orientation/details without exposing mission to mutation.
          drawCar({ ...target });
        } finally {
          ctx.restore();
        }
      }

      ctx.strokeStyle = "rgba(250, 243, 216, 0.85)";
      ctx.lineWidth = 0.095;
      ctx.beginPath();
      ctx.moveTo(x, y + 0.25);
      ctx.lineTo(x, hookY);
      ctx.stroke();
      ctx.strokeStyle = "#49584a";
      ctx.lineWidth = 0.035;
      ctx.stroke();
      ctx.strokeStyle = "#b58b3f";
      ctx.lineWidth = 0.065;
      ctx.beginPath();
      ctx.arc(x, hookY - 0.065, 0.095, 0, Math.PI * 1.65);
      ctx.stroke();

      ctx.translate(x, y);

      // Skids, tail boom, and stabilizers underneath the rounded cabin.
      ctx.strokeStyle = "#394f43";
      ctx.lineWidth = 0.11;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(side * 0.39, -0.45);
        ctx.lineTo(side * 0.84, -0.35);
        ctx.moveTo(side * 0.4, 0.47);
        ctx.lineTo(side * 0.84, 0.57);
        ctx.stroke();
        ctx.strokeStyle = "#e5d8b1";
        ctx.beginPath();
        ctx.moveTo(side * 0.77, -1.05);
        ctx.quadraticCurveTo(side * 0.92, -0.95, side * 0.92, -0.65);
        ctx.lineTo(side * 0.92, 0.95);
        ctx.stroke();
        ctx.strokeStyle = "#394f43";
      }

      ctx.fillStyle = "#426451";
      ctx.strokeStyle = "#2f493c";
      ctx.lineWidth = 0.045;
      ctx.beginPath();
      ctx.moveTo(-0.3, 0.5);
      ctx.lineTo(-0.11, 2.65);
      ctx.lineTo(0.11, 2.65);
      ctx.lineTo(0.3, 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#c29a4c";
      ctx.beginPath();
      ctx.moveTo(-0.64, 2.15);
      ctx.lineTo(0.64, 2.15);
      ctx.lineTo(0.48, 2.38);
      ctx.lineTo(-0.48, 2.38);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = "#f2e6c6";
      ctx.beginPath();
      ctx.ellipse(0, -0.05, 0.66, 1.12, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#355b4c";
      ctx.beginPath();
      ctx.moveTo(-0.51, -0.32);
      ctx.bezierCurveTo(-0.5, -1.27, 0.5, -1.27, 0.51, -0.32);
      ctx.quadraticCurveTo(0, -0.1, -0.51, -0.32);
      ctx.fill();
      ctx.strokeStyle = "#adc4ab";
      ctx.lineWidth = 0.045;
      ctx.beginPath();
      ctx.moveTo(0, -0.98);
      ctx.lineTo(0, -0.24);
      ctx.moveTo(-0.33, -0.69);
      ctx.quadraticCurveTo(-0.25, -0.85, -0.13, -0.87);
      ctx.stroke();
      ctx.fillStyle = "#bc9141";
      ctx.fillRect(-0.54, 0.23, 1.08, 0.16);
      ctx.fillStyle = "#486752";
      ctx.beginPath();
      ctx.ellipse(0, 0.62, 0.32, 0.27, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.save();
      ctx.translate(0, 2.57);
      ctx.rotate(reduced ? 0.6 : -t * 27);
      ctx.fillStyle = "#344b3e";
      ctx.fillRect(-0.43, -0.055, 0.86, 0.11);
      ctx.fillRect(-0.055, -0.43, 0.11, 0.86);
      ctx.restore();

      if (!reduced) {
        ctx.fillStyle = "rgba(242, 230, 198, 0.09)";
        ctx.beginPath();
        ctx.arc(0, 0, 2.35, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.save();
      ctx.rotate(rotorAngle);
      for (let blade = 0; blade < 4; blade += 1) {
        ctx.rotate(Math.PI / 2);
        ctx.fillStyle = "rgba(42, 63, 49, 0.85)";
        ctx.beginPath();
        ctx.moveTo(0.13, -0.09);
        ctx.lineTo(2.32, -0.15);
        ctx.lineTo(2.36, 0.04);
        ctx.lineTo(0.13, 0.075);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "#d8b76c";
        ctx.fillRect(2.08, -0.135, 0.22, 0.16);
      }
      ctx.restore();
      ctx.fillStyle = "#c19a4d";
      ctx.strokeStyle = "#304b3c";
      ctx.lineWidth = 0.055;
      ctx.beginPath();
      ctx.arc(0, 0, 0.18, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } finally {
      ctx.restore();
    }
  }

  window.ParkingHelicopter = Object.freeze({ duration, liftAt, draw });
})();
