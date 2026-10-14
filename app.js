const SVG_NS = 'http://www.w3.org/2000/svg';
const SCHEMA_VERSION = 1;
const DEFAULT_GRID = 1;
const DEFAULT_LAYER_ID = 'layer-default';

const svg = document.querySelector('#plan-canvas');
const stage = document.querySelector('#stage');
const entityLayer = document.querySelector('#entities');
const previewLayer = document.querySelector('#preview');
const toolButtons = [...document.querySelectorAll('button[data-tool]')];
const propertyPanel = document.querySelector('#properties');
const fileInput = document.querySelector('#project-file');
const toast = document.querySelector('#toast');
const themeToggle = document.querySelector('#theme-toggle');
const themeColor = document.querySelector('#theme-color');

let project = createProject();
let activeTool = 'select';
let gridSize = DEFAULT_GRID;
let snapEnabled = true;
let objectSnapEnabled = true;
let orthogonalWalls = false;
let lastObjectSnap = null;
let view = { x: -500, y: -350, width: 7000, height: 4800 };
let gesture = null;
let selectedId = null;
let selectedIds = new Set();
let history = [];
let historyIndex = -1;
let toastTimer;
let spacePanning = false;
let lastWallLength = null;
const touchPointers = new Map();
let pinchGesture = null;
let suspendedTouchGesture = null;

function createProject() {
    return {
        schemaVersion: SCHEMA_VERSION,
        name: 'Untitled plan',
        units: 'mm',
        layers: [{ id: DEFAULT_LAYER_ID, name: 'Layer 1', visible: true }],
        activeLayerId: DEFAULT_LAYER_ID,
        entities: [],
    };
}

function uid() {
    const id = window.crypto && typeof window.crypto.randomUUID === 'function' ?
        window.crypto.randomUUID() :
        `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    return `e-${id}`;
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function selectionIds() {
    if (selectedIds.size) return [...selectedIds];
    return selectedId ? [selectedId] : [];
}

function isAdditiveSelection(event) {
    return event.shiftKey || event.ctrlKey || event.metaKey;
}

function clearSelection() {
    selectedId = null;
    selectedIds.clear();
}

function selectOnly(id) {
    selectedId = id;
    selectedIds = id ? new Set([id]) : new Set();
}

function selectMany(ids) {
    selectedIds = new Set(ids);
    selectedId = selectedIds.size === 1 ? selectedIds.values().next().value : null;
}

function remember() {
    history = history.slice(0, historyIndex + 1);
    history.push(JSON.stringify(project));
    if (history.length > 80) history.shift();
    historyIndex = history.length - 1;
    updateHistoryButtons();
}

function restoreHistory(index) {
    if (index < 0 || index >= history.length || index === historyIndex) return;
    historyIndex = index;
    project = JSON.parse(history[historyIndex]);
    clearSelection();
    render();
    updateHistoryButtons();
}

function updateHistoryButtons() {
    document.querySelector('#undo').disabled = historyIndex <= 0;
    document.querySelector('#redo').disabled = historyIndex >= history.length - 1;
}

function showToast(message) {
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 2600);
}

function setTheme(theme) {
    const isDark = theme === 'dark';
    document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
    themeToggle.textContent = isDark ? 'Light mode' : 'Dark mode';
    themeToggle.setAttribute('aria-label', `Switch to ${isDark ? 'light' : 'dark'} mode`);
    themeToggle.setAttribute('aria-pressed', String(isDark));
    themeColor.content = isDark ? '#171b19' : '#f3f4ef';
}

let savedTheme = 'light';
try {
    savedTheme = localStorage.getItem('atelier-plan-theme') === 'dark' ? 'dark' : 'light';
} catch (error) {
    showToast('The saved appearance preference could not be loaded.');
}
setTheme(savedTheme);

themeToggle.addEventListener('click', () => {
    const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    setTheme(theme);
    try {
        localStorage.setItem('atelier-plan-theme', theme);
    } catch (error) {
        showToast('Theme changed, but the browser could not save your preference.');
    }
});

function formatLength(mm) {
    const metres = mm / 1000;
    return `${Number.isInteger(metres) ? metres.toFixed(0) : metres.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')} m`;
}

function distance(a, b) {
    return Math.hypot(b.x - a.x, b.y - a.y);
}

function polygonArea(points) {
    return Math.abs(points.reduce((sum, point, index) => {
        const next = points[(index + 1) % points.length];
        return sum + point.x * next.y - next.x * point.y;
    }, 0) / 2);
}

function pointOnWall(wall, offset) {
    const length = Math.max(1, distance({ x: wall.x1, y: wall.y1 }, { x: wall.x2, y: wall.y2 }));
    const t = Math.max(0, Math.min(1, offset / length));
    return { x: wall.x1 + (wall.x2 - wall.x1) * t, y: wall.y1 + (wall.y2 - wall.y1) * t };
}

function currentWall(opening) {
    return project.entities.find(entity => entity.id === opening.wallId && entity.type === 'wall');
}

function currentLayer() {
    return project.layers.find(layer => layer.id === project.activeLayerId) || project.layers[0];
}

function entityLayerVisible(entity) {
    const layer = project.layers.find(item => item.id === entity.layerId);
    return !layer || layer.visible !== false;
}

function svgElement(tag, attributes = {}) {
    const element = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    return element;
}

function addText(parent, text, x, y, className, attributes = {}) {
    const element = svgElement('text', { x, y, class: className, ...attributes });
    element.textContent = text;
    parent.append(element);
    return element;
}

function entityCenter(entity) {
    if (entity.type === 'wall') return { x: (entity.x1 + entity.x2) / 2, y: (entity.y1 + entity.y2) / 2 };
    if (entity.type === 'room') return entity.points.reduce((center, point) => ({ x: center.x + point.x / entity.points.length, y: center.y + point.y / entity.points.length }), { x: 0, y: 0 });
    if (entity.type === 'dimension') return { x: (entity.a.x + entity.b.x) / 2, y: (entity.a.y + entity.b.y) / 2 };
    if (entity.type === 'text') return { x: entity.x, y: entity.y };
    const wall = currentWall(entity);
    return wall ? pointOnWall(wall, entity.offset) : { x: 0, y: 0 };
}

function entityBounds(entity) {
    let points = [];
    if (entity.type === 'wall') {
        const halfThickness = entity.thickness / 2;
        points = [
            { x: entity.x1 - halfThickness, y: entity.y1 - halfThickness },
            { x: entity.x1 + halfThickness, y: entity.y1 + halfThickness },
            { x: entity.x2 - halfThickness, y: entity.y2 - halfThickness },
            { x: entity.x2 + halfThickness, y: entity.y2 + halfThickness },
        ];
    } else if (entity.type === 'room') points = entity.points;
    else if (entity.type === 'dimension') {
        const length = Math.max(1, distance(entity.a, entity.b));
        const offset = entity.offset || 250;
        const nx = -(entity.b.y - entity.a.y) / length * offset;
        const ny = (entity.b.x - entity.a.x) / length * offset;
        points = [entity.a, entity.b, { x: entity.a.x + nx, y: entity.a.y + ny }, { x: entity.b.x + nx, y: entity.b.y + ny }];
    } else if (entity.type === 'opening') {
        const wall = currentWall(entity);
        if (wall) {
            const start = pointOnWall(wall, entity.offset - entity.width / 2);
            const end = pointOnWall(wall, entity.offset + entity.width / 2);
            const length = Math.max(1, distance({ x: wall.x1, y: wall.y1 }, { x: wall.x2, y: wall.y2 }));
            const extent = entity.kind === 'door' ? Math.min(entity.width, 900) : wall.thickness / 2;
            const nx = -(wall.y2 - wall.y1) / length * extent;
            const ny = (wall.x2 - wall.x1) / length * extent;
            points = [
                { x: start.x + nx, y: start.y + ny }, { x: start.x - nx, y: start.y - ny },
                { x: end.x + nx, y: end.y + ny }, { x: end.x - nx, y: end.y - ny },
            ];
        }
    } else if (entity.type === 'text') {
        const width = Math.max(entity.size, String(entity.text || '').length * entity.size * 0.65);
        const angle = (entity.rotation || 0) * Math.PI / 180;
        points = [{ x: 0, y: -entity.size }, { x: width, y: -entity.size }, { x: width, y: entity.size }, { x: 0, y: entity.size }].map(point => ({
            x: entity.x + point.x * Math.cos(angle) - point.y * Math.sin(angle),
            y: entity.y + point.x * Math.sin(angle) + point.y * Math.cos(angle),
        }));
    }
    if (!points.length) return null;
    return {
        minX: Math.min(...points.map(point => point.x)),
        minY: Math.min(...points.map(point => point.y)),
        maxX: Math.max(...points.map(point => point.x)),
        maxY: Math.max(...points.map(point => point.y)),
    };
}

function distanceToSegment(point, start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared)) : 0;
    return distance(point, { x: start.x + dx * t, y: start.y + dy * t });
}

function pointInPolygon(point, points) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const a = points[i];
        const b = points[j];
        if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
}

