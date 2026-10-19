# AuSimBattle handoff

Client-only Angular app for setting up an Austerlitz play-by-email sim battle. One screen, `app-root`, with an empty router. A loaded `.txt` turn fills the sheet header, the federation tray, and the 45×40 battlefield. The same placements are stored in a browser draft and written into a SIM sheet workbook.

`app/README.md` is the Angular CLI stub. This file is the handoff. Keep it as one document. Split only if a later slice adds a second screen, such as orders: leave this file as the index and add a short doc per screen.

## Run

```text
cd app
npm install
npm start
```

`npm start` and `npm run build` run `app/scripts/copy-sim-sheets.mjs` first. That copies repo-root files named `SIM Sheet v0.6-*.xlsx` into `app/public/sim-sheets/`. `npx ng serve` skips that copy. Port 4200 is often already taken; `npx ng serve --port 4201` works. Tests:

```text
cd app
npx ng test
```

Specs: `turn-parser.service.spec.ts` (reads `../124W0213.txt` and `../124D0113.txt`), `rules.service.spec.ts`, `excel-export.service.spec.ts`, `app.spec.ts`.

The app is zoneless (no `zone.js`). After `await file.text()` and the other file fetches, `App` calls `ChangeDetectorRef.markForCheck()`. Any new async UI update needs the same, or a signal.

## What the screen does

1. First open shows **Austerlitz Simulated Battle Planner** and **Load New Turn**. There is no paste box.
2. **Load New Turn** opens a `.txt` file picker. A valid file hides the empty state. An invalid file clears the turn and shows the error. The new turn is shown from the file only. If a matching SIM sheet or a browser draft exists, a dialog offers three kinds of choice: each matching SIM sheet, **Restore last draft** when a draft exists, and **Load turn only**. Choosing a sheet opens it. **Restore last draft** puts that draft back. **Load turn only** leaves the turn file as loaded. If neither a sheet nor a draft exists, the turn file is shown with no dialog.
3. The title bar then has the army dropdown, the opponent line, **Load New Turn**, **Save SIM**, and **Load SIM**.
4. **Header** and **Deploy** tabs sit under that bar. **Hide Feds**, **Set-Up Area** / **Battle field**, and **Clear All** stay on both tabs.
5. The battlefield is always under the sheet panel.

### Sheet header

Filled from the turn, except the fields the player sets:

| Field | Source |
| --- | --- |
| State | Nation on the `Game: AU-###` line above the battlefield |
| Game | That game id, e.g. `AU-124` |
| SimNumber | `Simulated battle No. N` that introduces `The Battle field` |
| Account | First `ACCOUNT:` in the file |
| Player | First `Mr …` line, shown in capitals |
| Process Date | Today, editable |
| General Federation | Empty until typed. A number shows **Valid** beside it |
| Army | The side whose deployment-area name best matches State. Dropdown is `Army A : {nation}` or `Army B : {nation}` |

The opponent line is the other army and its federation maximum.

### Fortress entrenchments

Shown only for Army A, and only when the brief has a fortress. The line after `Main terrain:` is `<Nation> has a small|medium|large fortress`. It is always Army A. Denmark samples have no such line.

| Size | Slots | Wall strength |
| --- | --- | --- |
| Small | 10 | 100 |
| Medium | 5 | 350 |
| Large | 10 | 500 |

Those numbers live in `app/src/app/data/sim-battle-rules.json`. The header shows the size and wall strength. Medium is one row of five slots. Small and large are two rows of five. Each slot is a number and two coordinate boxes (x then y). They start empty.

**Add** arms click-to-place. The next click inside the selected setup zone fills the next empty slot. A full set opens “No free fortress entrenchment”. **Clear** empties every slot. **[x]** empties one slot. Coordinates can also be typed.

Label alignment, which should be kept:

