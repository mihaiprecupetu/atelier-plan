# Atelier Plan

Atelier Plan is a browser-based 2D floor-plan editor for building architects. Draw walls, place doors and windows, outline rooms, annotate dimensions and text, then download an editable project file or print the plan to PDF.

## Run

Open `index.html` in a current desktop browser. The app is static and has no build or install step. Internet access is only used to load optional DM Sans and DM Mono fonts; system fallbacks are provided.

Use the **Dark mode** button in the project toolbar to switch appearance. The choice is saved in this browser.

## Workflow

1. Enter a project name and choose a drawing tool from the left rail.
2. Draw a wall by clicking its start point, then enter a length in millimetres and press `Enter`; the cursor direction sets its angle. The last wall length is prefilled for the next wall. You can also click an end point as before. Place doors or windows by clicking near a wall. For a room enclosed by walls, click corners along their inside faces, then choose **Finish room**, press `Enter`, or double-click. Room area follows the enclosing wall centerlines (four 4 m walls report 16 m²); it does not deduct wall thickness. Create a dimension by selecting its two endpoints; enable **Objects** to snap to door/window jambs for exact clear-opening dimensions. Place text by clicking the canvas, then edit its content in Properties.
3. Use **Select** to click an object surface, drag it, or set its center coordinates. Shift-click, Ctrl-click (or Command-click on macOS) to add or remove objects from the selection. Choose **Area select** (`A`) and drag a box for multiple objects: left-to-right selects objects fully inside; right-to-left selects objects crossed by the box. Shift/Ctrl/Command-drag adds the box results to the current selection. Drag a selected object to move the group, choose **Send to back** or **Bring to front** to change its draw order, or choose **Delete** to remove it.
4. Use the transform controls to rotate, scale, copy, or mirror a single selected object. Turn on **Keep original when transforming** to apply rotate/scale/mirror to a copy.
5. Use the **Layers** panel to add and rename layers, choose the active drawing layer, hide/show layers, delete a layer, or move the current selection to the active layer. Deleting a layer moves its objects to another existing layer. Grid snapping starts at world coordinate `(0, 0)` and defaults to 1 mm increments. Enter another whole-millimetre increment in the canvas toolbar. Enable **Objects** to snap to nearby wall ends/midpoints, room corners/centers, dimension points, opening jambs/centers, and text anchors. **90°** is on by default and constrains new walls to horizontal or vertical; turn it off to draw at any angle.
6. Choose **Download project** to save an editable `.plan.json` file. Choose **Open** to reopen a downloaded project.
7. Choose **Print / PDF** and use the browser's print dialog to save a PDF.

## Controls

- `V`: select; `W`: wall; `D`: door; `R`: room; `M`: dimension; `T`: text.
- `Enter`: finish a room after placing at least three corners, or finish a wall after entering its length. Double-click also finishes a room.
- `A`: activate Area select.
- The **Grid**, **Objects**, and **90°** controls are independent; **90°** starts on. The snap marker indicates an object point that will be used.
- `Space` + drag or middle mouse drag: pan. Scroll: zoom. Pinch with two fingers on a touch screen to zoom and pan around the midpoint. Use the zoom controls or **Fit** as alternatives.
- `Ctrl+Z` / `Ctrl+Y`: undo / redo. `Delete`: remove the selected object. `Escape`: return to select.

## Project Format

Project files are JSON with schema version `1` and millimetre geometry. Keep the downloaded file as the editable source of truth; the app does not autosave or keep a browser-side project library.

## Limitations

This is an early drafting tool, not a certified CAD or BIM system. It does not provide structural analysis, code compliance, automatic wall-junction solving, multi-storey coordination, collaboration, cloud storage, guaranteed-scale sheet layouts, or permit-ready documents. PDF output is fitted to an A4 landscape page and is explicitly not to scale. Check dimensions in the editable project and do not use PDF measurements as a substitute for verified construction documentation.

See [SPEC.md](SPEC.md) for requirements, [ARCHITECTURE.md](ARCHITECTURE.md) for implementation details, [ROADMAP.md](ROADMAP.md) for planned work, and [CONTRIBUTING.md](CONTRIBUTING.md) for development checks.