function hitTestEntity(point) {
    const rect = svg.getBoundingClientRect();
    const tolerance = view.width / Math.max(1, rect.width) * 8;
    for (const entity of [...project.entities].reverse()) {
        if (!entityLayerVisible(entity)) continue;
        if (entity.type === 'wall') {
            if (distanceToSegment(point, { x: entity.x1, y: entity.y1 }, { x: entity.x2, y: entity.y2 }) <= entity.thickness / 2 + tolerance) return entity;
        } else if (entity.type === 'room') {
            if (pointInPolygon(point, entity.points) || entity.points.some((corner, index) => distanceToSegment(point, corner, entity.points[(index + 1) % entity.points.length]) <= tolerance)) return entity;
        } else if (entity.type === 'dimension') {
            const length = Math.max(1, distance(entity.a, entity.b));
            const offset = entity.offset || 250;
            const nx = -(entity.b.y - entity.a.y) / length * offset;
            const ny = (entity.b.x - entity.a.x) / length * offset;
            const p1 = { x: entity.a.x + nx, y: entity.a.y + ny };
            const p2 = { x: entity.b.x + nx, y: entity.b.y + ny };
            if (distanceToSegment(point, p1, p2) <= tolerance || distanceToSegment(point, entity.a, p1) <= tolerance || distanceToSegment(point, entity.b, p2) <= tolerance) return entity;
        } else if (entity.type === 'opening') {
            const wall = currentWall(entity);
            if (!wall) continue;
            const start = pointOnWall(wall, entity.offset - entity.width / 2);
            const end = pointOnWall(wall, entity.offset + entity.width / 2);
            if (distanceToSegment(point, start, end) <= wall.thickness / 2 + tolerance) return entity;
            if (entity.kind === 'door' && distance(point, start) <= entity.width + tolerance && distanceToSegment(point, start, { x: start.x + (wall.y2 - wall.y1) / Math.max(1, distance({ x: wall.x1, y: wall.y1 }, { x: wall.x2, y: wall.y2 })) * entity.width, y: start.y - (wall.x2 - wall.x1) / Math.max(1, distance({ x: wall.x1, y: wall.y1 }, { x: wall.x2, y: wall.y2 })) * entity.width }) <= tolerance * 2) return entity;
        } else if (entity.type === 'text') {
            const bounds = entityBounds(entity);
            if (bounds && point.x >= bounds.minX - tolerance && point.x <= bounds.maxX + tolerance && point.y >= bounds.minY - tolerance && point.y <= bounds.maxY + tolerance) return entity;
        }
    }
    return null;
}

function marqueeSelection(start, end, additive) {
    const leftToRight = end.x >= start.x;
    const rectangle = {
        minX: Math.min(start.x, end.x),
        minY: Math.min(start.y, end.y),
        maxX: Math.max(start.x, end.x),
        maxY: Math.max(start.y, end.y),
    };
    const matches = project.entities.filter(entity => {
        if (!entityLayerVisible(entity)) return false;
        const bounds = entityBounds(entity);
        if (!bounds) return false;
        if (leftToRight) return bounds.minX >= rectangle.minX && bounds.maxX <= rectangle.maxX && bounds.minY >= rectangle.minY && bounds.maxY <= rectangle.maxY;
        return bounds.maxX >= rectangle.minX && bounds.minX <= rectangle.maxX && bounds.maxY >= rectangle.minY && bounds.minY <= rectangle.maxY;
    }).map(entity => entity.id);
    if (additive) matches.push(...selectionIds());
    selectMany(matches);
}

function drawMarquee(start, end) {
    previewLayer.replaceChildren();
    previewLayer.append(svgElement('rect', {
        x: Math.min(start.x, end.x),
        y: Math.min(start.y, end.y),
        width: Math.abs(end.x - start.x),
        height: Math.abs(end.y - start.y),
        class: end.x >= start.x ? 'selection-window' : 'selection-crossing',
    }));
}

function addEntity(parent, entity) {
    const screenHitSlop = view.width / Math.max(1, svg.getBoundingClientRect().width) * 8;
    const group = svgElement('g', {
        class: `entity entity-${entity.type}${selectedIds.has(entity.id) || selectedId === entity.id ? ' is-selected' : ''}`,
        'data-id': entity.id,
    });
    group.addEventListener('pointerdown', onEntityPointerDown);

    if (entity.type === 'wall') {
        group.append(svgElement('line', {
            x1: entity.x1,
            y1: entity.y1,
            x2: entity.x2,
            y2: entity.y2,
            class: 'wall-hit',
            'stroke-width': entity.thickness + screenHitSlop * 2,
        }));
        group.append(svgElement('line', {
            x1: entity.x1,
            y1: entity.y1,
            x2: entity.x2,
            y2: entity.y2,
            class: 'wall-line',
            'stroke-width': entity.thickness,
        }));
    }

    if (entity.type === 'opening') {
        const wall = currentWall(entity);
        if (wall) {
            const start = pointOnWall(wall, entity.offset - entity.width / 2);
            const end = pointOnWall(wall, entity.offset + entity.width / 2);
            group.append(svgElement('line', { x1: start.x, y1: start.y, x2: end.x, y2: end.y, class: 'opening-hit', 'stroke-width': Math.max(200, wall.thickness + screenHitSlop * 2) }));
            group.append(svgElement('line', {
                x1: start.x,
                y1: start.y,
                x2: end.x,
                y2: end.y,
                class: 'opening-cut',
                'stroke-width': wall.thickness + 12,
            }));
            if (entity.kind === 'door') {
                const radius = Math.min(entity.width, 900);
                const swingSide = entity.swingSide === -1 ? -1 : 1;
                const hingeSide = entity.hingeSide === -1 ? -1 : 1;
                const wallLength = Math.max(1, distance({ x: wall.x1, y: wall.y1 }, { x: wall.x2, y: wall.y2 }));
                const tangent = { x: (wall.x2 - wall.x1) / wallLength, y: (wall.y2 - wall.y1) / wallLength };
                const hinge = hingeSide === 1 ? start : end;
                const leafEnd = { x: hinge.x + tangent.y * radius * swingSide, y: hinge.y - tangent.x * radius * swingSide };
                const arcEnd = { x: hinge.x + tangent.x * radius * hingeSide, y: hinge.y + tangent.y * radius * hingeSide };
                const sweep = swingSide === hingeSide ? 1 : 0;
                const arcPath = `M ${leafEnd.x} ${leafEnd.y} A ${radius} ${radius} 0 0 ${sweep} ${arcEnd.x} ${arcEnd.y}`;
                group.append(svgElement('line', { x1: hinge.x, y1: hinge.y, x2: leafEnd.x, y2: leafEnd.y, class: 'opening-symbol-hit', 'stroke-width': screenHitSlop * 2 }));
                group.append(svgElement('path', { d: arcPath, class: 'opening-symbol-hit', 'stroke-width': screenHitSlop * 2 }));
                group.append(svgElement('line', { x1: hinge.x, y1: hinge.y, x2: leafEnd.x, y2: leafEnd.y, class: 'door-leaf' }));
                group.append(svgElement('path', { d: arcPath, class: 'door-arc' }));
            } else {
                group.append(svgElement('line', { x1: start.x, y1: start.y, x2: end.x, y2: end.y, class: 'window-line', 'stroke-width': 36 }));
                group.append(svgElement('line', { x1: start.x, y1: start.y - 38, x2: end.x, y2: end.y - 38, class: 'window-line', 'stroke-width': 18 }));
                group.append(svgElement('line', { x1: start.x, y1: start.y + 38, x2: end.x, y2: end.y + 38, class: 'window-line', 'stroke-width': 18 }));
            }
        }
    }

    if (entity.type === 'room') {
        const points = entity.points.map(point => `${point.x},${point.y}`).join(' ');
        group.append(svgElement('polygon', { points, class: 'room-shape' }));
        const center = entity.points.reduce((sum, point) => ({ x: sum.x + point.x / entity.points.length, y: sum.y + point.y / entity.points.length }), { x: 0, y: 0 });
        addText(group, entity.name || 'Room', center.x, center.y - 24, 'room-name', { 'text-anchor': 'middle' });
        addText(group, `${(polygonArea(entity.points) / 1_000_000).toFixed(1)} m²`, center.x, center.y + 120, 'room-area', { 'text-anchor': 'middle' });
    }

    if (entity.type === 'dimension') {
        const { a, b, offset = 250 } = entity;
        const length = Math.max(1, distance(a, b));
        const nx = -(b.y - a.y) / length * offset;
        const ny = (b.x - a.x) / length * offset;
        const p1 = { x: a.x + nx, y: a.y + ny };
        const p2 = { x: b.x + nx, y: b.y + ny };
        const dimensionHitWidth = screenHitSlop * 2;
        group.append(svgElement('line', { x1: a.x, y1: a.y, x2: p1.x, y2: p1.y, class: 'dimension-hit-line', 'stroke-width': dimensionHitWidth }));
        group.append(svgElement('line', { x1: b.x, y1: b.y, x2: p2.x, y2: p2.y, class: 'dimension-hit-line', 'stroke-width': dimensionHitWidth }));
        group.append(svgElement('line', { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, class: 'dimension-hit-line', 'stroke-width': dimensionHitWidth }));
        group.append(svgElement('line', { x1: a.x, y1: a.y, x2: p1.x, y2: p1.y, class: 'dimension-extension' }));
        group.append(svgElement('line', { x1: b.x, y1: b.y, x2: p2.x, y2: p2.y, class: 'dimension-extension' }));
        group.append(svgElement('line', { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, class: 'dimension-line' }));
        const center = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
        addText(group, formatLength(distance(a, b)), center.x, center.y - 42, 'dimension-label', { 'text-anchor': 'middle' });
    }

    if (entity.type === 'text') {
        const label = svgElement('text', {
            x: entity.x,
            y: entity.y,
            class: 'plan-text',
            'font-size': entity.size,
            transform: `rotate(${entity.rotation || 0} ${entity.x} ${entity.y})`,
        });
        String(entity.text || '').split('\n').forEach((line, index) => {
            const span = svgElement('tspan', { x: entity.x, dy: index === 0 ? 0 : entity.size * 1.2 });
            span.textContent = line;
            label.append(span);
        });
        group.append(label);
    }

    parent.append(group);
}