- **1** and **6** sit on the Game / Player value boxes.
- **3** and **8** sit on the SimNumber / Process Date value boxes.
- **5** and **10** sit on the General Federation / Army value boxes.
- **2**, **7**, **4**, and **9** sit in the gaps between those columns.
- SimNumber and Process Date labels line up with **2** / **7** and use the shared 7px slot offset.
- **General Federation** and **Army A or Army B?** do not. Those two labels have no offset and 10px of space before the input, so the fields sit close to the words.
- Every coordinate box is 52×26px. The slot number sits outside the boxes.

### Deploy

The palette lists unplaced federations for the selected army, ordered by id. Two rows of buttons above the map title control every own chip. Loading a turn selects **Ty**, so chips show the troop code and stay on the coordinate where they were placed. Clicking **Ty** again adds the federation effectiveness from the turn’s battalion-group line, rounded to a whole number, as in `GR 8` or `La 4`. Another click returns to the troop code.

| Row | Buttons |
| --- | --- |
| 1 | Ty, XY, No, BG, Start, Ord, Add, Form, D1, D2 |
| 2 | ACond, AOrd, AAdd, AForm, AD1, AD2 |

**XY**, **D1**, **D2**, **AD1**, and **AD2** are the coordinate views. A placed chip starts on its XY coordinate. It stays there for every other button. **D1**, **D2**, **AD1**, and **AD2** move it only when that destination is set; otherwise it stays on XY. A federation that is still in the tray stays there. These buttons leave the chip text unchanged. **Ty** and **No** only change the chip text. Enemy chips always show the troop code. Formation `0` stays `0`; other codes show the formation name when it is known.

**BG**, **Start**, **Ord**, **Add**, **Form**, **ACond**, **AOrd**, **AAdd**, and **AForm** edit that field. A left click on an empty own federation asks for a value. Saving a valid code opens the same choices as a federation that already has a value, plus **Keep entered value**. **Keep entered value** stores it on that federation only. Cancel discards it. A right click clears a value. A left click on a federation that already has a value offers **Paint same value** (later clicks fill empty federations until another action), **Paint value to all** (every empty federation), **Paint value to all** of that troop type, or **Change value**. **BG** does not offer those three paint actions. It offers **Change value**, **Paint next increment** (each later click on an empty federation writes one more than the last), **Paint next increment to all**, and **Paint next increment to all** of that troop type. Those two write a unique sequence: the selected federation keeps its number, later federation numbers get the next values, then earlier ones continue the sequence. Battalion group accepts 0–99. Start attack accepts 0–25. Orders, additional orders, formations, and conditions must match the rules catalog. Formation also accepts `Co`, `Li`, `Sk`, and `Sq`.

**Ty** and **XY** are the setup views: drag a chip onto the setup zone, or select one and click the zone. Placing writes that cell as the order-row start coordinate, so the chip stays where it was dropped. **D1** places the selected federation on any battlefield cell and stores that cell as destination 1. The next battlefield click sets destination 1 for the next higher federation number that already has a start coordinate on the battlefield. **D2**, **AD1**, and **AD2** only preview those destinations. Several own chips may share one coordinate; they split that cell. Deployment placement is still one federation per cell.

- Drag a chip onto the setup zone, or click a chip and then click the map. After a click-place, the next higher unplaced id is armed. Clicking a chip on the map selects that federation.
- Right-click a placed chip, or drag it back to the palette, to return it.
- **Clear All** asks, then returns every own federation to the tray and clears each federation row’s order data (battalion group, primary and alternative order fields, formations, and destinations).
- The map caption shows `Placed N / maximum`. The maximum is `Deployment area A/B, N Federations (Maximum)`.
- One federation per deployment coordinate. A drop on an occupied friendly cell swaps. An enemy cell rejects the drop. A new placement past the maximum is rejected.
- Chips are red or blue by army, and tinted by troop family. Family comes from `army-tables.json`: battalion numbers 41–45 artillery, 21–39 cavalry, anything else infantry.
- **Hide Feds** hides chips on the map. The cells stay.
- **Set-Up Area** crops the grid to the selected setup rectangle plus one cell on each side and enlarges the cell from 33×22px to 49.5×33px. The button then reads **Battle field**, which restores the full map. It works on both tabs once an army is selected.
- A sticky line under the map shows the selected federation’s order row: BG, XY, Start, Ord, Add, Form, D1, D2, Cond, AOrd, AAdd, AForm, AD1, AD2. With no selection it says `Selected federation: none`. An enemy chip, or an own federation with no order row, shows the id, troop code, and start.

