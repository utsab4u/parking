# Small Hours / Parking Practice

A standalone, top-down parking simulator. Open `index.html` directly in a modern browser. No installation, build step, account, or server is required. All gameplay works offline; optional Google Fonts fall back to system fonts when unavailable.

## Features

- 20 parking challenges with parallel, perpendicular, angled, and obstacle-based layouts.
- Low-speed car physics with constant-speed forward/reverse driving and persistent steering.
- Keyboard and touch controls, with guide overlays off by default.
- A drag-and-drop level editor with 45-degree rotation controls, local saves, and JSON import/export.
- A collision-aware route solver that can confirm a solution without claiming that unsuccessful searches prove impossibility.
- Plain HTML, CSS, and JavaScript with no runtime packages or build tools required.

## Quick Start

```sh
git clone https://github.com/utsab4u/parking.git
cd parking
```

Open `index.html` in your browser to play immediately.

Alternatively, serve this directory with `python3 -m http.server 8080` and open `http://localhost:8080`. To play on a phone on the same network, open the computer's LAN address on port 8080. Touch controls are included.

## Controls

| Input        | Action                          |
| ------------ | ------------------------------- |
| Up / Down    | Hold to drive forward / reverse |
| Left / Right | Rotate front wheels             |
| Space        | Brake                           |
| R            | Reset the challenge             |
| P            | Toggle path assist              |

Steering is retained when you release the steering keys: countersteer to center the wheels. Hold Up or Down to move at a constant pace; release to stop immediately. Holding longer does not increase speed. Space or holding both directions stops the car. Touch buttons use the same behavior and support simultaneous steering and driving.

Guide overlays are opt-in. Path assist starts off; enable it with its button or P. Solver routes also start hidden after validation; select **Show verified route** to display one. The parking bay outline remains visible.

## Twenty Levels

Use the level selector or previous/next buttons to choose any of 20 built-in layouts. They cover parallel, perpendicular, angled, reverse, offset, and barrier-based approaches, from beginner to advanced. All levels are available immediately. The success screen lets you continue to the next level.

Park the mint car entirely inside the green bay, within 8 degrees of its heading, and hold still for 1.2 seconds. Either direction along the bay is accepted, including in levels that suggest a particular approach. Curb and obstacle contact stops movement and counts as a contact, but does not end the attempt. Reset to try for a clean finish.

All 20 built-in layouts have been checked with the included solver, which found collision-free routes for each.

## Level Editor

Choose **Create a level** for an empty lot, or **Edit this layout** to make a copy of a built-in level. Editing a custom level retains its save identity.

1. Select the starting car, parking bay, parked car, or block using the object selector or canvas.
2. Drag objects on the lot, or enter precise X/Y coordinates, heading, length, and width. Click a car or other object, then use **Rotate left 45°** or **Rotate right 45°** to change its orientation in 45-degree steps. Dragging snaps to 0.1 m. Heading 0 points right, 90 points down, and angles are entered in degrees. The playable car's dimensions stay fixed; obstacles and the bay can be resized.
3. Add parked cars or blocks, or delete the selected obstacle. There is a 40-obstacle limit. Overlapping blocks can form continuous walls.
4. Fix the inline geometry errors, then use **Validate from start** to look for a safe route. A geometrically valid layout is not necessarily solvable.
5. Choose **Play layout** to try the draft, **Save locally** to keep it in this browser's level selector, or **Export JSON** for a portable backup. Playing does not automatically save.

**Import JSON** opens an exported level as a draft. Imports are checked before use, limited to 100 KB, and require finite coordinates, valid dimensions, bounded objects, valid metadata, and hex obstacle colors. Invalid drafts may be exported for later editing, but cannot be played or saved until corrected.

