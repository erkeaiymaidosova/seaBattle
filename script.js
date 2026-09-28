/* =========================================================
   BATTLESHIP — script.js
   All game logic, rendering, sound, and interaction lives here.

   ARCHITECTURE NOTE (read this first):
   The game now supports two modes and two placement styles, so instead
   of hard-coded "player" / "computer" objects we keep a `players` array
   of two generic player objects (index 0 and 1). Two FIXED on-screen
   board containers exist — els.leftBoard and els.rightBoard — and a
   `boardBinding` object says which player's data each one currently
   displays. The left board always REVEALS its owner's ships; the right
   board always HIDES its owner's ships and is the attackable one.

   - In "vs Computer" mode, boardBinding never changes: left = you (0),
     right = computer (1). This is exactly the original game.
   - In "vs Friend" mode, boardBinding SWAPS every turn (and during
     placement), so each person only ever sees their own fleet on the
     left board — the other fleet is always hidden until hit. A
     "Pass the Device" screen covers the transition.
   ========================================================= */

(function () {
  "use strict";

  // =========================================================
  // GAME STATE
  // =========================================================

  const BOARD_SIZE = 10;
  const COL_LABELS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];

  const FLEET_CONFIG = [
    { name: "Carrier", length: 5 },
    { name: "Battleship", length: 4 },
    { name: "Cruiser", length: 3 },
    { name: "Submarine", length: 3 },
    { name: "Destroyer", length: 2 },
  ];

  let state = null; // populated by startNewGame()

  // Which underlying player each physical board shows right now.
  // { left: playerIndex, right: playerIndex }
  let boardBinding = { left: 0, right: 1 };

  // Chosen in the setup bar; read whenever a new game starts.
  let selectedMode = "cpu"; // "cpu" | "pvp"
  let selectedPlacement = "auto"; // "auto" | "manual"

  function createEmptyGrid() {
    const grid = [];
    for (let r = 0; r < BOARD_SIZE; r++) {
      const row = [];
      for (let c = 0; c < BOARD_SIZE; c++) {
        row.push({ shipId: null, attacked: false });
      }
      grid.push(row);
    }
    return grid;
  }

  function createPlayer(id, label, isAI) {
    return {
      id: id,
      label: label,
      isAI: isAI,
      grid: createEmptyGrid(),
      ships: [],
      scoreHits: 0,
    };
  }

  function createInitialState(mode) {
    const p0 = createPlayer(0, mode === "pvp" ? "Player 1" : "You", false);
    const p1 = createPlayer(1, mode === "pvp" ? "Player 2" : "Computer", mode === "cpu");
    return {
      mode: mode, // "cpu" | "pvp"
      phase: "placement", // "placement" | "battle" | "over"
      players: [p0, p1],
      activeIndex: 0, // whose turn to place ships / attack
      ai: { huntQueue: [] }, // computer's hunt-mode memory (cpu mode only)
      placement: { shipIndex: 0, horizontal: true },
    };
  }

  // =========================================================
  // SHIP PLACEMENT (shared by random AND manual placement)
  // =========================================================

  function canPlaceShip(grid, row, col, length, horizontal) {
    for (let i = 0; i < length; i++) {
      const r = horizontal ? row : row + i;
      const c = horizontal ? col + i : col;
      if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) return false;
      if (grid[r][c].shipId !== null) return false;
    }
    return true;
  }

  function getShipCellsFrom(row, col, length, horizontal) {
    const cells = [];
    for (let i = 0; i < length; i++) {
      const r = horizontal ? row : row + i;
      const c = horizontal ? col + i : col;
      cells.push([r, c]);
    }
    return cells;
  }

  function placeShipOnGrid(grid, row, col, length, horizontal, shipId) {
    const cells = getShipCellsFrom(row, col, length, horizontal);
    cells.forEach(([r, c]) => {
      grid[r][c].shipId = shipId;
    });
    return cells;
  }

  // Random placement — used for "Random" mode and for the "Randomize" button.
  function placeFleetRandomly(grid) {
    const ships = [];
    FLEET_CONFIG.forEach((config, index) => {
      let placed = false;
      let attempts = 0;
      while (!placed && attempts < 500) {
        attempts++;
        const horizontal = Math.random() < 0.5;
        const row = Math.floor(Math.random() * BOARD_SIZE);
        const col = Math.floor(Math.random() * BOARD_SIZE);
        if (canPlaceShip(grid, row, col, config.length, horizontal)) {
          const cells = placeShipOnGrid(grid, row, col, config.length, horizontal, index);
          ships.push({ id: index, name: config.name, length: config.length, cells: cells, hits: 0, sunk: false });
          placed = true;
        }
      }
      if (!placed) console.warn("Could not place ship:", config.name);
    });
    return ships;
  }

  // =========================================================
  // BOARD CREATION (DOM) — built ONCE per new game; only classes/
  // hulls are repainted afterwards (see paintBoard).
  // =========================================================

  function buildBoardSkeleton(container, roleClass) {
    container.innerHTML = "";
    container.classList.add(roleClass);

    const corner = makeLabelCell("");
    corner.style.gridColumn = "1";
    corner.style.gridRow = "1";
    container.appendChild(corner);

    for (let c = 0; c < BOARD_SIZE; c++) {
      const colLabel = makeLabelCell(COL_LABELS[c]);
      colLabel.style.gridColumn = String(c + 2);
      colLabel.style.gridRow = "1";
      container.appendChild(colLabel);
    }

    for (let r = 0; r < BOARD_SIZE; r++) {
      const rowLabel = makeLabelCell(String(r + 1));
      rowLabel.style.gridColumn = "1";
      rowLabel.style.gridRow = String(r + 2);
      container.appendChild(rowLabel);

      for (let c = 0; c < BOARD_SIZE; c++) {
        const cell = document.createElement("div");
        cell.className = "cell";
        cell.dataset.row = String(r);
        cell.dataset.col = String(c);
        cell.style.gridColumn = String(c + 2);
        cell.style.gridRow = String(r + 2);
        cell.tabIndex = 0;
        cell.setAttribute("role", "gridcell");
        cell.setAttribute("aria-label", COL_LABELS[c] + (r + 1));
        cell.addEventListener("click", onCellClick);
        cell.addEventListener("keydown", onCellKeydown);
        cell.addEventListener("mouseenter", onCellMouseEnter);
        container.appendChild(cell);
      }
    }

    container.addEventListener("mouseleave", () => clearAllPreview(container));
  }

  function makeLabelCell(text) {
    const label = document.createElement("div");
    label.className = "cell-label";
    label.textContent = text;
    label.setAttribute("aria-hidden", "true");
    return label;
  }

  function getCellEl(container, row, col) {
    return container.querySelector('.cell[data-row="' + row + '"][data-col="' + col + '"]');
  }

  function containerForPlayer(playerIndex) {
    return boardBinding.left === playerIndex ? els.leftBoard : els.rightBoard;
  }

  // Wipes hull/hit/miss/sunk marks back to blank cells (keeps the grid
  // skeleton and its event listeners — nothing is rebuilt).
  function clearBoardMarks(container) {
    container.querySelectorAll(".ship-hull").forEach((el) => el.remove());
    container.querySelectorAll(".cell").forEach((cell) => {
      cell.className = "cell";
      cell.innerHTML = ""; // remove any leftover explosion animation node
    });
  }

  // Fully (re)draws one physical board from a player's data. Used once
  // per side at battle start, and again whenever boardBinding swaps
  // (2-player mode) so history (past hits/misses) replays correctly.
  function paintBoard(container, player, revealShips) {
    clearBoardMarks(container);
    if (revealShips) {
      player.ships.forEach((ship) => {
        ship.cells.forEach(([r, c]) => {
          const cellEl = getCellEl(container, r, c);
          if (cellEl) cellEl.classList.add("ship", "ship-appear");
        });
        appendShipHull(container, ship);
      });
    }
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const cellData = player.grid[r][c];
        if (!cellData.attacked) continue;
        const cellEl = getCellEl(container, r, c);
        if (!cellEl) continue;
        if (cellData.shipId !== null) {
          cellEl.classList.add("hit");
          const ship = player.ships[cellData.shipId];
          if (ship && ship.sunk) cellEl.classList.add("sunk");
        } else {
          cellEl.classList.add("miss");
        }
      }
    }
  }

  function repaintBoards() {
    paintBoard(els.leftBoard, state.players[boardBinding.left], true);
    paintBoard(els.rightBoard, state.players[boardBinding.right], false);
    updateBoardTitles();
  }

  // Places one continuous ship silhouette across a ship's cells by
  // aligning it to the same CSS grid the cells use — the label row/column
  // occupy grid line 1, so data column/row index N sits on line N + 2.
  function appendShipHull(container, ship) {
    const rows = ship.cells.map(([r]) => r);
    const cols = ship.cells.map(([, c]) => c);
    const minRow = Math.min(...rows);
    const maxRow = Math.max(...rows);
    const minCol = Math.min(...cols);
    const maxCol = Math.max(...cols);
    const horizontal = minRow === maxRow;

    const hull = document.createElement("div");
    hull.className = "ship-hull ship-appear " + (horizontal ? "horizontal" : "vertical");
    hull.style.gridColumn = (minCol + 2) + " / " + (maxCol + 3);
    hull.style.gridRow = (minRow + 2) + " / " + (maxRow + 3);
    hull.dataset.shipId = String(ship.id);
    hull.setAttribute("aria-hidden", "true");
    container.appendChild(hull);
  }

  // =========================================================
  // CELL INTERACTION — one shared handler routes to either
  // "placement" or "attack" depending on the current phase and
  // which physical board (left/right) was clicked.
  // =========================================================

  function onCellClick(event) {
    const cellEl = event.currentTarget;
    const container = cellEl.parentElement;
    const row = Number(cellEl.dataset.row);
    const col = Number(cellEl.dataset.col);

    if (state.phase === "placement" && container === els.leftBoard) {
      handlePlacementClick(row, col);
    } else if (state.phase === "battle" && container === els.rightBoard) {
      handleAttackClick(row, col, cellEl);
    }
  }

  function onCellKeydown(event) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onCellClick(event);
    }
  }

  function onCellMouseEnter(event) {
    const cellEl = event.currentTarget;
    if (state.phase !== "placement" || cellEl.parentElement !== els.leftBoard) return;
    handlePlacementHover(Number(cellEl.dataset.row), Number(cellEl.dataset.col));
  }

  // =========================================================
  // MANUAL SHIP PLACEMENT
  // =========================================================

  function currentPlacementConfig() {
    return FLEET_CONFIG[state.placement.shipIndex] || null;
  }

  function handlePlacementClick(row, col) {
    const config = currentPlacementConfig();
    if (!config) return; // this player's fleet is already complete

    const player = state.players[state.activeIndex];
    const horizontal = state.placement.horizontal;

    if (!canPlaceShip(player.grid, row, col, config.length, horizontal)) {
      playSound("miss"); // gentle "can't place here" cue
      return;
    }

    const cells = placeShipOnGrid(player.grid, row, col, config.length, horizontal, player.ships.length);
    player.ships.push({ id: player.ships.length, name: config.name, length: config.length, cells: cells, hits: 0, sunk: false });
    state.placement.shipIndex++;

    clearAllPreview(els.leftBoard);
    paintBoard(els.leftBoard, player, true);
    updatePlacementPanelText();
    updateFleetPanels();
    playSound("click");
  }

  function handlePlacementHover(row, col) {
    clearAllPreview(els.leftBoard);
    const config = currentPlacementConfig();
    if (!config) return;
    const player = state.players[state.activeIndex];
    const horizontal = state.placement.horizontal;
    const cells = getShipCellsFrom(row, col, config.length, horizontal);
    const valid = canPlaceShip(player.grid, row, col, config.length, horizontal);
    cells.forEach(([r, c]) => {
      if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) return;
      const cellEl = getCellEl(els.leftBoard, r, c);
      if (cellEl) cellEl.classList.add(valid ? "preview-valid" : "preview-invalid");
    });
  }

  function clearAllPreview(container) {
    container.querySelectorAll(".preview-valid, .preview-invalid").forEach((el) => {
      el.classList.remove("preview-valid", "preview-invalid");
    });
  }

  function handleRotateClick() {
    state.placement.horizontal = !state.placement.horizontal;
    playSound("click");
  }

  function handleRandomizeClick() {
    const player = state.players[state.activeIndex];
    player.grid = createEmptyGrid();
    player.ships = placeFleetRandomly(player.grid);
    state.placement.shipIndex = FLEET_CONFIG.length;
    clearAllPreview(els.leftBoard);
    paintBoard(els.leftBoard, player, true);
    updatePlacementPanelText();
    updateFleetPanels();
    playSound("click");
  }

  function handleFinishPlacementClick() {
    if (state.placement.shipIndex < FLEET_CONFIG.length) return;
    playSound("click");
    proceedAfterThisPlacerDone();
  }

  function showPlacementPanel() {
    els.placementPanel.hidden = false;
    updatePlacementPanelText();
  }

  function hidePlacementPanel() {
    els.placementPanel.hidden = true;
  }

  function updatePlacementPanelText() {
    const player = state.players[state.activeIndex];
    const config = currentPlacementConfig();
    if (config) {
      els.placementTitle.textContent = player.label + ": place your " + config.name + " (" + config.length + " cells)";
      els.placementSub.textContent = "Click a cell on your board. Use Rotate to change direction.";
      els.finishPlacementBtn.disabled = true;
    } else {
      els.placementTitle.textContent = player.label + ": fleet ready!";
      els.placementSub.textContent = "Review your fleet, then continue when you're ready.";
      els.finishPlacementBtn.disabled = false;
      els.finishPlacementBtn.textContent =
        state.mode === "pvp" && state.activeIndex === 0 ? "Done — Pass to Player 2" : "Start Battle";
    }
  }

  // Called once the CURRENT placer (state.activeIndex) has a full fleet,
  // whether placed manually or via Randomize.
  function proceedAfterThisPlacerDone() {
    hidePlacementPanel();

    if (state.mode === "cpu") {
      state.phase = "battle";
      state.activeIndex = 0;
      boardBinding = { left: 0, right: 1 };
      repaintBoards();
      updateStatusBar();
      updateFleetPanels();
      setAttackBoardInteractive(true);
      return;
    }

    // pvp mode
    if (state.activeIndex === 0) {
      showPassDeviceScreen(1, "placement", () => {
        state.activeIndex = 1;
        boardBinding = { left: 1, right: 0 };
        beginPlacementForCurrentPlayer();
      });
    } else {
      showPassDeviceScreen(0, "startBattle", () => {
        state.phase = "battle";
        state.activeIndex = 0;
        boardBinding = { left: 0, right: 1 };
        repaintBoards();
        updateStatusBar();
        updateFleetPanels();
        setAttackBoardInteractive(true);
      });
    }
  }

  // Kicks off placement for state.activeIndex (always a human — the
  // computer, if any, is auto-placed once at game start, see startNewGame).
  function beginPlacementForCurrentPlayer() {
    const player = state.players[state.activeIndex];
    state.phase = "placement";
    state.placement = { shipIndex: 0, horizontal: true };

    if (selectedPlacement === "auto") {
      player.grid = createEmptyGrid();
      player.ships = placeFleetRandomly(player.grid);
      state.placement.shipIndex = FLEET_CONFIG.length;
    }

    repaintBoards();
    updateFleetPanels();
    updateStatusBar();
    setAttackBoardInteractive(false);

    if (selectedPlacement === "auto" && state.mode === "cpu") {
      // Classic one-click experience: nothing to review, no second
      // human to protect from peeking — go straight into battle.
      proceedAfterThisPlacerDone();
      return;
    }

    showPlacementPanel();
  }

  // =========================================================
  // PLAYER / COMPUTER ATTACKS
  // =========================================================

  function handleAttackClick(row, col, cellEl) {
    const attackerIndex = state.activeIndex;
    const attacker = state.players[attackerIndex];
    if (attacker.isAI) return; // AI never clicks

    const defenderIndex = boardBinding.right;
    const defender = state.players[defenderIndex];
    if (defender.grid[row][col].attacked) return; // cannot attack same cell twice

    setAttackBoardInteractive(false);
    resolveAttack(attackerIndex, defenderIndex, row, col, cellEl);
  }

  function computerTakeTurn(attackerIndex, defenderIndex) {
    if (state.phase !== "battle") return;
    const defender = state.players[defenderIndex];
    const target = chooseComputerTarget(defender.grid);
    if (!target) return; // shouldn't happen before game over
    const [row, col] = target;
    const cellEl = getCellEl(containerForPlayer(defenderIndex), row, col);
    resolveAttack(attackerIndex, defenderIndex, row, col, cellEl);
  }

  // Shared hit/miss resolution for BOTH a human click and a computer shot.
  function resolveAttack(attackerIndex, defenderIndex, row, col, cellEl) {
    const defender = state.players[defenderIndex];
    const cellData = defender.grid[row][col];
    cellData.attacked = true;
    playSound("click");

    if (cellData.shipId !== null) {
      const ship = defender.ships[cellData.shipId];
      ship.hits += 1;
      state.players[attackerIndex].scoreHits += 1;
      cellEl.classList.add("hit");
      triggerExplosion(cellEl);
      playSound("hit");

      if (ship.hits >= ship.length) {
        ship.sunk = true;
        markShipSunk(containerForPlayer(defenderIndex), ship);
        showToast(ship.name.toUpperCase() + " SUNK!");
        playSound("sunk");
        state.ai.huntQueue = []; // stale targets from this ship no longer matter
      }

      updateStatusBar();
      updateFleetPanels();

      if (state.players[attackerIndex].isAI && !ship.sunk) {
        pushHuntNeighbors(defender.grid, row, col);
      }

      if (isFleetDestroyed(defender.ships)) {
        endGame(attackerIndex);
        return;
      }

      continueAfterHit(attackerIndex, defenderIndex);
    } else {
      cellEl.classList.add("miss");
      playSound("miss");
      updateStatusBar();
      switchTurn();
    }
  }

  function continueAfterHit(attackerIndex, defenderIndex) {
    const attacker = state.players[attackerIndex];
    if (attacker.isAI) {
      window.setTimeout(() => computerTakeTurn(attackerIndex, defenderIndex), 700);
    } else {
      setAttackBoardInteractive(true); // same player's turn continues
    }
  }

  function switchTurn() {
    const nextAttacker = 1 - state.activeIndex;
    state.activeIndex = nextAttacker;

    if (state.mode === "pvp") {
      setAttackBoardInteractive(false);
      showPassDeviceScreen(nextAttacker, "turn", () => {
        boardBinding = { left: nextAttacker, right: 1 - nextAttacker };
        repaintBoards();
        updateStatusBar();
        setAttackBoardInteractive(true);
      });
    } else {
      updateStatusBar();
      if (state.players[nextAttacker].isAI) {
        setAttackBoardInteractive(false);
        window.setTimeout(() => computerTakeTurn(nextAttacker, 1 - nextAttacker), 750);
      } else {
        setAttackBoardInteractive(true);
      }
    }
  }

  // =========================================================
  // COMPUTER AI (cpu mode only — hunt-mode around a known hit)
  // =========================================================

  function pushHuntNeighbors(grid, row, col) {
    const candidates = [
      [row - 1, col],
      [row + 1, col],
      [row, col - 1],
      [row, col + 1],
    ];
    candidates.forEach(([r, c]) => {
      if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) return;
      if (grid[r][c].attacked) return;
      if (!state.ai.huntQueue.some((cell) => cell[0] === r && cell[1] === c)) {
        state.ai.huntQueue.push([r, c]);
      }
    });
  }

  function chooseComputerTarget(grid) {
    while (state.ai.huntQueue.length > 0) {
      const candidate = state.ai.huntQueue.shift();
      const [r, c] = candidate;
      if (!grid[r][c].attacked) return candidate;
    }
    const untried = [];
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (!grid[r][c].attacked) untried.push([r, c]);
      }
    }
    if (untried.length === 0) return null;
    return untried[Math.floor(Math.random() * untried.length)];
  }

  // =========================================================
  // SHARED HIT / MISS HELPERS
  // =========================================================

  function markShipSunk(container, ship) {
    ship.cells.forEach(([r, c]) => {
      const cellEl = getCellEl(container, r, c);
      if (cellEl) cellEl.classList.add("sunk");
    });
  }

  function isFleetDestroyed(ships) {
    return ships.length > 0 && ships.every((ship) => ship.sunk);
  }

  function setAttackBoardInteractive(interactive) {
    els.rightBoard.classList.toggle("disabled", !interactive);
  }

  // =========================================================
  // EXPLOSION ANIMATION
  // =========================================================

  function triggerExplosion(cellEl) {
    const explosion = document.createElement("div");
    explosion.className = "explosion";

    const shockwave = document.createElement("div");
    shockwave.className = "shockwave";
    explosion.appendChild(shockwave);

    const glow = document.createElement("div");
    glow.className = "glow";
    explosion.appendChild(glow);

    const smoke = document.createElement("div");
    smoke.className = "smoke";
    explosion.appendChild(smoke);

    const particleCount = 8;
    for (let i = 0; i < particleCount; i++) {
      const particle = document.createElement("div");
      particle.className = "particle";
      const angle = (Math.PI * 2 * i) / particleCount + Math.random() * 0.4;
      const distance = 18 + Math.random() * 14;
      particle.style.setProperty("--dx", Math.cos(angle) * distance + "px");
      particle.style.setProperty("--dy", Math.sin(angle) * distance + "px");
      explosion.appendChild(particle);
    }

    cellEl.appendChild(explosion);
    window.setTimeout(() => explosion.remove(), 950);
  }

  // =========================================================
  // SOUND EFFECTS (Web Audio API — procedural, no audio files)
  // =========================================================

  let audioCtx = null;
  let soundEnabled = true;

  function ensureAudioContext() {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) audioCtx = new AudioContextClass();
    }
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }

  function playTone(freq, duration, type, startGain, delay) {
    const ctx = ensureAudioContext();
    if (!ctx || !soundEnabled) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type || "sine";
    osc.frequency.value = freq;
    const startTime = ctx.currentTime + (delay || 0);
    gain.gain.setValueAtTime(startGain || 0.15, startTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.02);
  }

  function playNoiseBurst(duration, filterFreq, gainValue) {
    const ctx = ensureAudioContext();
    if (!ctx || !soundEnabled) return;
    const bufferSize = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = filterFreq || 1200;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue || 0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start();
  }

  const soundEffects = {
    click: () => playTone(700, 0.05, "square", 0.06),
    miss: () => playNoiseBurst(0.35, 900, 0.14),
    hit: () => {
      playTone(180, 0.25, "sawtooth", 0.18);
      playNoiseBurst(0.25, 1800, 0.16);
    },
    sunk: () => {
      playTone(90, 0.5, "sawtooth", 0.22);
      playTone(60, 0.6, "sine", 0.18, 0.08);
      playNoiseBurst(0.4, 600, 0.18);
    },
    win: () => {
      playTone(523.25, 0.18, "triangle", 0.16, 0);
      playTone(659.25, 0.18, "triangle", 0.16, 0.18);
      playTone(783.99, 0.3, "triangle", 0.18, 0.36);
    },
    lose: () => {
      playTone(392, 0.25, "sine", 0.16, 0);
      playTone(311.13, 0.25, "sine", 0.16, 0.22);
      playTone(233.08, 0.4, "sine", 0.16, 0.44);
    },
  };

  function playSound(name) {
    const effect = soundEffects[name];
    if (effect) effect();
  }

  function toggleSound() {
    soundEnabled = !soundEnabled;
    els.soundToggle.setAttribute("aria-pressed", String(soundEnabled));
    els.soundIcon.textContent = soundEnabled ? "🔊" : "🔇";
    els.soundLabel.textContent = soundEnabled ? "SOUND ON" : "SOUND OFF";
    if (soundEnabled) {
      ensureAudioContext();
      playSound("click");
    }
  }

  // =========================================================
  // GENERIC MODAL (Game Over AND "Pass the Device" reuse this)
  // =========================================================

  let modalActionHandler = null;

  function showModal(title, text, buttonLabel, onAction) {
    els.modalTitle.textContent = title;
    els.modalText.textContent = text;
    els.modalActionBtn.textContent = buttonLabel;
    modalActionHandler = onAction;
    els.modalOverlay.hidden = false;
  }

  function hideModal() {
    els.modalOverlay.hidden = true;
    modalActionHandler = null;
  }

  function handleModalActionClick() {
    playSound("click");
    const handler = modalActionHandler;
    hideModal();
    if (handler) handler();
  }

  function showPassDeviceScreen(nextIndex, purpose, onReady) {
    const player = state.players[nextIndex];
    let text;
    if (purpose === "placement") text = player.label + ", get ready to place your fleet.";
    else if (purpose === "startBattle") text = player.label + ", the battle is about to begin!";
    else text = player.label + ", it's your turn to attack.";
    showModal("Pass the Device", text + " Make sure the other player looks away, then tap ready.", "I'm " + player.label + " — Ready", onReady);
  }

  // =========================================================
  // GAME OVER
  // =========================================================

  function endGame(winnerIndex) {
    state.phase = "over";
    setAttackBoardInteractive(false);
    updateStatusBar();

    const winner = state.players[winnerIndex];
    const loser = state.players[1 - winnerIndex];
    let title, text;

    if (state.mode === "cpu") {
      if (winnerIndex === 0) {
        title = "Victory!";
        text = "All enemy ships have been sunk.";
        playSound("win");
      } else {
        title = "Defeat";
        text = "The enemy fleet has won this battle.";
        playSound("lose");
      }
    } else {
      title = winner.label + " Wins!";
      text = loser.label + "'s entire fleet has been sunk.";
      playSound("win");
    }

    window.setTimeout(() => showModal(title, text, "Play Again", startNewGame), 500);
  }

  // =========================================================
  // UI UPDATES
  // =========================================================

  const els = {};

  function cacheElements() {
    els.leftBoard = document.getElementById("playerBoard");
    els.rightBoard = document.getElementById("enemyBoard");
    els.leftBoardTitle = document.getElementById("leftBoardTitle");
    els.rightBoardTitle = document.getElementById("rightBoardTitle");
    els.leftFleetTitle = document.getElementById("leftFleetTitle");
    els.rightFleetTitle = document.getElementById("rightFleetTitle");
    els.playerFleetList = document.getElementById("playerFleetList");
    els.enemyFleetList = document.getElementById("enemyFleetList");
    els.player0Label = document.getElementById("player0Label");
    els.player1Label = document.getElementById("player1Label");
    els.playerHits = document.getElementById("playerHits");
    els.enemyHits = document.getElementById("enemyHits");
    els.turnIndicator = document.getElementById("turnIndicator");
    els.turnMain = document.getElementById("turnMain");
    els.turnSub = document.getElementById("turnSub");
    els.newGameBtn = document.getElementById("newGameBtn");
    els.soundToggle = document.getElementById("soundToggle");
    els.soundIcon = els.soundToggle.querySelector(".sound-icon");
    els.soundLabel = els.soundToggle.querySelector(".sound-label");
    els.modalOverlay = document.getElementById("modalOverlay");
    els.modalTitle = document.getElementById("modalTitle");
    els.modalText = document.getElementById("modalText");
    els.modalActionBtn = document.getElementById("modalActionBtn");
    els.setupBar = document.getElementById("setupBar");
    els.placementPanel = document.getElementById("placementPanel");
    els.placementTitle = document.getElementById("placementTitle");
    els.placementSub = document.getElementById("placementSub");
    els.rotateBtn = document.getElementById("rotateBtn");
    els.randomizeBtn = document.getElementById("randomizeBtn");
    els.finishPlacementBtn = document.getElementById("finishPlacementBtn");
  }

  function updateBoardTitles() {
    const leftPlayer = state.players[boardBinding.left];
    const rightPlayer = state.players[boardBinding.right];
    if (state.mode === "cpu") {
      els.leftBoardTitle.textContent = "Your Fleet";
      els.rightBoardTitle.textContent = "Enemy Waters";
      els.leftFleetTitle.textContent = "Your Fleet";
      els.rightFleetTitle.textContent = "Enemy Fleet";
    } else {
      els.leftBoardTitle.textContent = leftPlayer.label + "'s Fleet";
      els.rightBoardTitle.textContent = rightPlayer.label + "'s Waters";
      els.leftFleetTitle.textContent = leftPlayer.label + "'s Fleet";
      els.rightFleetTitle.textContent = rightPlayer.label + "'s Fleet";
    }
  }

  function updateStatusBar() {
    els.player0Label.textContent = state.players[0].label;
    els.player1Label.textContent = state.players[1].label;
    els.playerHits.textContent = state.players[0].scoreHits + " hits";
    els.enemyHits.textContent = state.players[1].scoreHits + " hits";

    if (state.phase === "over") {
      els.turnMain.textContent = "Game Over";
      els.turnSub.textContent = "Start a new game to play again";
      els.turnIndicator.classList.remove("enemy-turn", "your-turn");
      return;
    }

    if (state.phase === "placement") {
      const placer = state.players[state.activeIndex];
      els.turnMain.textContent = placer.label + " is placing ships";
      els.turnSub.textContent = "Waiting for placement to finish...";
      els.turnIndicator.classList.remove("enemy-turn", "your-turn");
      return;
    }

    const attacker = state.players[state.activeIndex];
    if (state.mode === "cpu" && attacker.isAI) {
      els.turnMain.textContent = "Computer's Turn";
      els.turnSub.textContent = "Enemy is choosing a target...";
      els.turnIndicator.classList.remove("your-turn");
      els.turnIndicator.classList.add("enemy-turn");
    } else {
      els.turnMain.textContent = state.mode === "pvp" ? attacker.label + "'s Turn" : "Your Turn";
      els.turnSub.textContent = "Choose a target to attack";
      els.turnIndicator.classList.remove("enemy-turn");
      els.turnIndicator.classList.add("your-turn");
    }
  }

  function shipIconSVG(length) {
    const width = 20 + length * 6;
    return (
      '<svg viewBox="0 0 ' + (width + 8) + ' 20" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M4 12 L10 5 L' + (width - 6) + ' 5 L' + (width + 2) + ' 12 L' + (width - 4) + ' 17 L8 17 Z" fill="currentColor"/>' +
      "</svg>"
    );
  }

  function buildFleetList(listEl, ships) {
    listEl.innerHTML = "";
    ships.forEach((ship) => {
      const li = document.createElement("li");
      li.className = "fleet-item" + (ship.sunk ? " sunk" : "");

      const icon = document.createElement("span");
      icon.className = "fleet-item-icon";
      icon.innerHTML = shipIconSVG(ship.length);
      icon.style.color = ship.sunk ? "#C96A63" : "#795548";

      const name = document.createElement("span");
      name.className = "fleet-item-name";
      name.textContent = ship.name + " (" + ship.length + ")";

      const status = document.createElement("span");
      status.className = "fleet-item-status";
      status.textContent = ship.sunk ? "SUNK" : ship.hits + "/" + ship.length;

      li.appendChild(icon);
      li.appendChild(name);
      li.appendChild(status);
      listEl.appendChild(li);
    });
  }

  function updateFleetPanels() {
    buildFleetList(els.playerFleetList, state.players[boardBinding.left].ships);
    buildFleetList(els.enemyFleetList, state.players[boardBinding.right].ships);
  }

  let toastTimeout = null;
  function showToast(message) {
    let toast = document.getElementById("gameToast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "gameToast";
      toast.className = "toast";
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.remove("show");
    void toast.offsetWidth;
    toast.classList.add("show");
    if (toastTimeout) window.clearTimeout(toastTimeout);
    toastTimeout = window.setTimeout(() => toast.classList.remove("show"), 1600);
  }

  // =========================================================
  // RESTART / NEW GAME
  // =========================================================

  function startNewGame() {
    state = createInitialState(selectedMode);
    boardBinding = { left: 0, right: 1 };

    buildBoardSkeleton(els.leftBoard, "player-board");
    buildBoardSkeleton(els.rightBoard, "enemy-board");
    hideModal();

    if (state.mode === "cpu") {
      // The computer places its fleet immediately and privately.
      state.players[1].ships = placeFleetRandomly(state.players[1].grid);
    }

    state.activeIndex = 0;
    beginPlacementForCurrentPlayer();
  }

  function handleNewGameClick() {
    playSound("click");
    startNewGame();
  }

  function handleSetupModeClick(event) {
    selectedMode = event.currentTarget.dataset.mode;
    document.querySelectorAll(".setup-btn[data-mode]").forEach((btn) => {
      btn.classList.toggle("active", btn === event.currentTarget);
    });
    playSound("click");
    startNewGame();
  }

  function handleSetupPlacementClick(event) {
    selectedPlacement = event.currentTarget.dataset.placement;
    document.querySelectorAll(".setup-btn[data-placement]").forEach((btn) => {
      btn.classList.toggle("active", btn === event.currentTarget);
    });
    playSound("click");
    startNewGame();
  }

  // =========================================================
  // INIT
  // =========================================================

  function init() {
    cacheElements();
    els.newGameBtn.addEventListener("click", handleNewGameClick);
    els.modalActionBtn.addEventListener("click", handleModalActionClick);
    els.soundToggle.addEventListener("click", toggleSound);
    els.rotateBtn.addEventListener("click", handleRotateClick);
    els.randomizeBtn.addEventListener("click", handleRandomizeClick);
    els.finishPlacementBtn.addEventListener("click", handleFinishPlacementClick);
    document.querySelectorAll(".setup-btn[data-mode]").forEach((btn) => {
      btn.addEventListener("click", handleSetupModeClick);
    });
    document.querySelectorAll(".setup-btn[data-placement]").forEach((btn) => {
      btn.addEventListener("click", handleSetupPlacementClick);
    });
    startNewGame();
  }

  document.addEventListener("DOMContentLoaded", init);
})();