Switching army reloads that side’s draft.

### Battlefield

- Find the first `Simulated battle No. N` that is followed within 12 lines by `The Battle field`. Later `Simulated battle No.` lines that only continue battalion-group pages are ignored.
- Grid is always x = 1..45, y = 1..40. Blank lines between rows are skipped (Denmark extracts have them).
- Each cell is two characters: feature + height digit 0–9.
  - `.` open, `#` woods, `b` built-up, `W` water, `$` special.
- A missing battlefield, a row that is not exactly 45 tokens, or a token that is not `[.#bW$][0-9]` fails the load. Parsing stops at 40 rows, a non-row line, or `Opponents:`.
- Colour is height only. A stored `0` is height 10, the top of the scale. 1 `#D7F7AE`, 2 `#6ED63A`, 3 `#1F8A3C`, 4 `#FFE14A`, 5 `#C9A04A`, 6 `#A6A6A6`, 7 `#7F7F7F`, 8 `#545454`, 9 `#2A2A2A`, 0 `#000000`. Height 6 is a lighter grey. Heights 7–9 and 0 are the previous 6–9 grey ramp, shifted up one.
- Open cells show the height digit. Feature cells show the feature character plus the digit (`#8`, `b7`, `W6`). The digit is light on heights 8, 9, and 0, and black on the others.
- Setup rectangles are fixed black outlines: Army A is x 11–35, y 1–10. Army B is x 11–35, y 31–40. The same rectangles are copied under `battlefield.setupAreas` in the rules JSON. The component does not read that copy.
- The selected setup zone is also tinted.
- Strategic points from `Strategic points A/B:` get a white 2px border. A placed entrenchment gets a dark gray 3px border. A cell with both uses the gray border plus an inset white 2px ring. Those borders sit above the unit chip (`::before`, `z-index: 4`).
- A `$` cell draws a 1px black inset on each edge that does not touch another `$` cell. That is the fortress wall outline, and it is still 1px.
- Map heading shows the selected deployment area and `Main terrain`.
- Cell size is 33×22px. Glyphs are 12px. Axis gutter stays 22px.

### Armies

`Battalion Groups of {nation}` is matched to the deployment-area name. Page-break lines (`Page`, `AUSTERLITZ`, `Simulated battle No.`, `Fe Type`) are skipped. Each entry is `id`, a two-letter type, four battalion pairs, and an effectiveness such as `8,5`. The effectiveness is kept on the federation and rounded only when **Ty** shows it. `start` is always null, so every federation begins in the tray. Enemy chips appear only when a unit has a start inside its setup zone, which the turn text does not supply.

## Rules data

`RulesService` loads both JSON files. The screen uses a small slice. The rest is source material for later work, not dead data and not enforced behaviour.

- `app/src/app/data/army-tables.json` — nation names, aliases, and battalion stats from the army tables. Lookup is by nation or alias, then battalion number or short name. The UI uses the short name only to colour chips.
- `app/src/app/data/sim-battle-rules.json` — section 7.2 of `Austerlitz Rules.pdf`. The UI reads `fortresses` only.
- Unused blocks in that file: `orders`, `movement`, `longRangeCombat`, `handToHandCombat`, `morale`, `victory`, plus `battlefield.strategicPointsPerSide` (3) and `strategicPointsMinDistance` (5). The parser stores whatever strategic points the turn lists. It does not check the count or the spacing.

