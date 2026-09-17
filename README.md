# Small Hours / Parking Practice

Squeeze into tight spaces across **20 parking challenges**, or build your own. Play with a keyboard or touch controls.

## Start Playing

Download this repository and open **`index.html`** in a modern browser. No installation or account needed; gameplay works offline.

Prefer a local server? Run `python3 -m http.server 8080` and visit **http://localhost:8080**.

## How to Play

Park the mint car completely inside the green bay, align with it, and stay still briefly to finish. Either parking direction counts. Avoid parked cars, barriers, and people!

| Control      | Action                                          |
| ------------ | ----------------------------------------------- |
| Up / Down    | Drive forward / reverse                         |
| Left / Right | Steer                                           |
| Space        | Brake                                           |
| R            | Restart the attempt                             |
| P            | Toggle path assist                              |
| Escape       | Cancel tow selection, or exit the expanded view |

Hold to drive at a steady pace; release to stop. Steering stays where you leave it, so countersteer to straighten the wheels. On mobile, use the on-screen buttons.

The view automatically expands and zooms in when you first drive in each level. **Exit Full Screen** returns to the level selector and editor; **Full Screen** opens it again. This fills the browser window, not the entire device screen.

## Need More Room?

Click **Tow a car (+5:00)** on the playing area, select a parked car, and confirm. A helicopter carries it away, adding **five minutes per tow**. Reset restores all cars and clears penalties.

For help parking, enable **Path assist** or use **Validate from start**, then **Show verified route**. Guides are off by default. An _inconclusive_ result means no route was found, not that parking is impossible.

## Build Your Own

**Create a level** copies the current layout into a new custom level. **Edit this layout** lets you modify it; built-in levels remain unchanged.

- Drag objects, rotate in 45-degree steps, or enter precise positions and sizes.
- Add parked cars, blocks, and humans. **Duplicate selected obstacle** preserves its size and orientation; drag the copy into place.
- Choose **Play layout** to try it or **Save locally** to keep it. Playing does not save automatically.
- Use **Export JSON** / **Import JSON** to back up or share layouts.

Saved levels stay in this browser only. Export them before clearing browser data or switching devices.