Custom levels are stored under `small-hours.custom-levels.v1` in `localStorage`, with a maximum of 50 saved layouts. Storage for `file://` URLs varies by browser and can be restricted; different HTTP origins have separate storage. Export JSON before moving the app, switching browsers, or clearing browser data. Storage failures are shown rather than reported as successful saves. **Cancel** discards unsaved edits and returns to the previous layout; it does not undo an explicit save.

## Solvability Validation

**Validate from start** runs a cancellable hybrid A* search from the level's original starting pose, not the car's current position. It pauses gameplay while searching and uses the same dimensions, steering limit, motion model, collision checks, and parking predicate as the game. Changing the layout or resetting cancels any search and clears the old result. Starting to drive cancels an ongoing search; a completed route can stay visible as a guide.

Results deliberately distinguish:

- **Solvable in this model:** a concrete collision-free route was found and rechecked. Toggle the route overlay or scrub **Inspect the maneuver** to examine the gold preview car. It is not an autoplay or a completed player attempt.
- **Invalid layout:** inputs violate geometry requirements, such as an overlapping start car, an out-of-bounds object, or a bay too small for the car.
- **Inconclusive:** the search budget, discretization, or conservative clearance prevented finding a route. This does **not** prove that the level is impossible.
- **Cancelled:** no conclusion was reached.

The search explores forward/reverse constant-steering segments with five steering choices, 0.3 m position buckets, 7.5-degree heading buckets, and up to 50,000 expanded states or 12 seconds. It yields regularly so the page stays responsive. Steering changes are legal stationary maneuvers: stop, rotate the wheels at the game's bounded steering rate, then move. Returned routes need not be shortest or easiest for a person to follow.

### What Is Mathematically Checked?

The center-of-body bicycle model has curvature

```text
beta = atan(0.5 * tan(steer))
curvature = cos(beta) * tan(steer) / wheelbase
```

The solver integrates each constant-curvature segment exactly and checks the entire oriented car rectangle against curbs and obstacles. It samples at intervals of at most 0.04 m and inflates each side of the collision rectangle by 0.08 m. At the maximum allowed steering, any footprint point travels less than `1.6 * 0.04 = 0.064 m` between samples, so the inflation conservatively covers motion between collision checks. The reconstructed route is rechecked before success; its endpoint must satisfy the bay containment and heading constraints. Stopping there completes the game's 1.2-second hold.

This is a constructive feasibility check under the idealized numerical model, not a formal theorem-prover certificate or a real-world driving guarantee. Search failure is not an impossibility proof. Very tight but feasible layouts can be rejected by the solver's extra clearance, and dynamic obstacles, tire slip, mirrors, vehicle damage, and real-world uncertainties are not modeled.

## Physics And Configuration

`levels.js` contains the 20 built-in layouts. `parking-core.js` contains the shared vehicle dimensions, wheelbase, steering limit/rate, fixed `driveSpeed`, geometry validation, and exact motion model. All dimensions are meters and simulation time is seconds. Stored/JSON headings are radians; the editor displays degrees.

The simulator uses a fixed 120 Hz kinematic bicycle model with a 2.65 m wheelbase and a 35-degree steering limit. The center-of-body velocity accounts for the angle between the vehicle body and the travel direction. Signed velocity gives correct steering behavior in reverse. Driving speed is fixed at 1.4 m/s (approximately 5 km/h) in either direction, with no acceleration or coasting. Oriented-rectangle collisions use the separating axis theorem; curbs enforce the driving bounds.

This model is designed for low-speed parking practice, not high-speed tire dynamics. Collisions stop the vehicle rather than simulating deformation or impact forces. The overhead camera and path preview are practice aids, not a substitute for real driving instruction.

Files: `index.html` (interface), `style.css` and `editor.css` (responsive design), `game.js` (gameplay, rendering, and level management), `levels.js` (built-in layouts), `parking-core.js` (shared physics), `parking-solver.js` (route search), and `level-editor.js` (custom layout editor). No application data leaves the browser. The optional font stylesheet is the only external request.