function render() {
    svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.width} ${view.height}`);
    const gridPattern = document.querySelector('#grid-pattern');
    const screenScale = view.width / Math.max(1, svg.getBoundingClientRect().width);
    const rawGridMultiple = Math.max(1, screenScale * 18 / gridSize);
    const gridPower = 10 ** Math.floor(Math.log10(rawGridMultiple));
    const gridMultiple = [1, 2, 5, 10].find(value => value * gridPower >= rawGridMultiple) || 10 * gridPower;
    const visibleGridStep = gridSize * gridMultiple;
    gridPattern.setAttribute('width', visibleGridStep);
    gridPattern.setAttribute('height', visibleGridStep);
    gridPattern.querySelector('circle').setAttribute('r', Math.min(14, Math.max(4, visibleGridStep * 0.08)));
    document.querySelector('#grid-fill').style.display = snapEnabled ? '' : 'none';
    entityLayer.replaceChildren();
    previewLayer.replaceChildren();
    for (const entity of project.entities) {
        if (entityLayerVisible(entity)) addEntity(entityLayer, entity);
    }
    stage.classList.toggle('has-entities', project.entities.length > 0);
    document.querySelector('#project-name').value = project.name;
    document.querySelector('#zoom-value').textContent = `${Math.round(7000 / view.width * 100)}%`;
    updateProperties();
    updateLayers();
    updateStatus();
}

function updateStatus() {
    document.querySelector('#entity-count').textContent = `${project.entities.length} objects`;
    document.querySelector('#tool-status').textContent = `${activeTool[0].toUpperCase()}${activeTool.slice(1)} tool`;
    document.querySelector('#snap-status').textContent = `${snapEnabled ? `Grid ${gridSize} mm` : 'Grid off'} · Obj ${objectSnapEnabled ? 'on' : 'off'} · 90° ${orthogonalWalls ? 'on' : 'off'}`;
    const instructions = {
        select: 'Click an object to select and drag it',
        'area-select': 'Drag a box around objects · left to right selects inside, right to left crosses',
        wall: gesture ? `${orthogonalWalls ? '90° constrained · ' : ''}Enter a length and press Enter, or click an end point` : `${orthogonalWalls ? '90° walls · ' : ''}Click a start point, then enter a length or click the end point`,
        door: 'Click near a wall to place a door',
        window: 'Click near a wall to place a window',
        room: gesture && gesture.points ? `${gesture.points.length} corner${gesture.points.length === 1 ? '' : 's'} placed · add at least 3, then finish` : 'Click room corners, then choose Finish room or double-click',
        dimension: gesture ? 'Click the second point to finish the dimension' : 'Click the two points to measure',
        text: 'Click where the text should start, then edit it in Properties',
    };
    document.querySelector('#tool-instruction-text').textContent = instructions[activeTool];
    document.querySelector('#finish-room').hidden = activeTool !== 'room' || !gesture || gesture.points.length < 3;
}

function entitySnapAnchors(entity) {
    if (entity.type === 'wall') return [
        { x: entity.x1, y: entity.y1, kind: 'endpoint' },
        { x: entity.x2, y: entity.y2, kind: 'endpoint' },
        { x: (entity.x1 + entity.x2) / 2, y: (entity.y1 + entity.y2) / 2, kind: 'midpoint' },
    ];
    if (entity.type === 'room') return [
        ...entity.points.map(point => ({ ...point, kind: 'corner' })),
        { ...entityCenter(entity), kind: 'center' },
    ];
    if (entity.type === 'dimension') return [
        { ...entity.a, kind: 'endpoint' },
        { ...entity.b, kind: 'endpoint' },
        { ...entityCenter(entity), kind: 'midpoint' },
    ];
    if (entity.type === 'opening') return [{ ...entityCenter(entity), kind: 'opening' }];
    if (entity.type === 'text') return [{ x: entity.x, y: entity.y, kind: 'text' }];
    return [];
}

function objectSnapTargets(excludedIds = new Set()) {
    return project.entities
        .filter(entity => !excludedIds.has(entity.id) && entityLayerVisible(entity))
        .flatMap(entity => entitySnapAnchors(entity).map(anchor => ({ ...anchor, entityId: entity.id })));
}

function snappedMoveDelta(entity, original, dx, dy, movingIds = []) {
    if (!objectSnapEnabled) return { dx, dy };
    const excludedIds = new Set([...movingIds, entity.id]);
    if (entity.type === 'wall') {
        project.entities.filter(item => item.type === 'opening' && item.wallId === entity.id).forEach(item => excludedIds.add(item.id));
    }
    if (entity.type === 'opening') excludedIds.add(entity.wallId);
    const targets = objectSnapTargets(excludedIds);
    const anchors = entitySnapAnchors(original);
    const rect = svg.getBoundingClientRect();
    const tolerance = Math.max(1, view.width / Math.max(1, rect.width) * 12);
    let nearest = null;
    for (const anchor of anchors) {
        const moved = { x: anchor.x + dx, y: anchor.y + dy };
        for (const target of targets) {
            const separation = distance(moved, target);
            if (separation <= tolerance && (!nearest || separation < nearest.separation)) {
                nearest = { target, separation, correction: { x: target.x - moved.x, y: target.y - moved.y } };
            }
        }
    }
    if (!nearest) return { dx, dy };
    lastObjectSnap = nearest.target;
    return { dx: dx + nearest.correction.x, dy: dy + nearest.correction.y };
}

function constrainWallPoint(point, start) {
    const dx = point.x - start.x;
    const dy = point.y - start.y;
    return Math.abs(dx) >= Math.abs(dy)
        ? { x: point.x, y: start.y }
        : { x: start.x, y: point.y };
}

function screenPoint(event, options = {}) {
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const matrix = svg.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const local = point.matrixTransform(matrix.inverse());
    lastObjectSnap = null;

    let wallStart = options.wallStart;
    if (wallStart === undefined && options.useCurrentWallGesture !== false && activeTool === 'wall' && gesture && !gesture.type) {
        wallStart = gesture.start;
    }
    const constrain = options.orthogonal !== false && orthogonalWalls && wallStart;
    const candidate = constrain ? constrainWallPoint(local, wallStart) : local;
    const rect = svg.getBoundingClientRect();
    const tolerance = Math.max(1, view.width / Math.max(1, rect.width) * 12);

    if (options.objects !== false && objectSnapEnabled) {
        let nearest = null;
        for (const target of objectSnapTargets(options.excludedIds)) {
            let snapPoint = { x: target.x, y: target.y };
            if (constrain) {
                const vertical = Math.abs(target.x - wallStart.x) <= tolerance;
                const horizontal = Math.abs(target.y - wallStart.y) <= tolerance;
                if (vertical && (!horizontal || Math.abs(candidate.x - wallStart.x) <= Math.abs(candidate.y - wallStart.y))) {
                    snapPoint.x = wallStart.x;
                } else if (horizontal) {
                    snapPoint.y = wallStart.y;
                } else {
                    continue;
                }
            }
            const separation = distance(candidate, snapPoint);
            if (separation <= tolerance && (!nearest || separation < nearest.separation)) {
                nearest = { ...target, point: snapPoint, separation };
            }
        }
        if (nearest) {
            lastObjectSnap = nearest;
            return nearest.point;
        }
    }

    let result = candidate;
    if (snapEnabled && options.grid !== false) {
        result = { x: Math.round(result.x / gridSize) * gridSize, y: Math.round(result.y / gridSize) * gridSize };
    }
    return constrain ? constrainWallPoint(result, wallStart) : result;
}

function setTool(tool) {
    activeTool = tool;
    toolButtons.forEach(button => {
        const active = button.dataset.tool === tool;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
    });
    svg.dataset.tool = tool;
    gesture = null;
    previewLayer.replaceChildren();
    document.querySelector('#wall-length-control').hidden = true;
    updateStatus();
}

function commitWallLength() {
    if (activeTool !== 'wall' || !gesture || !gesture.start) return;
    const lengthInput = document.querySelector('#wall-length-input');
    const length = Number(lengthInput.value);
    if (!Number.isFinite(length) || length < 10) {
        showToast('Enter a wall length of at least 10 mm.');
        lengthInput.focus();
        return;
    }
    const start = gesture.start;
    const direction = gesture.direction || { x: 1, y: 0 };
    const magnitude = Math.hypot(direction.x, direction.y) || 1;
    const endpoint = {
        x: start.x + direction.x / magnitude * length,
        y: start.y + direction.y / magnitude * length,
    };
    gesture = null;
    document.querySelector('#wall-length-control').hidden = true;
    previewLayer.replaceChildren();
    addWall(start, endpoint);
    lastWallLength = length;
    updateStatus();
}

function addWall(a, b) {
    const length = distance(a, b);
    if (length < 10) return;
    lastWallLength = Math.round(length);
    project.entities.push({ id: uid(), type: 'wall', x1: a.x, y1: a.y, x2: b.x, y2: b.y, thickness: 180, layerId: currentLayer().id });
    selectOnly(project.entities.at(-1).id);
    remember();
    render();
}

function addOpening(point, kind) {
    const walls = project.entities.filter(entity => entity.type === 'wall' && entityLayerVisible(entity));
    let best = null;
    for (const wall of walls) {
        const dx = wall.x2 - wall.x1;
        const dy = wall.y2 - wall.y1;
        const length = Math.hypot(dx, dy);
        const t = Math.max(0, Math.min(1, ((point.x - wall.x1) * dx + (point.y - wall.y1) * dy) / (length * length)));
        const projected = { x: wall.x1 + t * dx, y: wall.y1 + t * dy };
        const separation = distance(point, projected);
        if (!best || separation < best.separation) best = { wall, t, separation, length };
    }
    if (!best || best.separation > 500 || best.length < 600) {
        showToast('Place an opening near a wall.');
        return;
    }
    const width = Math.min(kind === 'door' ? 900 : 1200, best.length);
    const offset = Math.max(width / 2, Math.min(best.length - width / 2, best.t * best.length));
    project.entities.push({ id: uid(), type: 'opening', kind, wallId: best.wall.id, offset, width, layerId: currentLayer().id });
    selectOnly(project.entities.at(-1).id);
    remember();
    render();
}

function finishRoom(points) {
    if (points.length < 3) return;
    project.entities.push({ id: uid(), type: 'room', name: 'Room', points, layerId: currentLayer().id });
    selectOnly(project.entities.at(-1).id);
    remember();
    render();
    setTool('select');
}

function drawPreview(point) {
    previewLayer.replaceChildren();
    if (lastObjectSnap) {
        const rect = svg.getBoundingClientRect();
        const radius = 8 * view.width / Math.max(1, rect.width);
        previewLayer.append(svgElement('circle', {
            cx: point.x,
            cy: point.y,
            r: radius,
            class: 'object-snap-marker',
            'aria-label': `Snapped to ${lastObjectSnap.kind}`,
        }));
    }
    if (!gesture) return;
    if (activeTool === 'wall' || activeTool === 'dimension') {
        const start = activeTool === 'wall' ? gesture.start : gesture.points[0];
        if (!start) return;
        let endpoint = point;
        if (activeTool === 'wall' && gesture.direction) {
            const enteredLength = Number(document.querySelector('#wall-length-input').value);
            if (Number.isFinite(enteredLength) && enteredLength >= 10) {
                const magnitude = Math.hypot(gesture.direction.x, gesture.direction.y) || 1;
                endpoint = {
                    x: start.x + gesture.direction.x / magnitude * enteredLength,
                    y: start.y + gesture.direction.y / magnitude * enteredLength,
                };
            }
        }
        previewLayer.append(svgElement('line', {
            x1: start.x,
            y1: start.y,
            x2: endpoint.x,
            y2: endpoint.y,
            class: activeTool === 'wall' ? 'wall-preview' : 'dimension-preview',
        }));
    }
    if (activeTool === 'room' && gesture.points.length) {
        const points = [...gesture.points, point].map(value => `${value.x},${value.y}`).join(' ');
        previewLayer.append(svgElement('polyline', { points, class: 'room-preview' }));
    }
}

function onCanvasPointerDown(event) {
    if (event.pointerType === 'touch') {
        touchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (touchPointers.size >= 2) {
            if (!pinchGesture) beginPinch([...touchPointers.keys()].slice(0, 2));
            svg.setPointerCapture(event.pointerId);
            event.preventDefault();
            return;
        }
    }
    if (event.button === 1 || spacePanning) {
        gesture = { type: 'pan', x: event.clientX, y: event.clientY, viewX: view.x, viewY: view.y };
        svg.setPointerCapture(event.pointerId);
        event.preventDefault();
        return;
    }
    if (event.button !== 0) return;
    if (activeTool === 'select' || activeTool === 'area-select') {
        handleCanvasSelection(event);
        return;
    }
    const point = screenPoint(event);
    if (activeTool === 'wall') {
        if (!gesture) {
            gesture = { start: point, direction: { x: 1, y: 0 } };
            const lengthInput = document.querySelector('#wall-length-input');
            lengthInput.value = lastWallLength === null ? '' : String(Math.round(lastWallLength));
            document.querySelector('#wall-length-control').hidden = false;
            lengthInput.focus();
            lengthInput.select();
            updateStatus();
        } else {
            addWall(gesture.start, point);
            gesture = null;
            previewLayer.replaceChildren();
            document.querySelector('#wall-length-control').hidden = true;
            updateStatus();
        }
    } else if (activeTool === 'door' || activeTool === 'window') {
        addOpening(point, activeTool);
    } else if (activeTool === 'text') {
        project.entities.push({ id: uid(), type: 'text', x: point.x, y: point.y, text: 'Text', size: 220, rotation: 0, layerId: currentLayer().id });
        selectOnly(project.entities.at(-1).id);
        setTool('select');
        remember();
        render();
    } else if (activeTool === 'room') {
        if (event.detail > 1 && gesture) finishRoom(gesture.points);
        else {
            if (!gesture) gesture = { points: [] };
            gesture.points.push(point);
            drawPreview(point);
            updateStatus();
        }
    } else if (activeTool === 'dimension') {
        if (!gesture) {
            gesture = { points: [point] };
            updateStatus();
        } else {
            project.entities.push({ id: uid(), type: 'dimension', a: gesture.points[0], b: point, offset: 260, layerId: currentLayer().id });
            selectOnly(project.entities.at(-1).id);
            gesture = null;
            remember();
            render();
        }
    }
    svg.setPointerCapture(event.pointerId);
}

function beginPinch(pointerIds) {
    const first = touchPointers.get(pointerIds[0]);
    const second = touchPointers.get(pointerIds[1]);
    const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
    if (!suspendedTouchGesture) {
        suspendedTouchGesture = gesture && !gesture.type && (gesture.start || gesture.points) ? gesture : null;
    }
    pinchGesture = {
        pointerIds,
        startDistance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
        startView: { ...view },
        anchor: screenPoint({ clientX: midpoint.x, clientY: midpoint.y }, {
            grid: false,
            objects: false,
            orthogonal: false,
            useCurrentWallGesture: false,
        }),
    };
    gesture = null;
    previewLayer.replaceChildren();
}

function updatePinch() {
    const first = touchPointers.get(pinchGesture.pointerIds[0]);
    const second = touchPointers.get(pinchGesture.pointerIds[1]);
    if (!first || !second) return;
    const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
    const currentDistance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
    const startView = pinchGesture.startView;
    const nextWidth = Math.max(1200, Math.min(50000, startView.width * pinchGesture.startDistance / currentDistance));
    const ratio = nextWidth / startView.width;
    view = {
        x: pinchGesture.anchor.x - (pinchGesture.anchor.x - startView.x) * ratio,
        y: pinchGesture.anchor.y - (pinchGesture.anchor.y - startView.y) * ratio,
        width: nextWidth,
        height: startView.height * ratio,
    };
    svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.width} ${view.height}`);
    const worldAtMidpoint = screenPoint({ clientX: midpoint.x, clientY: midpoint.y }, {
        grid: false,
        objects: false,
        orthogonal: false,
        useCurrentWallGesture: false,
    });
    view.x += pinchGesture.anchor.x - worldAtMidpoint.x;
    view.y += pinchGesture.anchor.y - worldAtMidpoint.y;
    render();
}