## Save and load

Two stores, both in the browser:

- Draft: `localStorage` key `ausim.setup.{gameId}.{simNumber}.{army}`. Header, placements, fortress slots, and federation order rows. Saved on edit, place, and army change.
- Workbook: `localStorage` key `ausim.simsheet.{fileName}`, plus a downloaded `.xlsx`.

**Save SIM** is enabled whenever an army is selected. It does not wait until the placed count equals the maximum.

Save fills `app/public/SIM Sheet v0.6-Template.xlsx` (fetched as `/SIM Sheet v0.6-Template.xlsx`) by editing `xl/worksheets/sheet1.xml`. It does not build a blank workbook, so the template’s validation formulas stay.

| Sheet cells | Contents |
| --- | --- |
| C3, F3, L3, R3 | State, Game, SimNumber, General Federation |
| C4, F4, L4, R4 | Account, Player, Process Date (Excel serial), Army A or Army B |
| Row 6 and row 8, columns F/G, I/J, L/M, O/P, R/S | Entrenchment x/y, slots 1–5 then 6–10 |
| Row `12 + federation id`, columns C and F–U | Battalion group and full primary/alternative order row |
| Row `12 + federation id`, columns D and E | Start x/y, for ids 1–110 |

Download name is `SIM Sheet v0.6-{State} Sim {N}.xlsx`. If that name already exists in `localStorage` or in `app/public/sim-sheets/`, the dialog offers **Overwrite** or **New version** (`_1`, `_2`, …).

**Load SIM** looks for the same name pattern. One match loads it. Several matches open a chooser. None shows “File not found”. A saved browser copy wins over the public file. Loaded values replace the general, the process date, placements that belong to the selected army and sit in its setup zone, and the fortress slots.

## Not done

- Order entry. Order rows load from the SIM sheet and the draft, show on the chips, and save back. There is still no form for typing an order. `app/src/app/models/battle.ts` has the row shape, and the rules JSON has the order catalog.
- Movement, combat, morale, and victory tables are data only.
- `$` fortress-wall outlines are 1px. The requested thickness is 3px.
- Setup rectangles are hardcoded in `app.ts`, not read from the rules JSON.
- Turn text does not supply federation start coordinates.
- The router is unused.

## Map files

Sample turns live in the repo root, next to the SIM workbooks. Warsaw `124W0213.txt` has compact map rows and a large fortress. Denmark `124D0113.txt` has a blank line between rows and no fortress. Do not use the older “Initial Deployment” grid (`124W0313.txt` and similar): federation ids drawn on the map are not the setup battlefield.

## Where to edit

| Path | Role |
| --- | --- |
| `app/src/app/app.html` | Title, tabs, header, fortress slots, palette, map |
| `app/src/app/app.css` | Header grid, fortress alignment, cell size, borders |
| `app/src/app/app.ts` | File load, placement, chip modes, zoom, entrenchments, height colours |
| `app/src/app/services/turn-parser.service.ts` | Battlefield, brief, fortress line, battalion groups |
| `app/src/app/models/turn.ts` | `ParsedTurn`, map, armies, fortress brief |
| `app/src/app/models/battle.ts` | SIM header and unused order types |
| `app/src/app/services/excel-export.service.ts` | Template fill, download, workbook round-trip |
| `app/src/app/services/draft.service.ts` | localStorage draft |
| `app/src/app/services/rules.service.ts` | Nation, battalion, and fortress lookups |
| `app/src/app/data/sim-battle-rules.json` | Section 7.2 extract |
| `app/src/app/data/army-tables.json` | Battalion tables used for chip colour |
| `app/scripts/copy-sim-sheets.mjs` | Copies root workbooks into `public/sim-sheets` before start and build |
| `app/public/SIM Sheet v0.6-Template.xlsx` | Workbook that Save fills |
