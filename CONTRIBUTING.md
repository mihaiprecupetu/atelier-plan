# Contributing

## Development

The app is a static browser project with no package installation. Open `index.html` in a current Chrome or Edge browser. Keep the project usable without a server and avoid adding runtime dependencies unless they solve a demonstrated need.

## Conventions

- Keep document geometry in millimetres and keep viewport state out of exported project data.
- Validate imported data before mutating current project state.
- Preserve SVG rendering from the serializable project model; do not store derived area or dimension labels.
- Preserve origin-based integer-multiple snapping; keep visible grid thinning aligned to the snap increment.
- Keep grid snap, object snap, and orthogonal wall constraints independently configurable; orthogonal mode must filter incompatible object anchors.
- Keep copied wall/opening host references valid through every transform and undo/redo operation.
- Keep user-facing errors concise and recoverable.
- Keep print rules isolated under `@media print` and retain the not-to-scale disclosure unless guaranteed-scale output is implemented and verified.

## Verification Checklist

1. Open the page and check that the canvas, toolbar, inspector, and responsive layout render without console errors.
2. Draw a wall, adjust its length and thickness, add a door/window, and confirm that openings remain attached when the wall moves.
3. Draw a room and finish it with the button, double-click, and Enter; verify room area against a hand calculation.
4. Click wall faces away from their centerlines, dimension annotations, opening symbols, room fill, and text; confirm visible surfaces select.
5. Test left-to-right and right-to-left area selection, Shift/Ctrl/Command-click multi-selection, additive marquee selection, group drag, and group delete; confirm selected wall openings remain valid.
6. Add/edit text and exercise precise move, rotate, scale, duplicate, mirror with/without copy, and undo/redo. Confirm imports preserve all entity types.
7. Test origin-grid rounding, object snapping to endpoints/midpoints/corners, drag alignment to another object, and horizontal/vertical wall drawing with snap modes independently enabled and disabled.
8. Download a project, reopen it, and compare its entities and geometry. Try malformed JSON, unsupported schema versions, duplicate IDs, and missing wall references; confirm the current project remains intact.
9. Print a representative plan to PDF; inspect page bounds, text, line weights, metadata, and the not-to-scale note.
10. Repeat the core workflow at desktop and narrow viewport widths, and verify keyboard focus and shortcuts.

There is not yet an automated test runner. Do not report browser/PDF verification as complete until it has been performed in an actual browser.