function onEntityPointerDown(event) {
    if (!['select', 'area-select'].includes(activeTool) || event.button !== 0) return;
    event.stopPropagation();
    const entity = project.entities.find(item => item.id === event.currentTarget.dataset.id);
    if (!entity) return;
    beginEntityMove(entity, event);
    svg.setPointerCapture(event.pointerId);
}

function beginEntityMove(entity, event) {
    let ids = selectionIds();
    if (isAdditiveSelection(event)) {
        ids = ids.includes(entity.id) ? ids.filter(id => id !== entity.id) : [...ids, entity.id];
        selectMany(ids);
    } else if (!ids.includes(entity.id)) {
        selectOnly(entity.id);
        ids = [entity.id];
    }
    if (!ids.includes(entity.id)) {
        render();
        return;
    }
    const point = screenPoint(event, { grid: false, objects: false, orthogonal: false, useCurrentWallGesture: false });
    const movingIds = new Set(ids);
    const moves = ids
        .map(id => project.entities.find(item => item.id === id))
        .filter(item => item && !(item.type === 'opening' && movingIds.has(item.wallId)))
        .map(item => ({ id: item.id, original: clone(item) }));
    gesture = { type: 'move', ids, moves, primaryId: entity.id, start: point, changed: false };
    render();
}

function moveEntity(entity, original, dx, dy) {
    if (entity.type === 'wall') {
        entity.x1 = original.x1 + dx;
        entity.y1 = original.y1 + dy;
        entity.x2 = original.x2 + dx;
        entity.y2 = original.y2 + dy;
    } else if (entity.type === 'room') {
        entity.points = original.points.map(point => ({ x: point.x + dx, y: point.y + dy }));
    } else if (entity.type === 'dimension') {
        entity.a = { x: original.a.x + dx, y: original.a.y + dy };
        entity.b = { x: original.b.x + dx, y: original.b.y + dy };
    } else if (entity.type === 'text') {
        entity.x = original.x + dx;
        entity.y = original.y + dy;
    } else if (entity.type === 'opening') {
        const wall = currentWall(entity);
        if (wall) {
            const length = Math.hypot(wall.x2 - wall.x1, wall.y2 - wall.y1);
            const offsetDelta = (dx * (wall.x2 - wall.x1) + dy * (wall.y2 - wall.y1)) / Math.max(1, length);
            entity.offset = Math.max(entity.width / 2, Math.min(length - entity.width / 2, original.offset + offsetDelta));
        }
    }
}

