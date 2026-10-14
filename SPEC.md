# Product Specification

## Product

Atelier Plan is a local-first browser application for architects who need to draft a simple, dimensionally explicit 2D building plan and retain an editable copy. The MVP optimizes for fast desktop drafting and a clean review PDF, not construction-document production.

## User and Core Workflow

The primary user is a building architect preparing a schematic or early floor-plan drawing. The core workflow is: name a plan, draw walls, add openings and room outlines, annotate dimensions, refine object properties, download the project, reopen it later, and print a review PDF.

## Scope

### Included

- Select and move wall, opening, room, dimension, and text surfaces.
- Shift-click, Ctrl-click, or Command-click toggles an object in the current selection. Clicking empty canvas with one of these modifiers preserves the selection.
- Drag a selection rectangle: left-to-right selects objects fully contained in the box; right-to-left selects objects whose bounds intersect it. Shift/Ctrl/Command-drag adds to the current selection. Dragging a selected object moves the group; Delete removes selected objects and openings hosted by selected walls.
- Draw straight walls with two clicks; edit wall length and thickness numerically.
- Place a door or window on the nearest wall; edit opening width and along-wall position.
- Draw polygon room boundaries; edit room name and view computed area in square metres.
- Add a dimension by selecting two endpoints; show its measured length.
- Place and edit multiline text annotations with adjustable size.
- Move selected objects by dragging or setting their center coordinates. Rotate in 90° increments, uniformly scale from 1% to 1000%, duplicate, and mirror horizontally or vertically. A “Keep original when transforming” toggle applies rotate/scale/mirror to a copy; **Copy object** always duplicates.
- Metric millimetre geometry, independent origin-grid and object snapping, optional 90° wall constraint, grid visibility, zoom (including two-finger pinch zoom on touch devices), pan, fit-to-plan, undo, redo, deletion, project naming, file download/open, and browser print-to-PDF.
- A responsive interface with labeled controls, visible focus, keyboard shortcuts, and a narrow-screen layout.
- Surface hit regions scale with the view so visible wall thicknesses, dimension lines, opening symbols, and text can be selected without clicking only a centerline.

### Not Included

No accounts, cloud sync, browser project library, collaboration, multi-floor coordination, BIM/3D, layers, automatic wall cleanup/junction solving, wall endpoint handles, imperial units, custom page sizes, guaranteed-scale output, title-block editor, structural calculations, code compliance, or permit-ready-document claims.

## Drawing and Interaction Rules

- The document coordinate system is millimetres. Grid snap is enabled by default at 1 mm. The user can enter any whole-millimetre increment from 1 to 10,000 mm or disable snap. Snap points are integer multiples of the increment from world origin `(0, 0)`; visible grid dots thin at wide zoom levels but remain aligned to the snap origin.
- Object snap is enabled by default and independent of grid snap. It takes priority within 12 screen pixels of existing wall endpoints/midpoints, room corners/centers, dimension endpoints/midpoints, opening centers, or text anchors. A marker shows the active target. During drag, selected-object anchors align to anchors on other objects; the selected object and related host geometry are excluded.
- Optional **90°** wall mode constrains new wall endpoints to horizontal or vertical from the first point. Grid snapping remains independent; object snap only uses targets compatible with the orthogonal constraint.
- A wall is a straight centerline segment with a thickness. New walls use 180 mm thickness. Click start and end points; select a wall to drag it, change thickness, or set its length while retaining its direction.
- A door or window is anchored to a wall ID by center offset and width. Placement chooses the closest wall within 500 mm. Defaults are 900 mm for doors and 1200 mm for windows, limited to the host wall length; edits clamp the opening within that wall. Deleting the host wall also deletes its openings.
- A room is a polygon of at least three clicked points. On-canvas instructions explain the workflow; after three corners, **Finish room** appears. Double-click and `Enter` are alternatives. Its area is computed from the polygon and shown in m²; the name is editable.
- A dimension stores two document-space endpoints and an annotation offset. Its displayed value is derived from endpoint distance, not editable text.
- A text annotation stores its anchor, string content, font size, and rotation. Its content and size are editable in Properties.
- Object transforms pivot around each object's center. Scaling a wall also scales its thickness and hosted openings; scaling an opening changes its width within the host-wall bounds. Rotating an opening rotates its host wall assembly. For axis-aligned host walls, mirroring parallel to the wall flips door swing; mirroring perpendicular to it swaps the hinge end without moving the opening center. Symmetric walls or dimensions may appear unchanged when mirrored around their own center.
- Selection drag moves the selected object; numeric center fields support precise positioning. Wall endpoints are not independently editable in this MVP. Escape cancels an in-progress tool gesture and returns to selection.
- Space-drag or middle-button drag pans. Wheel and buttons zoom about the pointer or view center. Two-finger pinch zooms about the fingers' midpoint and pans with midpoint movement; it does not alter stored entity geometry. Fit frames current plan geometry.
- Undo/redo records project-state snapshots, capped at 80 states. Deleting a selected wall removes dependent openings.

## Project File

The downloaded `.plan.json` file is UTF-8 JSON with `schemaVersion: 1`, `units: "mm"`, `name`, and an `entities` array. Entity types are `wall`, `opening`, `room`, `dimension`, and `text`; every entity has a unique string ID. Import checks the version, unit, name, entity count (maximum 20,000), entity geometry, IDs, and opening-to-wall references. An invalid import must not replace the current project.

The file is the durable editable artifact. The app does not autosave, sync, or retain projects after the tab is closed. Viewport and transient selection state are not part of the project file.

## Print / PDF

The print action creates a vector plan sheet for the browser print dialog. The initial layout is A4 landscape with project name, date, margins, and a clear “Fit to page · Not to scale” note. The fit view should include all plan objects without clipping and preserve readable symbols and labels. PDF output is for review, not measurement or construction use.

## Accessibility and Resilience

- All visible controls have text labels or accessible names; tool selection exposes its pressed state.
- Keyboard focus remains visible. Common tools and history/deletion actions have keyboard shortcuts.
- Invalid project files produce an actionable status message and leave the open project unchanged.
- The editor must remain usable at narrow viewport widths, even though desktop is the primary drafting environment.

## Acceptance Criteria

1. A user can create and edit walls, place wall-attached openings, outline rooms, and add measured dimensions.
2. Grid snapping uses the selected millimetre interval from `(0, 0)`; object snapping independently aligns drawing and moved-object anchors. The 90° option creates axis-aligned walls. Zoom and pan do not alter stored measurements.
3. Undo and redo restore geometry and properties without leaving invalid opening references.
4. Downloading and reopening a valid project preserves its name, entities, geometry, and displayed measurements.
5. Invalid, malformed, oversized, or unsupported project data is rejected without discarding the current project.
6. Print output includes the plan and project metadata, fits the plan without clipping, and states that it is not to scale.
7. Core controls can be operated by keyboard, and layout remains usable on a narrow viewport.