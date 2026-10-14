# Roadmap

## MVP: Schematic Drafting

- [x] Static browser workbench and SVG canvas.
- [x] Wall, door, window, room, and dimension tools.
- [x] Grid snap, zoom, pan, fit, object properties, deletion, undo, and redo.
- [x] Versioned JSON download/open with validation.
- [x] Clamp door/window width and position to the host wall.
- [x] Origin-based 1 mm snap with configurable whole-millimetre increment.
- [x] Object-anchor snapping for placement and object dragging, with visible feedback.
- [x] Optional horizontal/vertical wall constraint, independent from grid and object snap.
- [x] Full-surface object selection and window/crossing area selection with group move/delete.
- [x] Explicit room completion instructions and button, with double-click/Enter alternatives.
- [x] Text annotations with editable content and size.
- [x] Object reposition, 90° rotate, uniform scale, copy, and horizontal/vertical mirror with optional keep-original behavior.
- [x] A4 landscape browser print layout labeled not to scale.
- [x] Project specification and developer documentation.
- [ ] Verify interactions and print rendering in current Chrome and Edge at desktop and narrow viewport sizes.
- [ ] Add automated geometry and project-validation tests when a test runtime is selected.

## Next: Drafting Reliability

- Add endpoint handles and more precise coordinate entry.
- Add room boundary validation and more robust wall/opening geometry at intersections.
- Improve selection hit-testing and add multi-selection/group transforms.
- Add a sample-plan fixture and automated tests for serialization, area, dimensions, and undo/redo.

## Later: Sheet and Project Tools

- Evaluate guaranteed-scale sheet sizes and page setup with explicit print scale.
- Consider metric/imperial display conversion, reusable symbols, and multi-level projects based on user needs.
- Consider browser-local project recovery or cloud sync only after defining privacy, portability, and backup requirements.

## Not Planned for This MVP

3D/BIM, structural analysis, code compliance, team collaboration, automatic construction detailing, and permit-ready documentation are outside the initial product boundary.