function transformedPoint(point, center, transform) {
    return transform({ x: point.x - center.x, y: point.y - center.y });
}

function rotateEntity(entity, degrees) {
    const center = entityCenter(entity);
    const radians = degrees * Math.PI / 180;
    const rotate = point => {
        const relative = transformedPoint(point, center, value => value);
        return {
            x: center.x + relative.x * Math.cos(radians) - relative.y * Math.sin(radians),
            y: center.y + relative.x * Math.sin(radians) + relative.y * Math.cos(radians),
        };
    };
    if (entity.type === 'wall') {
        const start = rotate({ x: entity.x1, y: entity.y1 });
        const end = rotate({ x: entity.x2, y: entity.y2 });
        Object.assign(entity, { x1: start.x, y1: start.y, x2: end.x, y2: end.y });
    } else if (entity.type === 'room') entity.points = entity.points.map(rotate);
    else if (entity.type === 'dimension') {
        entity.a = rotate(entity.a);
        entity.b = rotate(entity.b);
    } else if (entity.type === 'text') entity.rotation = (entity.rotation || 0) + degrees;
    else if (entity.type === 'opening') {
        const wall = currentWall(entity);
        if (wall) {
            const start = rotate({ x: wall.x1, y: wall.y1 });
            const end = rotate({ x: wall.x2, y: wall.y2 });
            Object.assign(wall, { x1: start.x, y1: start.y, x2: end.x, y2: end.y });
        }
    }
}

function scaleEntity(entity, factor) {
    const center = entityCenter(entity);
    const scalePoint = point => ({ x: center.x + (point.x - center.x) * factor, y: center.y + (point.y - center.y) * factor });
    if (entity.type === 'wall') {
        const start = scalePoint({ x: entity.x1, y: entity.y1 });
        const end = scalePoint({ x: entity.x2, y: entity.y2 });
        const oldLength = distance({ x: entity.x1, y: entity.y1 }, { x: entity.x2, y: entity.y2 });
        const newLength = distance(start, end);
        Object.assign(entity, { x1: start.x, y1: start.y, x2: end.x, y2: end.y, thickness: entity.thickness * factor });
        for (const opening of project.entities.filter(item => item.type === 'opening' && item.wallId === entity.id)) {
            opening.offset = oldLength / 2 + (opening.offset - oldLength / 2) * factor;
            opening.width = Math.min(opening.width * factor, newLength);
            opening.offset = Math.max(opening.width / 2, Math.min(newLength - opening.width / 2, opening.offset));
        }
    } else if (entity.type === 'room') entity.points = entity.points.map(scalePoint);
    else if (entity.type === 'dimension') {
        entity.a = scalePoint(entity.a);
        entity.b = scalePoint(entity.b);
        entity.offset *= factor;
    } else if (entity.type === 'text') entity.size = Math.max(10, entity.size * factor);
    else if (entity.type === 'opening') {
        const wall = currentWall(entity);
        const wallLength = wall ? distance({ x: wall.x1, y: wall.y1 }, { x: wall.x2, y: wall.y2 }) : entity.width;
        entity.width = Math.min(wallLength, Math.max(100, entity.width * factor));
        entity.offset = Math.max(entity.width / 2, Math.min(wallLength - entity.width / 2, entity.offset));
    }
}

function mirrorEntity(entity, axis) {
    const center = entityCenter(entity);
    const mirrorPoint = point => axis === 'horizontal' ? { x: point.x, y: center.y * 2 - point.y } : { x: center.x * 2 - point.x, y: point.y };
    if (entity.type === 'wall') {
        const start = mirrorPoint({ x: entity.x1, y: entity.y1 });
        const end = mirrorPoint({ x: entity.x2, y: entity.y2 });
        Object.assign(entity, { x1: start.x, y1: start.y, x2: end.x, y2: end.y });
    } else if (entity.type === 'room') entity.points = entity.points.map(mirrorPoint);
    else if (entity.type === 'dimension') {
        entity.a = mirrorPoint(entity.a);
        entity.b = mirrorPoint(entity.b);
    } else if (entity.type === 'text') entity.rotation = axis === 'horizontal' ? -(entity.rotation || 0) : 180 - (entity.rotation || 0);
    else if (entity.type === 'opening') {
        const wall = currentWall(entity);
        if (wall && entity.kind === 'door') {
            const mostlyHorizontal = Math.abs(wall.x2 - wall.x1) >= Math.abs(wall.y2 - wall.y1);
            const flipSwing = (axis === 'horizontal' && mostlyHorizontal) || (axis === 'vertical' && !mostlyHorizontal);
            if (flipSwing) entity.swingSide = -(entity.swingSide || 1);
            else entity.hingeSide = -(entity.hingeSide || 1);
        }
    }
}

function copyEntity(entity, includeWallOpenings = true) {
    if (entity.type === 'opening' && includeWallOpenings) {
        const wall = currentWall(entity);
        if (wall) {
            const sourceOpenings = project.entities.filter(item => item.type === 'opening' && item.wallId === wall.id);
            const sourceIndex = sourceOpenings.findIndex(opening => opening.id === entity.id);
            const wallCopy = clone(wall);
            wallCopy.id = uid();
            project.entities.push(wallCopy);
            const openingCopies = sourceOpenings.map(opening => ({...clone(opening), id: uid(), wallId: wallCopy.id }));
            project.entities.push(...openingCopies);
            return openingCopies[sourceIndex];
        }
    }
    if (entity.type === 'wall' && includeWallOpenings) {
        const wallCopy = clone(entity);
        wallCopy.id = uid();
        project.entities.push(wallCopy);
        const openingCopies = project.entities.filter(item => item.type === 'opening' && item.wallId === entity.id).map(opening => ({...clone(opening), id: uid(), wallId: wallCopy.id }));
        project.entities.push(...openingCopies);
        return wallCopy;
    }
    const copy = clone(entity);
    copy.id = uid();
    project.entities.push(copy);
    return copy;
}

function duplicateSelection() {
    const entity = project.entities.find(item => item.id === selectedId);
    if (!entity) return;
    const copy = copyEntity(entity, entity.type === 'wall');
    if (copy.type === 'opening') {
        const wall = currentWall(copy);
        if (wall) {
            const length = distance({ x: wall.x1, y: wall.y1 }, { x: wall.x2, y: wall.y2 });
            const nextOffset = Math.min(length - copy.width / 2, entity.offset + copy.width + Math.max(100, gridSize));
            copy.offset = nextOffset === entity.offset ? Math.max(copy.width / 2, entity.offset - copy.width - Math.max(100, gridSize)) : nextOffset;
        }
    } else {
        const original = clone(copy);
        const nudge = Math.max(500, gridSize);
        moveEntity(copy, original, nudge, nudge);
    }
    selectOnly(copy.id);
    remember();
    render();
}

function applyTransform(action, value) {
    const entity = project.entities.find(item => item.id === selectedId);
    if (!entity) return;
    let target = entity;
    const copyOriginal = document.querySelector('#keep-original').checked;
    if (copyOriginal) {
        target = copyEntity(entity, entity.type === 'wall' || (entity.type === 'opening' && action === 'rotate'));
        selectOnly(target.id);
    }
    if (action === 'rotate') rotateEntity(target, value);
    if (action === 'scale') scaleEntity(target, value);
    if (action === 'mirror') mirrorEntity(target, value);
    remember();
    render();
}

function applyPosition() {
    const entity = project.entities.find(item => item.id === selectedId);
    if (!entity) return;
    const center = entityCenter(entity);
    const x = Number(document.querySelector('#position-x').value);
    const y = Number(document.querySelector('#position-y').value);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    moveEntity(entity, clone(entity), x - center.x, y - center.y);
    remember();
    render();
}

function onPointerMove(event) {
    if (event.pointerType === 'touch' && touchPointers.has(event.pointerId)) {
        touchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (pinchGesture) {
            updatePinch();
            return;
        }
    }
    if (!gesture) {
        drawPreview(screenPoint(event));
        return;
    }
    if (gesture.type === 'pan') {
        const rect = svg.getBoundingClientRect();
        view.x = gesture.viewX - (event.clientX - gesture.x) * view.width / rect.width;
        view.y = gesture.viewY - (event.clientY - gesture.y) * view.height / rect.height;
        render();
        return;
    }
    if (gesture.type === 'marquee') {
        gesture.current = screenPoint(event, { grid: false, objects: false, orthogonal: false, useCurrentWallGesture: false });
        drawMarquee(gesture.start, gesture.current);
        return;
    }
    if (gesture.type === 'move') {
        const primaryMove = gesture.moves.find(item => item.id === gesture.primaryId) || gesture.moves[0];
        const primaryEntity = primaryMove && project.entities.find(item => item.id === primaryMove.id);
        if (!primaryEntity || !primaryMove) return;
        const point = screenPoint(event, { objects: false, orthogonal: false, useCurrentWallGesture: false });
        const delta = snappedMoveDelta(primaryEntity, primaryMove.original, point.x - gesture.start.x, point.y - gesture.start.y, gesture.ids);
        for (const move of gesture.moves) {
            const entity = project.entities.find(item => item.id === move.id);
            if (entity) moveEntity(entity, move.original, delta.dx, delta.dy);
        }
        gesture.changed = true;
        render();
        drawPreview(point);
        return;
    }
    let previewPoint = null;
    if (activeTool === 'wall' && gesture.start) {
        const rawPoint = screenPoint(event, { grid: false, objects: false, orthogonal: false, useCurrentWallGesture: false });
        const dx = rawPoint.x - gesture.start.x;
        const dy = rawPoint.y - gesture.start.y;
        if (orthogonalWalls) {
            gesture.direction = Math.abs(dx) >= Math.abs(dy) ? { x: Math.sign(dx) || 1, y: 0 } : { x: 0, y: Math.sign(dy) || 1 };
        } else if (Math.hypot(dx, dy) > 0) {
            gesture.direction = { x: dx, y: dy };
        }
        previewPoint = screenPoint(event);
        gesture.previewPoint = previewPoint;
    }
    drawPreview(previewPoint || screenPoint(event));
}

