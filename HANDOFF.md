# AuSimBattle handoff

Client-only Angular app for setting up an Austerlitz play-by-email sim battle. The current slice loads a turn `.txt`, paints the battlefield, and shows the SIM sheet header. Federation placement and the SIM sheet download are coded but not wired into this screen.

## Run

```text
cd app
npm install
npx ng serve
```

Open the URL the CLI prints. Port 4200 is often already taken; `npx ng serve --port 4201` works. Tests:

```text
cd app
npx ng test
```

`turn-parser.service.spec.ts` reads `../124W0213.txt` (Warsaw sim 204) and `../124D0113.txt` (Denmark sim 196).

The app is zoneless (no `zone.js`). After `await file.text()`, `App` calls `ChangeDetectorRef.markForCheck()`. Any new async UI update needs the same, or a signal.

## What the screen does now

1. First open shows only the title **Austerlitz Sim Battle Setup** and **Load New**.
2. **Load New** opens a `.txt` file picker. There is no paste box.
3. A valid file hides the picker. **Load New** stays in the title and can replace the turn. An invalid file clears the turn and shows the error.
4. The sheet header appears under the title, then the 45×40 battlefield.

### Sheet header

Filled from the turn, except the fields the player sets:

| Field | Source |
| --- | --- |
| State | Nation on the `Game: AU-###` line above the battlefield (full name, e.g. Duchy of Warsaw) |
| Game | That game id, e.g. `AU-124` |
| SimNumber | `Simulated battle No. N` |
| Account | First `ACCOUNT:` in the file |
| Player | First `Mr …` line, shown in capitals |
| Process Date | Today, editable |
| General Federation | Empty until typed. A number shows **Valid** beside it |
| Army A or Army B? | **Army A** as soon as the file loads. Dropdown is Army A or Army B |

Fortress entrenchments are 10 slots, two rows of five. Each slot is a number and two coordinate boxes (x then y). They start empty. They are component state only: not parsed from the turn, not saved, not written to Excel.

Label alignment, which should be kept:

- **1** and **6** sit on the Game / Player value boxes.
- **3** and **8** sit on the SimNumber / Process Date value boxes.
- **5** and **10** sit on the General Federation / Army value boxes.
- **2**, **7**, **4**, and **9** sit in the gaps between those columns.
- SimNumber and Process Date labels line up with **2** / **7**.
- General Federation and Army labels line up with **4** / **9**.
- Every coordinate box is 52×26px. The slot number sits outside the boxes.
- Column 7 is held at `min-width: 239px` so shortening the general label does not move the value boxes.

### Battlefield

- Find the first `Simulated battle No. N` that is followed within 12 lines by `The Battle field`. Later `Simulated battle No.` lines that only continue battalion-group pages are ignored.
- Grid is always x = 1..45, y = 1..40. Blank lines between rows are skipped (Denmark extracts have them).
- Each cell is two characters: feature + height digit 0–9.
  - `.` open, `#` woods, `b` built-up, `W` water, `$` special.
- A missing battlefield, a row that is not exactly 45 tokens, or a token that is not `[.#bW$][0-9]` fails the load. Parsing stops at 40 rows, the numbered footer, or `Opponents:`.
- Colour is height only: 0 white, 1 yellow `#ffe500`, 2 light green `#9be59b`, 3 dark green `#1f7a32`, 4 light grey `#d3d3d3`, 5–8 a linear mix of that grey toward black, 9 black.
- Open cells show the height digit. Feature cells show the feature character plus the digit (`#8`, `b7`, `W6`). Glyphs are dark below height 6 and light from 6 up.
- Setup rectangles are fixed black outlines, not inferred from units: Army A is x 11–35, y 1–10. Army B is x 11–35, y 31–40.
- Caption under the map title is `Sim {n} — A: {deployment area A}, B: {deployment area B}` from the `Deployment area A/B … (Maximum):` lines.
- Hover text is `x, y  token  height N`.

## What is coded but not on this screen

`TurnParserService.parse` returns `armies: []`. The army picker, tray, drag-and-drop, and download button render only when `parsedTurn.armies.length` is set, so they never show.

Also present and unused by the current screen:

- `DraftService` — `localStorage` key `ausim.setup.{gameId}.{simNumber}.{army}`.
- `ExcelExportService` — builds a new Sheet1 workbook (header labels plus Fed and start x/y). It does not open `SIM Sheet v0.6-Warsaw Sim.xlsx`, so validation formulas are not preserved. Download name is `{game}_Sim_{sim}_Army_{A|B}.xlsx`.
- Battle models in `app/src/app/models/battle.ts` mirror the C# sheet types (`SimulatedBattle`, `BattleHeader`, `FederationOrder`, orders, coordinates).

## Not done

- Deployment maxima, strategic points, and `Battalion Groups of …` are not parsed. Lists are larger than the deployment maximum. Units have no start coordinates, so they belong in a tray. Cap drops at the maximum. Download when the placed count equals that maximum.
- One federation per coordinate. A drop on an occupied own cell swaps. Enemy cells stay locked. Colour is army only, not troop family.
- Fortress coordinates are not read from the turn and are not exported.
- Official template export needs the Warsaw xlsx copied under `app/public`. Angular cannot asset-copy a file outside the app workspace.

## Map files

Sample turns live in the repo root, next to the SIM workbooks. Warsaw `124W0213.txt` has compact map rows. Denmark `124D0113.txt` has a blank line between rows. Do not use the older “Initial Deployment” grid (`124W0313.txt` and similar): federation ids drawn on the map are not the setup battlefield.

## Where to edit

| Path | Role |
| --- | --- |
| `app/src/app/app.html` | Title, Load New, sheet header, map |
| `app/src/app/app.css` | Header grid, fortress alignment, cell size |
| `app/src/app/app.ts` | File load, height colours, labels, fortress state, dormant placement |
| `app/src/app/services/turn-parser.service.ts` | Battlefield and header parse |
| `app/src/app/models/turn.ts` | `ParsedTurn`, `MapCell`, setup types |
| `app/src/app/models/battle.ts` | SIM sheet types |
| `app/src/app/services/excel-export.service.ts` | Generated workbook |
| `app/src/app/services/draft.service.ts` | localStorage draft |

Cell size is 33×22px (width was increased 50% from 22). Glyphs are 12px. Axis gutter stays 22px. Map track is `22px repeat(45, 33px)`.
