# Architecture

## Runtime

The application is a dependency-free static page: `index.html` provides semantic controls and SVG layers, `styles.css` contains the workbench and print layouts, and `app.js` owns the document model, interaction state, rendering, validation, and file operations. No server or build step is required. Google-hosted DM Sans and DM Mono are optional presentation fonts with local fallbacks.

## Coordinate and Rendering Model

Plan geometry is stored in millimetres. The interactive SVG `viewBox` expresses the current view transform; pointer coordinates are converted through `getScreenCTM().inverse()` before snapping. Grid snapping rounds coordinates to integer multiples of the user-selected increment from world origin `(0, 0)`. Object snapping independently searches entity anchors within a 12 CSS-pixel tolerance and takes priority over the grid; opening jambs and centers are snap anchors, so dimensions can measure the clear opening exactly. Moved entities align their own anchors to anchors on other entities. Optional orthogonal wall drawing constrains an endpoint relative to its start point and accepts only compatible object-snap targets. Changing zoom or pan modifies only the SVG viewBox, never entity geometry. For legibility, the displayed dot pattern thins at wide zoom levels while remaining aligned to the origin and increment.

SVG rendering is rebuilt from project state after edits. Walls are stroked centerline segments; their stroke width is the wall thickness in document units. Openings render as a background-colored cut over the referenced wall followed by a door or window symbol; butt-ended cuts keep the visible clear opening equal to its stored width. Room polygons represent the editable floor boundary; when their edges follow enclosing wall faces, area labels are computed from the intersections of the corresponding wall centerlines, without subtracting wall thickness. Dimensions render extension lines, an offset dimension line, and a derived length label. Text entities render multiline `tspan` content with stored size and rotation.

The event layer supports click-point construction for walls, rooms, and dimensions; exact typed wall lengths completed with Enter; nearby object-anchor snapping; optional orthogonal wall construction; nearest-visible-wall projection for opening placement; geometric canvas hit-testing for visible surfaces; window/crossing area-selection marquees; group drag/delete; numeric repositioning; rotation, uniform scaling, copying, mirroring, and front/back arrangement; wheel and two-finger pinch zoom (with midpoint panning); and middle-button/space pan. SVG hit strokes scale with the current view, with a geometry-based fallback for browser hit-test gaps. Hidden layers are omitted from drawing, hit testing, and object snapping. A snap marker shows the active object target. Room completion is available from an explicit button, double-click, or Enter after three points. Tool and gesture state are separate from project data.

## Project Model

```json
{
  "schemaVersion": 1,
  "name": "Example plan",
  "units": "mm",
  "layers": [{ "id": "layer-default", "name": "Layer 1", "visible": true }],
  "activeLayerId": "layer-default",
  "entities": [
    { "id": "wall-id", "type": "wall", "x1": 0, "y1": 0, "x2": 4000, "y2": 0, "thickness": 180, "layerId": "layer-default" },
    { "id": "door-id", "type": "opening", "kind": "door", "wallId": "wall-id", "offset": 1000, "width": 900, "layerId": "layer-default" },
    { "id": "room-id", "type": "room", "name": "Living", "points": [{ "x": 0, "y": 0 }, { "x": 4000, "y": 0 }, { "x": 4000, "y": 3000 }], "layerId": "layer-default" },
    { "id": "dimension-id", "type": "dimension", "a": { "x": 0, "y": 0 }, "b": { "x": 4000, "y": 0 }, "offset": 260, "layerId": "layer-default" },
    { "id": "text-id", "type": "text", "x": 2000, "y": 3400, "text": "Entry", "size": 220, "rotation": 0, "layerId": "layer-default" }
  ]
}
```

`schemaVersion` is required for future migrations. IDs must be unique. Projects contain named, visible/hidden layers and an active drawing layer; each entity references a layer. Older version-1 projects without layer data load into a visible default layer. Openings reference wall IDs and are expressed as a center offset along the wall; import and property edits keep each opening within its host segment. Room area and dimension values are derived during rendering rather than stored as duplicated measurements. Text stores its anchor, content, size, and rotation.

## State and History

`project` is the serializable source of truth. The active tool, selection, current gesture, grid settings, “keep original” toggle, and SVG viewBox are transient. Transform operations mutate the selected entity around its calculated center; wall copies also clone and remap hosted openings. Rotating an opening with copy enabled clones its host wall assembly so the source remains unchanged. Front/back arrangement moves selected stack units while keeping hosted openings with their walls. For axis-aligned host walls, mirroring across the wall axis flips swing side, while mirroring across the perpendicular axis flips hinge side. Undo/redo stores up to 80 JSON snapshots of project state.

## Import and Export

Download serializes the project to JSON and creates a browser `Blob` download. Import reads a user-selected file, parses JSON, validates schema and entity relationships, and only then replaces the current state. No server receives plan data.

Print copies the rendered entity SVG into a separate print-only SVG and applies an A4 landscape stylesheet. The page states that the drawing is fit-to-page and not to scale. It relies on the browser print dialog and does not generate or certify a fixed-scale PDF.

## Known Technical Limits

The initial interaction model uses click-to-place geometry and whole-object movement. Wall junctions are not resolved, openings are not clipped to arbitrary short segments during every edit, and room polygons are not checked for self-intersection. This model is suitable for an early schematic editor, not construction coordination or engineering review.