function onPointerUp(event) {
    if (event && event.pointerType === 'touch' && touchPointers.has(event.pointerId)) {
        const wasPinching = Boolean(pinchGesture);
        touchPointers.delete(event.pointerId);
        if (wasPinching) {
            const remainingIds = [...touchPointers.keys()];
            pinchGesture = null;
            if (remainingIds.length >= 2) {
                beginPinch(remainingIds.slice(0, 2));
            } else if (remainingIds.length === 1) {
                const remaining = touchPointers.get(remainingIds[0]);
                gesture = { type: 'pan', x: remaining.x, y: remaining.y, viewX: view.x, viewY: view.y };
            } else {
                gesture = suspendedTouchGesture;
                suspendedTouchGesture = null;
                if (gesture) drawPreview(screenPoint({ clientX: event.clientX, clientY: event.clientY }));
            }
            event.preventDefault();
            return;
        }
    }
    if (gesture && gesture.type === 'marquee') {
        const moved = Math.hypot(gesture.current.x - gesture.start.x, gesture.current.y - gesture.start.y);
        const rect = svg.getBoundingClientRect();
        const threshold = view.width / Math.max(1, rect.width) * 5;
        if (moved >= threshold) marqueeSelection(gesture.start, gesture.current, gesture.additive);
        else if (!gesture.additive) clearSelection();
        gesture = null;
        previewLayer.replaceChildren();
        render();
        return;
    }
    if (gesture && gesture.type === 'move' && gesture.changed) remember();
    if (gesture && (gesture.type === 'pan' || gesture.type === 'move')) gesture = null;
    if (event && event.pointerType === 'touch' && touchPointers.size === 0 && suspendedTouchGesture) {
        gesture = suspendedTouchGesture;
        suspendedTouchGesture = null;
        drawPreview(screenPoint({ clientX: event.clientX, clientY: event.clientY }));
    }
}

function updateProperties() {
    const ids = selectionIds();
    const entity = ids.length === 1 ? project.entities.find(item => item.id === ids[0]) : null;
    propertyPanel.replaceChildren();
    const transformPanel = document.querySelector('#transform-panel');
    if (ids.length > 1) {
        const message = document.createElement('p');
        message.className = 'empty-properties';
        message.textContent = `${ids.length} objects selected. Drag any selected object to move them together.`;
        propertyPanel.append(message);
        const remove = document.createElement('button');
        remove.className = 'danger-button';
        remove.textContent = 'Delete selected objects';
        remove.addEventListener('click', deleteSelection);
        propertyPanel.append(remove);
        appendArrangementControls(propertyPanel);
        transformPanel.hidden = true;
        return;
    }
    if (!entity) {
        propertyPanel.innerHTML = '<p class="empty-properties">Select an object to edit its dimensions and properties.</p>';
        transformPanel.hidden = true;
        return;
    }
    const title = document.createElement('h3');
    title.textContent = entity.type === 'opening' ? entity.kind : entity.type;
    propertyPanel.append(title);
    const fields = [];
    if (entity.type === 'wall') {
        fields.push({ label: 'Length (mm)', value: Math.round(distance({ x: entity.x1, y: entity.y1 }, { x: entity.x2, y: entity.y2 })), key: 'length' });
        fields.push({ label: 'Thickness (mm)', value: entity.thickness, key: 'thickness' });
    } else if (entity.type === 'opening') {
        fields.push({ label: 'Width (mm)', value: entity.width, key: 'width' });
        fields.push({ label: 'Position (mm)', value: Math.round(entity.offset), key: 'offset' });
    } else if (entity.type === 'room') {
        fields.push({ label: 'Room name', value: entity.name, key: 'name', text: true });
        fields.push({ label: 'Area', value: `${(polygonArea(entity.points) / 1_000_000).toFixed(2)} m²`, readonly: true });
    } else if (entity.type === 'dimension') {
        fields.push({ label: 'Measured length', value: formatLength(distance(entity.a, entity.b)), readonly: true });
    } else if (entity.type === 'text') {
        fields.push({ label: 'Text content', value: entity.text, key: 'text', multiline: true });
        fields.push({ label: 'Text size (mm)', value: entity.size, key: 'size' });
    }
    for (const field of fields) {
        const label = document.createElement('label');
        label.className = 'property-field';
        label.textContent = field.label;
        const input = document.createElement(field.multiline ? 'textarea' : 'input');
        input.value = field.value;
        input.type = field.text || field.readonly ? 'text' : 'number';
        if (field.readonly) input.readOnly = true;
        if (!field.readonly) input.addEventListener('change', () => applyProperty(entity.id, field.key, input.value));
        label.append(input);
        propertyPanel.append(label);
    }
    appendArrangementControls(propertyPanel);
    const remove = document.createElement('button');
    remove.className = 'danger-button';
    remove.textContent = 'Delete object';
    remove.addEventListener('click', deleteSelection);
    propertyPanel.append(remove);
    transformPanel.hidden = false;
    const center = entityCenter(entity);
    document.querySelector('#position-x').value = Math.round(center.x);
    document.querySelector('#position-y').value = Math.round(center.y);
}

function appendArrangementControls(parent) {
    const row = document.createElement('div');
    row.className = 'transform-row arrange-row';
    const sendBack = document.createElement('button');
    sendBack.className = 'secondary-button';
    sendBack.type = 'button';
    sendBack.textContent = 'Send to back';
    sendBack.addEventListener('click', () => arrangeSelection('back'));
    const bringFront = document.createElement('button');
    bringFront.className = 'secondary-button';
    bringFront.type = 'button';
    bringFront.textContent = 'Bring to front';
    bringFront.addEventListener('click', () => arrangeSelection('front'));
    row.append(sendBack, bringFront);
    parent.append(row);
}

function updateLayers() {
    const list = document.querySelector('#layer-list');
    list.replaceChildren();
    for (const layer of project.layers) {
        const row = document.createElement('div');
        row.className = `layer-row${layer.id === project.activeLayerId ? ' active' : ''}`;
        const activate = document.createElement('button');
        activate.className = 'layer-activate';
        activate.type = 'button';
        activate.setAttribute('aria-pressed', String(layer.id === project.activeLayerId));
        activate.textContent = layer.name;
        activate.title = `Set ${layer.name} as the active drawing layer`;
        activate.addEventListener('click', () => {
            project.activeLayerId = layer.id;
            if (!layer.visible) {
                layer.visible = true;
                remember();
            }
            render();
        });

        const count = project.entities.filter(entity => entity.layerId === layer.id).length;
        const countLabel = document.createElement('span');
        countLabel.className = 'layer-object-count';
        countLabel.textContent = String(count);
        countLabel.setAttribute('aria-label', `${count} objects`);

        const visibility = document.createElement('button');
        visibility.className = 'layer-icon-button';
        visibility.type = 'button';
        visibility.textContent = layer.visible ? '◉' : '○';
        visibility.title = layer.visible ? 'Hide layer' : 'Show layer';
        visibility.setAttribute('aria-label', `${layer.visible ? 'Hide' : 'Show'} ${layer.name}`);
        visibility.setAttribute('aria-pressed', String(layer.visible));
        visibility.addEventListener('click', () => {
            if (layer.visible && project.layers.filter(item => item.visible).length <= 1) {
                showToast('At least one layer must remain visible.');
                return;
            }
            layer.visible = !layer.visible;
            if (!layer.visible && project.activeLayerId === layer.id) {
                project.activeLayerId = project.layers.find(item => item.visible).id;
            }
            if (!layer.visible) {
                const hiddenIds = new Set(project.entities.filter(entity => entity.layerId === layer.id).map(entity => entity.id));
                selectMany(selectionIds().filter(id => !hiddenIds.has(id)));
            }
            remember();
            render();
        });

        const rename = document.createElement('button');
        rename.className = 'layer-icon-button';
        rename.type = 'button';
        rename.textContent = '✎';
        rename.title = 'Rename layer';
        rename.setAttribute('aria-label', `Rename ${layer.name}`);
        rename.addEventListener('click', () => {
            const name = window.prompt('Layer name', layer.name);
            if (name === null) return;
            const trimmedName = name.trim();
            if (!trimmedName) {
                showToast('Layer names cannot be empty.');
                return;
            }
            layer.name = trimmedName.slice(0, 60);
            remember();
            render();
        });

        const remove = document.createElement('button');
        remove.className = 'layer-icon-button layer-remove-button';
        remove.type = 'button';
        remove.textContent = '×';
        remove.title = 'Delete layer';
        remove.setAttribute('aria-label', `Delete ${layer.name}`);
        remove.disabled = project.layers.length < 2;
        remove.addEventListener('click', () => deleteLayer(layer.id));

        row.append(activate, countLabel, visibility, rename, remove);
        list.append(row);
    }
    document.querySelector('#layer-count').textContent = String(project.layers.length).padStart(2, '0');
    document.querySelector('#assign-layer').disabled = !selectionIds().length;
}

