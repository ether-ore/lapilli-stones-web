// The Reader's Shelf practice board: a board on the table, in a
// browser. No opponent, no hints -- it only knows how stones are
// placed, how pairs are captured, and whose turn it is.
//
// Notation matches the book and the app: columns A-T without I,
// rows 1-19 counted from the bottom, the centre point is K10.

(function () {
  'use strict';

  const SIZE = 19;
  const COLS = 'ABCDEFGHJKLMNOPQRST';
  const EMPTY = 0, BLACK = 1, WHITE = 2;
  const DIRECTIONS = [
    [0, 1], [1, 0], [1, 1], [1, -1],
    [0, -1], [-1, 0], [-1, -1], [-1, 1],
  ];

  // ---- The rules (pure; no page needed) ----

  function emptyBoard() { return new Array(SIZE * SIZE).fill(EMPTY); }
  function at(board, r, c) { return board[r * SIZE + c]; }
  function onBoard(r, c) { return r >= 0 && r < SIZE && c >= 0 && c < SIZE; }
  function other(color) { return color === BLACK ? WHITE : BLACK; }

  // Row 0 is the TOP of the board, which the notation calls 19.
  function squareName(r, c) { return COLS[c] + (SIZE - r); }

  function parseSquare(text) {
    const m = /^([A-HJ-T])(\d{1,2})$/i.exec(String(text).trim());
    if (!m) return null;
    const c = COLS.indexOf(m[1].toUpperCase());
    const row = Number(m[2]);
    if (c < 0 || row < 1 || row > SIZE) return null;
    return [SIZE - row, c];
  }

  // Place a stone with Pente's capture rule: a pair of the opponent's
  // stones flanked on both ends by the mover's stones comes off. Only
  // the stone just placed can close a bracket, so playing INTO a
  // bracket is safe -- the rule is checked outward from the new stone
  // and never the other way around. Returns the captured squares.
  function placeAndCapture(board, r, c, color) {
    board[r * SIZE + c] = color;
    const foe = other(color);
    const captured = [];
    for (const [dr, dc] of DIRECTIONS) {
      const r1 = r + dr, c1 = c + dc;
      const r2 = r + 2 * dr, c2 = c + 2 * dc;
      const r3 = r + 3 * dr, c3 = c + 3 * dc;
      if (!onBoard(r3, c3)) continue;
      if (at(board, r1, c1) === foe && at(board, r2, c2) === foe &&
          at(board, r3, c3) === color) {
        board[r1 * SIZE + c1] = EMPTY;
        board[r2 * SIZE + c2] = EMPTY;
        captured.push([r1, c1], [r2, c2]);
      }
    }
    return captured;
  }

  // A position as a short, readable link fragment:
  //   #b=K10,L11&w=J9&turn=w&cb=1
  // Stones by colour in book notation, whose turn it is, and capture
  // counts (pairs) when non-zero. Anything malformed is skipped, so a
  // hand-typed link degrades gracefully instead of failing.
  function encodePosition(state) {
    const black = [], white = [];
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const v = at(state.board, r, c);
        if (v === BLACK) black.push(squareName(r, c));
        else if (v === WHITE) white.push(squareName(r, c));
      }
    }
    const parts = [];
    if (black.length) parts.push('b=' + black.join(','));
    if (white.length) parts.push('w=' + white.join(','));
    parts.push('turn=' + (state.color === WHITE ? 'w' : 'b'));
    if (state.captures[BLACK]) parts.push('cb=' + state.captures[BLACK]);
    if (state.captures[WHITE]) parts.push('cw=' + state.captures[WHITE]);
    return parts.join('&');
  }

  function decodePosition(fragment) {
    const params = new URLSearchParams(String(fragment).replace(/^#/, ''));
    if (!params.has('b') && !params.has('w')) return null;
    const board = emptyBoard();
    for (const [key, color] of [['b', BLACK], ['w', WHITE]]) {
      for (const sq of (params.get(key) || '').split(',')) {
        const p = parseSquare(sq);
        if (p) board[p[0] * SIZE + p[1]] = color;
      }
    }
    const count = (k) => Math.max(0, parseInt(params.get(k) || '0', 10) || 0);
    return {
      board,
      color: params.get('turn') === 'w' ? WHITE : BLACK,
      captures: { [BLACK]: count('cb'), [WHITE]: count('cw') },
    };
  }

  // A pasted game record, in any of the notations a reader meets:
  //   the book and the app:  1. K10  2. K8 ... 17. H7 (×J8, K9)
  //   Pente.org:             1. K10 - N10  2. N7 - L8 ...
  //   a table:               1 <tab> K10 <tab> L10
  // Only the points matter, in order: move numbers, dashes, tabs and
  // [header] lines are ignored. A parenthesis after a move is that
  // move's capture note -- checked against the rule, never played.
  function parseGame(text) {
    const raw = String(text);
    if (/\[\s*Capture\s+"keryo"\s*\]/i.test(raw)) {
      return { error: 'This record uses Keryo captures (three stones at a time). '
        + 'This board plays standard pair captures only.' };
    }
    const body = raw.replace(/\[[^\]\n]*\]/g, ' ');
    const POINT = /[A-HJ-T](?:1[0-9]|[1-9])(?![0-9])/gi;
    const token = /\(([^)]*)\)|(^|[^A-Za-z0-9])([A-HJ-T](?:1[0-9]|[1-9]))(?![0-9])/gi;
    const moves = [];
    let m;
    while ((m = token.exec(body))) {
      if (m[1] !== undefined) {
        if (moves.length) {
          moves[moves.length - 1].noted =
            (m[1].match(POINT) || []).map((s) => s.toUpperCase());
        }
        continue;
      }
      const square = m[3].toUpperCase();
      moves.push({ square, rc: parseSquare(square), noted: null });
    }
    if (!moves.length) return { error: 'No moves found. Moves look like K10 or N7.' };
    return { moves };
  }

  // Play a parsed record from an empty board, White first -- as in
  // the book, the app, and Pente.org. Returns every position along
  // the way, so Undo can step back one move at a time, or an error
  // naming the move that cannot be played.
  function replayGame(moves) {
    const board = emptyBoard();
    const captures = { [BLACK]: 0, [WHITE]: 0 };
    let color = WHITE;
    let last = null;
    const positions = [];
    const pos = () => ({ board: board.slice(), captures: { ...captures }, color, last });
    for (let i = 0; i < moves.length; i++) {
      const { square, rc, noted } = moves[i];
      const [r, c] = rc;
      if (at(board, r, c) !== EMPTY) {
        return { error: `Move ${i + 1}, ${square}: that point is already taken.` };
      }
      positions.push(pos());
      const taken = placeAndCapture(board, r, c, color).map(([a, b]) => squareName(a, b));
      if (noted && noted.slice().sort().join() !== taken.slice().sort().join()) {
        const said = noted.length ? noted.join(', ') : 'nothing';
        const did = taken.length ? taken.join(', ') : 'nothing';
        return { error: `Move ${i + 1}, ${square}: the record says it captured ${said}, `
          + `but here it captures ${did}.` };
      }
      captures[color] += taken.length / 2;
      color = other(color);
      last = [r, c];
    }
    positions.push(pos());
    return { positions };
  }

  const rules = {
    SIZE, COLS, EMPTY, BLACK, WHITE,
    emptyBoard, at, squareName, parseSquare, placeAndCapture,
    encodePosition, decodePosition, parseGame, replayGame,
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = rules;
  }
  if (typeof document === 'undefined') return;

  // ---- The page ----

  const STORE_KEY = 'lapilli.shelfBoard.v1';
  // The margin carries the coordinates; on a phone the whole board is
  // ~340px wide, so the labels must be large in board units to stay
  // readable -- readers navigate the book's notation by them.
  const CELL = 40, MARGIN = 56;
  const SPAN = CELL * (SIZE - 1);
  const VIEW = SPAN + MARGIN * 2;
  const STARS = ['D16', 'K16', 'Q16', 'D10', 'K10', 'Q10', 'D4', 'K4', 'Q4'];
  const SVG_NS = 'http://www.w3.org/2000/svg';

  let state = freshState();
  // Undo steps. Not called `history`: that would shadow
  // window.history, which save() uses to keep the link current.
  const undoStack = [];

  function freshState() {
    return {
      board: emptyBoard(),
      captures: { [BLACK]: 0, [WHITE]: 0 },
      color: BLACK,
      mode: 'setup',
      tool: 'place',
      last: null,
    };
  }

  function snapshot() {
    return {
      board: state.board.slice(),
      captures: { ...state.captures },
      color: state.color,
      last: state.last ? state.last.slice() : null,
    };
  }

  function remember() {
    undoStack.push(snapshot());
    if (undoStack.length > 1000) undoStack.shift();
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        board: state.board, captures: state.captures, color: state.color,
        mode: state.mode, last: state.last,
      }));
    } catch (e) { /* private browsing, storage off: the board still works */ }
    try {
      // replaceState, not location.hash: placing a stone must not
      // add a Back-button step.
      window.history.replaceState(null, '', '#' + encodePosition(state));
    } catch (e) { /* file:// and sandboxed frames may refuse; harmless */ }
  }

  function load() {
    const fromLink = decodePosition(location.hash);
    if (fromLink) {
      // A link from the book: open on that position, ready to play
      // the line out.
      Object.assign(state, fromLink, { mode: 'play', last: null });
      return;
    }
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (saved && Array.isArray(saved.board) && saved.board.length === SIZE * SIZE) {
        state.board = saved.board;
        state.captures = saved.captures || state.captures;
        state.color = saved.color === WHITE ? WHITE : BLACK;
        state.mode = saved.mode === 'play' ? 'play' : 'setup';
        state.last = saved.last || null;
      }
    } catch (e) { /* unreadable storage: start fresh */ }
  }

  // ---- Drawing ----

  const svg = document.getElementById('board');
  svg.setAttribute('viewBox', `0 0 ${VIEW} ${VIEW}`);
  const xy = (r, c) => [MARGIN + c * CELL, MARGIN + r * CELL];

  function el(name, attrs, parent) {
    const node = document.createElementNS(SVG_NS, name);
    for (const k in attrs) node.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(node);
    return node;
  }

  function drawStatic() {
    const defs = el('defs', {}, svg);
    const gb = el('radialGradient', { id: 'gBlack', cx: '35%', cy: '30%', r: '70%' }, defs);
    el('stop', { offset: '0%', 'stop-color': '#5a5a5e' }, gb);
    el('stop', { offset: '100%', 'stop-color': '#0d0d0f' }, gb);
    const gw = el('radialGradient', { id: 'gWhite', cx: '35%', cy: '30%', r: '75%' }, defs);
    el('stop', { offset: '0%', 'stop-color': '#ffffff' }, gw);
    el('stop', { offset: '100%', 'stop-color': '#d9d4ca' }, gw);

    el('rect', { x: 0, y: 0, width: VIEW, height: VIEW, rx: 10, fill: '#d9a95f' }, svg);
    el('rect', { x: 6, y: 6, width: VIEW - 12, height: VIEW - 12, rx: 7,
      fill: 'none', stroke: '#8a5a24', 'stroke-width': 3, opacity: 0.55 }, svg);

    const grid = el('g', { stroke: '#2b1a0a', 'stroke-width': 1.3, opacity: 0.85 }, svg);
    for (let i = 0; i < SIZE; i++) {
      const p = MARGIN + i * CELL;
      el('line', { x1: MARGIN, y1: p, x2: MARGIN + SPAN, y2: p }, grid);
      el('line', { x1: p, y1: MARGIN, x2: p, y2: MARGIN + SPAN }, grid);
    }
    for (const s of STARS) {
      const [r, c] = parseSquare(s);
      const [x, y] = xy(r, c);
      el('circle', { cx: x, cy: y, r: 4.5, fill: '#2b1a0a' }, svg);
    }

    const labels = el('g', { fill: '#3a2410', 'font-family': 'Georgia, serif',
      'font-size': 23, 'font-weight': 'bold', 'text-anchor': 'middle' }, svg);
    for (let i = 0; i < SIZE; i++) {
      const [x] = xy(0, i);
      const t1 = el('text', { x, y: MARGIN + SPAN + 40 }, labels);
      t1.textContent = COLS[i];
      const [, y] = xy(i, 0);
      const t2 = el('text', { x: 26, y: y + 8 }, labels);
      t2.textContent = String(SIZE - i);
    }
  }

  const layer = document.createElementNS(SVG_NS, 'g');
  const ghost = document.createElementNS(SVG_NS, 'circle');

  function render() {
    while (layer.firstChild) layer.removeChild(layer.firstChild);
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const v = at(state.board, r, c);
        if (v === EMPTY) continue;
        const [x, y] = xy(r, c);
        el('circle', { cx: x, cy: y, r: CELL * 0.46,
          fill: v === BLACK ? 'url(#gBlack)' : 'url(#gWhite)',
          stroke: v === BLACK ? '#000' : '#6b6359', 'stroke-width': 1.2 }, layer);
      }
    }
    if (state.last && at(state.board, state.last[0], state.last[1]) !== EMPTY) {
      const [x, y] = xy(state.last[0], state.last[1]);
      const lastColor = at(state.board, state.last[0], state.last[1]);
      el('circle', { cx: x, cy: y, r: 5,
        fill: lastColor === BLACK ? '#f5efe0' : '#1a1510' }, layer);
    }
    renderControls();
  }

  // ---- Input ----

  function pointFromEvent(ev) {
    const pt = svg.createSVGPoint();
    pt.x = ev.clientX; pt.y = ev.clientY;
    const local = pt.matrixTransform(svg.getScreenCTM().inverse());
    const c = Math.round((local.x - MARGIN) / CELL);
    const r = Math.round((local.y - MARGIN) / CELL);
    return onBoard(r, c) ? [r, c] : null;
  }

  function tap(r, c) {
    const here = at(state.board, r, c);
    if (state.tool === 'remove') {
      if (here === EMPTY) return;
      remember();
      state.board[r * SIZE + c] = EMPTY;
      if (state.last && state.last[0] === r && state.last[1] === c) state.last = null;
    } else {
      if (here !== EMPTY) return;
      remember();
      if (state.mode === 'play') {
        const captured = placeAndCapture(state.board, r, c, state.color);
        state.captures[state.color] += captured.length / 2;
        state.color = other(state.color);
      } else {
        state.board[r * SIZE + c] = state.color;
      }
      state.last = [r, c];
    }
    save();
    render();
  }

  svg.addEventListener('click', (ev) => {
    const p = pointFromEvent(ev);
    if (p) tap(p[0], p[1]);
  });

  // A faint ring where the next stone would land, for mouse users.
  svg.addEventListener('pointermove', (ev) => {
    if (ev.pointerType !== 'mouse') return;
    const p = pointFromEvent(ev);
    const show = p && state.tool === 'place' && at(state.board, p[0], p[1]) === EMPTY;
    ghost.setAttribute('visibility', show ? 'visible' : 'hidden');
    if (show) {
      const [x, y] = xy(p[0], p[1]);
      ghost.setAttribute('cx', x);
      ghost.setAttribute('cy', y);
    }
  });
  svg.addEventListener('pointerleave', () => ghost.setAttribute('visibility', 'hidden'));

  // ---- Controls ----

  const $ = (id) => document.getElementById(id);

  function setPressed(group, value) {
    for (const b of document.querySelectorAll(`[data-group="${group}"]`)) {
      b.setAttribute('aria-pressed', String(b.dataset.value === value));
    }
  }

  function renderControls() {
    setPressed('mode', state.mode);
    setPressed('color', state.color === BLACK ? 'black' : 'white');
    setPressed('tool', state.tool);
    const who = state.color === BLACK ? 'Black' : 'White';
    $('status').textContent = state.mode === 'play'
      ? `Play: ${who} to place. Captured pairs come off; the turn passes.`
      : 'Setup: stones go anywhere, and nothing is captured.';
    $('captures').textContent =
      `Captured pairs — Black ${state.captures[BLACK]} · White ${state.captures[WHITE]}`;
    $('undo').disabled = undoStack.length === 0;
  }

  for (const b of document.querySelectorAll('[data-group]')) {
    b.addEventListener('click', () => {
      const { group, value } = b.dataset;
      if (group === 'mode') state.mode = value;
      if (group === 'color') state.color = value === 'white' ? WHITE : BLACK;
      if (group === 'tool') state.tool = value;
      save();
      render();
    });
  }

  $('undo').addEventListener('click', () => {
    const prev = undoStack.pop();
    if (!prev) return;
    Object.assign(state, prev);
    save();
    render();
  });

  $('clear').addEventListener('click', () => {
    remember();
    state.board = emptyBoard();
    state.captures = { [BLACK]: 0, [WHITE]: 0 };
    state.color = BLACK;
    state.last = null;
    save();
    render();
  });

  $('copy').addEventListener('click', async () => {
    const url = location.href.split('#')[0] + '#' + encodePosition(state);
    let done = false;
    try { await navigator.clipboard.writeText(url); done = true; } catch (e) { /* fall through */ }
    $('linkOut').value = url;
    $('linkOut').hidden = false;
    if (!done) { $('linkOut').select(); }
    $('copy').textContent = done ? 'Link copied' : 'Copy the link below';
    setTimeout(() => { $('copy').textContent = 'Copy link to this position'; }, 2000);
  });

  // A pasted record replaces the board as if each stone had been
  // placed in Play mode: Undo steps back one move at a time, and one
  // step past the first move restores the board from before the paste.
  $('pasteGo').addEventListener('click', () => {
    const parsed = parseGame($('pasteText').value);
    const played = parsed.error ? parsed : replayGame(parsed.moves);
    if (played.error) {
      $('pasteMsg').textContent = played.error;
      return;
    }
    const { positions } = played;
    remember();
    for (let k = 0; k < positions.length - 1; k++) undoStack.push(positions[k]);
    while (undoStack.length > 1000) undoStack.shift();
    Object.assign(state, positions[positions.length - 1], { mode: 'play', tool: 'place' });
    const n = positions.length - 1;
    $('pasteMsg').textContent =
      `Set up ${n} move${n === 1 ? '' : 's'}. Undo steps back one move at a time.`;
    save();
    render();
  });

  // ---- Start ----

  drawStatic();
  svg.appendChild(layer);
  ghost.setAttribute('r', CELL * 0.42);
  ghost.setAttribute('fill', 'none');
  ghost.setAttribute('stroke', '#1a1510');
  ghost.setAttribute('stroke-width', 1.5);
  ghost.setAttribute('opacity', 0.35);
  ghost.setAttribute('visibility', 'hidden');
  ghost.setAttribute('pointer-events', 'none');
  svg.appendChild(ghost);
  load();
  save();
  render();
})();