function addLayer() {
    let index = project.layers.length + 1;
    while (project.layers.some(layer => layer.name === `Layer ${index}`)) index += 1;
    const layer = { id: uid(), name: `Layer ${index}`, visible: true };
    project.layers.push(layer);
    project.activeLayerId = layer.id;
    remember();
    render();
}

function deleteLayer(layerId) {
    if (project.layers.length < 2) return;
    const fallback = project.layers.find(layer => layer.id !== layerId);
    if (!fallback) return;
    project.entities.forEach(entity => {
        if (entity.layerId === layerId) entity.layerId = fallback.id;
    });
    project.layers = project.layers.filter(layer => layer.id !== layerId);
    if (project.activeLayerId === layerId) {
        project.activeLayerId = fallback.id;
        fallback.visible = true;
    }
    remember();
    render();
}

function assignSelectionToActiveLayer() {
    const ids = new Set(selectionIds());
    const layer = currentLayer();
    if (!ids.size || !layer) return;
    project.entities.forEach(entity => {
        if (ids.has(entity.id)) entity.layerId = layer.id;
    });
    remember();
    render();
}

function arrangeSelection(destination) {
    const selected = new Set(selectionIds());
    if (!selected.size) return;
    const openingsByWall = new Map();
    for (const entity of project.entities) {
        if (entity.type !== 'opening') continue;
        if (!openingsByWall.has(entity.wallId)) openingsByWall.set(entity.wallId, []);
        openingsByWall.get(entity.wallId).push(entity);
    }
    const units = [];
    const included = new Set();
    for (const entity of project.entities) {
        if (included.has(entity.id) || entity.type === 'opening') continue;
        const unit = [entity];
        included.add(entity.id);
        if (entity.type === 'wall') {
            for (const opening of openingsByWall.get(entity.id) || []) {
                unit.push(opening);
                included.add(opening.id);
            }
        }
        units.push(unit);
    }
    for (const entity of project.entities) {
        if (!included.has(entity.id)) units.push([entity]);
    }
    const moving = units.filter(unit => unit.some(entity => selected.has(entity.id)));
    const staying = units.filter(unit => !unit.some(entity => selected.has(entity.id)));
    project.entities = (destination === 'front' ? [...staying, ...moving] : [...moving, ...staying]).flat();
    remember();
    render();
}

function applyProperty(id, key, value) {
    const entity = project.entities.find(item => item.id === id);
    if (!entity) return;
    if (key === 'name') entity.name = value.trim() || 'Room';
    if (key === 'text') entity.text = value;
    if (key === 'size' && entity.type === 'text') entity.size = Math.max(10, Number(value) || 220);
    if (key === 'thickness') entity.thickness = Math.max(50, Number(value) || 180);
    if (key === 'width' && entity.type === 'opening') {
        const wall = currentWall(entity);
        const wallLength = wall ? distance({ x: wall.x1, y: wall.y1 }, { x: wall.x2, y: wall.y2 }) : Number(value);
        entity.width = Math.min(wallLength, Math.max(100, Number(value) || 900));
        entity.offset = Math.max(entity.width / 2, Math.min(wallLength - entity.width / 2, entity.offset));
    }
    if (key === 'offset' && entity.type === 'opening') {
        const wall = currentWall(entity);
        const wallLength = wall ? distance({ x: wall.x1, y: wall.y1 }, { x: wall.x2, y: wall.y2 }) : entity.offset;
        entity.offset = Math.max(entity.width / 2, Math.min(wallLength - entity.width / 2, Number(value) || 0));
    }
    if (key === 'length' && entity.type === 'wall') {
        const angle = Math.atan2(entity.y2 - entity.y1, entity.x2 - entity.x1);
        const openings = project.entities.filter(item => item.type === 'opening' && item.wallId === entity.id);
        const minimumLength = Math.max(10, ...openings.map(opening => opening.width));
        const length = Math.max(minimumLength, Number(value) || minimumLength);
        entity.x2 = entity.x1 + Math.cos(angle) * length;
        entity.y2 = entity.y1 + Math.sin(angle) * length;
        for (const opening of openings) {
            opening.offset = Math.max(opening.width / 2, Math.min(opening.offset, length - opening.width / 2));
        }
    }
    remember();
    render();
}

function deleteSelection() {
    const ids = new Set(selectionIds());
    if (!ids.size) return;
    for (const entity of project.entities) {
        if (entity.type === 'wall' && ids.has(entity.id)) {
            project.entities.filter(item => item.type === 'opening' && item.wallId === entity.id).forEach(item => ids.add(item.id));
        }
    }
    project.entities = project.entities.filter(entity => !ids.has(entity.id));
    clearSelection();
    remember();
    render();
}

function validateProject(data) {
    if (!data || data.schemaVersion !== SCHEMA_VERSION || data.units !== 'mm' || typeof data.name !== 'string' || !Array.isArray(data.entities) || data.entities.length > 20000) {
        throw new Error('This is not a supported plan project.');
    }
    const layers = data.layers === undefined ? [{ id: DEFAULT_LAYER_ID, name: 'Layer 1', visible: true }] : data.layers;
    if (!Array.isArray(layers) || !layers.length) throw new Error('The project must contain at least one layer.');
    const layerIds = new Set();
    for (const layer of layers) {
        if (!layer || typeof layer.id !== 'string' || !layer.id || layerIds.has(layer.id) || typeof layer.name !== 'string' || !layer.name.trim()) {
            throw new Error('The project contains an invalid or duplicate layer.');
        }
        layerIds.add(layer.id);
    }
    const normalizedLayers = layers.map(layer => ({ id: layer.id, name: layer.name.trim().slice(0, 60), visible: layer.visible !== false }));
    if (!normalizedLayers.some(layer => layer.visible)) normalizedLayers[0].visible = true;
    const defaultLayerId = normalizedLayers[0].id;
    const requestedActiveLayer = normalizedLayers.find(layer => layer.id === data.activeLayerId && layer.visible);
    const activeLayerId = requestedActiveLayer ? requestedActiveLayer.id : normalizedLayers.find(layer => layer.visible).id;
    const ids = new Set();
    for (const entity of data.entities) {
        if (!entity || typeof entity.id !== 'string' || ids.has(entity.id)) throw new Error('The project contains an invalid or duplicate object ID.');
        ids.add(entity.id);
        if (entity.type === 'wall' && [entity.x1, entity.y1, entity.x2, entity.y2, entity.thickness].every(Number.isFinite) && entity.thickness > 0 && distance({ x: entity.x1, y: entity.y1 }, { x: entity.x2, y: entity.y2 }) > 0) continue;
        if (entity.type === 'room' && typeof entity.name === 'string' && Array.isArray(entity.points) && entity.points.length >= 3 && entity.points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y))) continue;
        if (entity.type === 'dimension' && [entity.a && entity.a.x, entity.a && entity.a.y, entity.b && entity.b.x, entity.b && entity.b.y].every(Number.isFinite)) continue;
        if (entity.type === 'text' && Number.isFinite(entity.x) && Number.isFinite(entity.y) && typeof entity.text === 'string' && Number.isFinite(entity.size) && entity.size > 0 && (entity.rotation === undefined || Number.isFinite(entity.rotation))) continue;
        if (entity.type === 'opening' && ['door', 'window'].includes(entity.kind) && typeof entity.wallId === 'string' && Number.isFinite(entity.offset) && Number.isFinite(entity.width) && entity.width > 0) continue;
        throw new Error(`The project contains an invalid ${entity.type || 'unknown'} object.`);
    }
    for (const entity of data.entities) {
        if (entity.layerId === undefined) entity.layerId = defaultLayerId;
        if (!layerIds.has(entity.layerId)) throw new Error(`The ${entity.type} object refers to a layer that is missing.`);
    }
    for (const opening of data.entities.filter(entity => entity.type === 'opening')) {
        const wall = data.entities.find(entity => entity.id === opening.wallId && entity.type === 'wall');
        if (!wall) throw new Error('An opening refers to a wall that is missing.');
        const wallLength = distance({ x: wall.x1, y: wall.y1 }, { x: wall.x2, y: wall.y2 });
        if (opening.width > wallLength || opening.offset < opening.width / 2 || opening.offset > wallLength - opening.width / 2) {
            throw new Error('An opening extends beyond its wall.');
        }
    }
    return {
        schemaVersion: SCHEMA_VERSION,
        units: 'mm',
        name: data.name.slice(0, 120),
        layers: normalizedLayers,
        activeLayerId,
        entities: data.entities,
    };
}

function downloadProject() {
    project.name = document.querySelector('#project-name').value.trim() || 'Untitled plan';
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${project.name.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-|-$/g, '') || 'plan'}.plan.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('Project file downloaded.');
}

async function openProject(file) {
    if (!file) return;
    try {
        const imported = validateProject(JSON.parse(await file.text()));
        project = imported;
        clearSelection();
        history = [];
        historyIndex = -1;
        remember();
        render();
        showToast('Project opened.');
    } catch (error) {
        showToast(error.message || 'Could not open this project file.');
    } finally {
        fileInput.value = '';
    }
}

function zoom(factor, center) {
    const nextWidth = Math.max(1200, Math.min(50000, view.width * factor));
    const ratio = nextWidth / view.width;
    const centerPoint = center || { x: view.x + view.width / 2, y: view.y + view.height / 2 };
    view.x = centerPoint.x - (centerPoint.x - view.x) * ratio;
    view.y = centerPoint.y - (centerPoint.y - view.y) * ratio;
    view.width = nextWidth;
    view.height *= ratio;
    render();
}

function planView(aspect) {
    if (!project.entities.length) {
        const width = Math.max(7000, 4800 * aspect);
        return { x: -500, y: -350, width, height: width / aspect };
    }
    const points = [];
    for (const entity of project.entities) {
        if (entity.type === 'wall') points.push({ x: entity.x1, y: entity.y1 }, { x: entity.x2, y: entity.y2 });
        if (entity.type === 'room') points.push(...entity.points);
        if (entity.type === 'dimension') points.push(entity.a, entity.b);
        if (entity.type === 'text') {
            const width = Math.max(entity.size, String(entity.text || '').length * entity.size * 0.65);
            const angle = (entity.rotation || 0) * Math.PI / 180;
            for (const local of[{ x: 0, y: -entity.size }, { x: width, y: -entity.size }, { x: width, y: entity.size }, { x: 0, y: entity.size }]) {
                points.push({
                    x: entity.x + local.x * Math.cos(angle) - local.y * Math.sin(angle),
                    y: entity.y + local.x * Math.sin(angle) + local.y * Math.cos(angle),
                });
            }
        }
        if (entity.type === 'opening') {
            const wall = currentWall(entity);
            if (wall) points.push(pointOnWall(wall, entity.offset));
        }
    }
    const xs = points.map(point => point.x),
        ys = points.map(point => point.y);
    const pad = 1100;
    const boundsWidth = Math.max(1800, Math.max(...xs) - Math.min(...xs) + pad * 2);
    const boundsHeight = Math.max(1200, Math.max(...ys) - Math.min(...ys) + pad * 2);
    const width = Math.max(boundsWidth, boundsHeight * aspect);
    const height = width / aspect;
    return {
        x: (Math.min(...xs) + Math.max(...xs) - width) / 2,
        y: (Math.min(...ys) + Math.max(...ys) - height) / 2,
        width,
        height,
    };
}

function fitPlan() {
    const aspect = stage.clientWidth / Math.max(1, stage.clientHeight);
    view = planView(aspect);
    render();
}

toolButtons.forEach(button => button.addEventListener('click', () => setTool(button.dataset.tool)));
svg.addEventListener('pointerdown', onCanvasPointerDown);
svg.addEventListener('pointermove', onPointerMove);
svg.addEventListener('pointerup', onPointerUp);
svg.addEventListener('pointercancel', onPointerUp);
svg.addEventListener('dblclick', event => {
    if (activeTool === 'room' && gesture) finishRoom(gesture.points);
    event.preventDefault();
});
svg.addEventListener('wheel', event => {
    event.preventDefault();
    const point = screenPoint(event);
    zoom(event.deltaY < 0 ? 0.88 : 1.14, point);
}, { passive: false });

document.querySelector('#undo').addEventListener('click', () => restoreHistory(historyIndex - 1));
document.querySelector('#redo').addEventListener('click', () => restoreHistory(historyIndex + 1));
document.querySelector('#save-project').addEventListener('click', downloadProject);
document.querySelector('#open-project').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', event => openProject(event.target.files[0]));
document.querySelector('#new-project').addEventListener('click', () => {
    if (project.entities.length && !confirm('Start a new plan? Download this project first if you need to keep it.')) return;
    project = createProject();
    clearSelection();
    history = [];
    historyIndex = -1;
    remember();
    render();
    fitPlan();
});
document.querySelector('#print-project').addEventListener('click', () => {
    project.name = document.querySelector('#project-name').value.trim() || 'Untitled plan';
    document.querySelector('#print-title').textContent = project.name;
    document.querySelector('#print-date').textContent = new Date().toLocaleDateString();
    const printDrawing = document.querySelector('#print-drawing');
    const printView = planView(1.8);
    printDrawing.setAttribute('viewBox', `${printView.x} ${printView.y} ${printView.width} ${printView.height}`);
    const printEntities = document.querySelector('#print-entities');
    printEntities.innerHTML = entityLayer.innerHTML;
    printEntities.querySelectorAll('.is-selected').forEach(element => element.classList.remove('is-selected'));
    window.print();
});
document.querySelector('#zoom-in').addEventListener('click', () => zoom(0.8));
document.querySelector('#zoom-out').addEventListener('click', () => zoom(1.25));
document.querySelector('#fit-view').addEventListener('click', fitPlan);
document.querySelector('#snap-toggle').addEventListener('change', event => {
    snapEnabled = event.target.checked;
    render();
});
document.querySelector('#object-snap-toggle').addEventListener('change', event => {
    objectSnapEnabled = event.target.checked;
    lastObjectSnap = null;
    render();
});
document.querySelector('#orthogonal-toggle').addEventListener('change', event => {
    orthogonalWalls = event.target.checked;
    lastObjectSnap = null;
    previewLayer.replaceChildren();
    updateStatus();
});
document.querySelector('#project-name').addEventListener('change', event => { project.name = event.target.value.trim() || 'Untitled plan'; });
document.querySelector('#delete-object').addEventListener('click', deleteSelection);
document.querySelector('#finish-room').addEventListener('click', () => {
    if (activeTool === 'room' && gesture) finishRoom(gesture.points);
});
const wallLengthInput = document.querySelector('#wall-length-input');
wallLengthInput.addEventListener('input', () => {
    if (gesture && gesture.start) {
        const previewPoint = gesture.previewPoint || {
            x: gesture.start.x + (gesture.direction || { x: 1, y: 0 }).x,
            y: gesture.start.y + (gesture.direction || { x: 1, y: 0 }).y,
        };
        drawPreview(previewPoint);
    }
});
wallLengthInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        commitWallLength();
    } else if (event.key === 'Escape') {
        event.preventDefault();
        gesture = null;
        previewLayer.replaceChildren();
        setTool('select');
    }
});
document.querySelector('#add-layer').addEventListener('click', addLayer);
document.querySelector('#assign-layer').addEventListener('click', assignSelectionToActiveLayer);
document.querySelector('#snap-step').addEventListener('change', event => {
    gridSize = Math.max(1, Math.min(10000, Math.floor(Number(event.target.value) || 1)));
    event.target.value = String(gridSize);
    render();
});
document.querySelector('#apply-position').addEventListener('click', applyPosition);
document.querySelector('#rotate-left').addEventListener('click', () => applyTransform('rotate', -90));
document.querySelector('#rotate-right').addEventListener('click', () => applyTransform('rotate', 90));
document.querySelector('#apply-scale').addEventListener('click', () => {
    const percent = Math.max(1, Math.min(1000, Number(document.querySelector('#scale-percent').value) || 100));
    document.querySelector('#scale-percent').value = String(percent);
    applyTransform('scale', percent / 100);
});
document.querySelector('#copy-object').addEventListener('click', duplicateSelection);
document.querySelector('#mirror-horizontal').addEventListener('click', () => applyTransform('mirror', 'horizontal'));
document.querySelector('#mirror-vertical').addEventListener('click', () => applyTransform('mirror', 'vertical'));

window.addEventListener('keydown', event => {
    const editing = ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName);
    if (event.code === 'Space' && !editing) {
        event.preventDefault();
        spacePanning = true;
        svg.classList.add('space-pan');
    }
    if (editing) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        restoreHistory(historyIndex + (event.shiftKey ? 1 : -1));
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        restoreHistory(historyIndex + 1);
    } else if (event.key === 'Delete' || event.key === 'Backspace') deleteSelection();
    else if (event.key === 'Escape') {
        gesture = null;
        previewLayer.replaceChildren();
        setTool('select');
    } else if (event.key.toLowerCase() === 'v') setTool('select');
    else if (event.key.toLowerCase() === 'a') setTool('area-select');
    else if (event.key.toLowerCase() === 'w') setTool('wall');
    else if (event.key.toLowerCase() === 'd') setTool('door');
    else if (event.key.toLowerCase() === 'r') setTool('room');
    else if (event.key.toLowerCase() === 'm') setTool('dimension');
    else if (event.key.toLowerCase() === 't') setTool('text');
    else if (event.key === 'Enter' && activeTool === 'room' && gesture) finishRoom(gesture.points);
});
window.addEventListener('keyup', event => {
    if (event.code === 'Space') {
        spacePanning = false;
        svg.classList.remove('space-pan');
    }
});
window.addEventListener('resize', () => render());

function handleCanvasSelection(event) {
    const point = screenPoint(event, { grid: false, objects: false, orthogonal: false, useCurrentWallGesture: false });
    const entity = hitTestEntity(point);
    if (entity) beginEntityMove(entity, event);
    else if (activeTool === 'area-select') {
        gesture = { type: 'marquee', start: point, current: point, additive: isAdditiveSelection(event) };
        drawMarquee(point, point);
    } else if (!isAdditiveSelection(event)) {
        clearSelection();
        render();
    }
    svg.setPointerCapture(event.pointerId);
}

remember();
render();