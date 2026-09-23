/* =========================================================
   BATTLESHIP — script.js
   All game logic, rendering, sound, and interaction lives here.
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

  function createInitialState() {
    return {
      playerGrid: createEmptyGrid(),
      enemyGrid: createEmptyGrid(),
      playerShips: [],
      enemyShips: [],
      turn: "player", // "player" | "enemy"
      gameOver: false,
      playerHits: 0,
      enemyHits: 0,
      // AI hunt-mode memory
      ai: {
        huntQueue: [], // candidate cells to try after a confirmed hit
        lastHitOrigin: null,
      },
    };
  }

  // =========================================================
  // SHIP PLACEMENT
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

  function placeShipOnGrid(grid, row, col, length, horizontal, shipId) {
    const cells = [];
    for (let i = 0; i < length; i++) {
      const r = horizontal ? row : row + i;
      const c = horizontal ? col + i : col;
      grid[r][c].shipId = shipId;
      cells.push([r, c]);
    }
    return cells;
  }

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
          ships.push({
            id: index,
            name: config.name,
            length: config.length,
            cells: cells,
            hits: 0,
            sunk: false,
          });
          placed = true;
        }
      }
      if (!placed) {
        // Extremely unlikely with a 10x10 board and the classic fleet,
        // but fall back gracefully rather than leaving a ship unplaced.
        console.warn("Could not place ship:", config.name);
      }
    });
    return ships;
  }

  // =========================================================
  // BOARD CREATION (DOM)
  // =========================================================

  function buildBoardDOM(container, kind) {
    container.innerHTML = "";
    container.classList.add(kind === "player" ? "player-board" : "enemy-board");

    // top-left empty corner — explicit grid position (line 1,1)
    const corner = makeLabelCell("");
    corner.style.gridColumn = "1";
    corner.style.gridRow = "1";
    container.appendChild(corner);

    // column labels A..J — every cell below is explicitly placed too,
    // so the ship-hull overlays (also explicitly placed) can never
    // push these out of alignment via auto-placement.
    for (let c = 0; c < BOARD_SIZE; c++) {
      const colLabel = makeLabelCell(COL_LABELS[c]);
      colLabel.style.gridColumn = String(c + 2);
      colLabel.style.gridRow = "1";
      container.appendChild(colLabel);
    }

    for (let r = 0; r < BOARD_SIZE; r++) {
      // row label
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
        cell.setAttribute("role", "gridcell");
        if (kind === "enemy") {
          cell.tabIndex = 0;
          cell.setAttribute(
            "aria-label",
            "Fire at " + COL_LABELS[c] + (r + 1)
          );
          cell.addEventListener("click", onEnemyCellClick);
          cell.addEventListener("keydown", onEnemyCellKeydown);
        } else {
          cell.setAttribute("aria-label", COL_LABELS[c] + (r + 1));
        }
        container.appendChild(cell);
      }
    }
  }

  function makeLabelCell(text) {
    const label = document.createElement("div");
    label.className = "cell-label";
    label.textContent = text;
    label.setAttribute("aria-hidden", "true");
    return label;
  }

  function getCellEl(container, row, col) {
    return container.querySelector(
      '.cell[data-row="' + row + '"][data-col="' + col + '"]'
    );
  }

  function renderPlayerShips() {
    const container = els.playerBoard;
    state.playerShips.forEach((ship) => {
      ship.cells.forEach(([r, c]) => {
        const cellEl = getCellEl(container, r, c);
        if (cellEl) {
          // Cells stay transparent (see .cell.ship in style.css) so the
          // single hull silhouette added below shows through them.
          cellEl.classList.add("ship", "ship-appear");
        }
      });
      appendShipHull(container, ship);
    });
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
  // PLAYER ATTACK
  // =========================================================

  function onEnemyCellClick(event) {
    if (state.gameOver || state.turn !== "player") return;
    const cell = event.currentTarget;
    const row = Number(cell.dataset.row);
    const col = Number(cell.dataset.col);
    attemptPlayerAttack(row, col, cell);
  }

  function onEnemyCellKeydown(event) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onEnemyCellClick(event);
    }
  }

  function attemptPlayerAttack(row, col, cellEl) {
    const cellData = state.enemyGrid[row][col];
    if (cellData.attacked) return; // cannot attack same cell twice

    cellData.attacked = true;
    playSound("click");
    setEnemyBoardInteractive(false);

    if (cellData.shipId !== null) {
      const ship = state.enemyShips[cellData.shipId];
      ship.hits += 1;
      state.playerHits += 1;
      cellEl.classList.add("hit");
      triggerExplosion(cellEl);
      playSound("hit");
      updateStatusBar();

      if (ship.hits >= ship.length) {
        ship.sunk = true;
        markShipSunk(state.enemyGrid, ship, els.enemyBoard);
        showToast(ship.name.toUpperCase() + " SUNK!");
        playSound("sunk");
      }

      updateFleetPanels();

      if (isFleetDestroyed(state.enemyShips)) {
        endGame(true);
        return;
      }

      // Player hit — player goes again, so re-enable the board.
      setEnemyBoardInteractive(true);
    } else {
      cellEl.classList.add("miss");
      playSound("miss");
      // Turn passes to the computer.
      state.turn = "enemy";
      updateStatusBar();
      window.setTimeout(computerTakeTurn, 750);
    }
  }

  // =========================================================
  // COMPUTER ATTACK
  // =========================================================

  function computerTakeTurn() {
    if (state.gameOver) return;

    const target = chooseComputerTarget();
    if (!target) return; // no cells left (shouldn't happen before game over)

    const [row, col] = target;
    const cellData = state.playerGrid[row][col];
    cellData.attacked = true;

    const cellEl = getCellEl(els.playerBoard, row, col);

    if (cellData.shipId !== null) {
      const ship = state.playerShips[cellData.shipId];
      ship.hits += 1;
      state.enemyHits += 1;
      cellEl.classList.add("hit");
      triggerExplosion(cellEl);
      playSound("hit");
      updateStatusBar();

      // feed hunt-mode queue with neighboring cells
      pushHuntNeighbors(row, col);

      if (ship.hits >= ship.length) {
        ship.sunk = true;
        markShipSunk(state.playerGrid, ship, els.playerBoard);
        showToast("YOUR " + ship.name.toUpperCase() + " WAS SUNK");
        playSound("sunk");
        // ship sunk: clear stale hunt targets, AI will pick fresh ones
        state.ai.huntQueue = [];
      }

      updateFleetPanels();

      if (isFleetDestroyed(state.playerShips)) {
        endGame(false);
        return;
      }

      // Computer hit — it gets another turn.
      window.setTimeout(computerTakeTurn, 700);
    } else {
      cellEl.classList.add("miss");
      playSound("miss");
      state.turn = "player";
      updateStatusBar();
      setEnemyBoardInteractive(true);
    }
  }

  function pushHuntNeighbors(row, col) {
    const candidates = [
      [row - 1, col],
      [row + 1, col],
      [row, col - 1],
      [row, col + 1],
    ];
    candidates.forEach(([r, c]) => {
      if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) return;
      if (state.playerGrid[r][c].attacked) return;
      const key = r + "-" + c;
      if (!state.ai.huntQueue.some((cell) => cell[0] === r && cell[1] === c)) {
        state.ai.huntQueue.push([r, c]);
      }
    });
  }

  function chooseComputerTarget() {
    // Prefer hunting near a known hit.
    while (state.ai.huntQueue.length > 0) {
      const candidate = state.ai.huntQueue.shift();
      const [r, c] = candidate;
      if (!state.playerGrid[r][c].attacked) return candidate;
    }

    // Fall back to a random untried cell.
    const untried = [];
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (!state.playerGrid[r][c].attacked) untried.push([r, c]);
      }
    }
    if (untried.length === 0) return null;
    return untried[Math.floor(Math.random() * untried.length)];
  }

  // =========================================================
  // HIT / MISS (shared helpers)
  // =========================================================

  function markShipSunk(grid, ship, boardContainer) {
    ship.cells.forEach(([r, c]) => {
      const cellEl = getCellEl(boardContainer, r, c);
      if (cellEl) cellEl.classList.add("sunk");
    });
  }

  function isFleetDestroyed(ships) {
    return ships.every((ship) => ship.sunk);
  }

  function setEnemyBoardInteractive(interactive) {
    els.enemyBoard.classList.toggle("disabled", !interactive);
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
      const dx = Math.cos(angle) * distance;
      const dy = Math.sin(angle) * distance;
      particle.style.setProperty("--dx", dx + "px");
      particle.style.setProperty("--dy", dy + "px");
      explosion.appendChild(particle);
    }

    cellEl.appendChild(explosion);
    window.setTimeout(() => {
      explosion.remove();
    }, 950);
  }

  // =========================================================
  // SOUND EFFECTS (Web Audio API — procedural, no audio files)
  // =========================================================

  let audioCtx = null;
  let soundEnabled = true;

  function ensureAudioContext() {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        audioCtx = new AudioContextClass();
      }
    }
    if (audioCtx && audioCtx.state === "suspended") {
      audioCtx.resume();
    }
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
  // GAME OVER
  // =========================================================

  function endGame(playerWon) {
    state.gameOver = true;
    setEnemyBoardInteractive(false);
    updateStatusBar();

    if (playerWon) {
      els.modalTitle.textContent = "Victory!";
      els.modalText.textContent = "All enemy ships have been sunk.";
      els.modalRestartBtn.textContent = "Play Again";
      playSound("win");
    } else {
      els.modalTitle.textContent = "Defeat";
      els.modalText.textContent = "The enemy fleet has won this battle.";
      els.modalRestartBtn.textContent = "Try Again";
      playSound("lose");
    }

    window.setTimeout(() => {
      els.modalOverlay.hidden = false;
    }, 500);
  }

  function hideModal() {
    els.modalOverlay.hidden = true;
  }

  // =========================================================
  // UI UPDATES
  // =========================================================

  const els = {};

  function cacheElements() {
    els.playerBoard = document.getElementById("playerBoard");
    els.enemyBoard = document.getElementById("enemyBoard");
    els.playerFleetList = document.getElementById("playerFleetList");
    els.enemyFleetList = document.getElementById("enemyFleetList");
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
    els.modalRestartBtn = document.getElementById("modalRestartBtn");
  }

  function updateStatusBar() {
    els.playerHits.textContent = state.playerHits + " hits";
    els.enemyHits.textContent = state.enemyHits + " hits";

    if (state.gameOver) {
      els.turnMain.textContent = "Game Over";
      els.turnSub.textContent = "Start a new game to play again";
      els.turnIndicator.classList.remove("enemy-turn", "your-turn");
      return;
    }

    if (state.turn === "player") {
      els.turnMain.textContent = "Your Turn";
      els.turnSub.textContent = "Choose a target to attack";
      els.turnIndicator.classList.remove("enemy-turn");
      els.turnIndicator.classList.add("your-turn");
    } else {
      els.turnMain.textContent = "Computer's Turn";
      els.turnSub.textContent = "Enemy is choosing a target...";
      els.turnIndicator.classList.remove("your-turn");
      els.turnIndicator.classList.add("enemy-turn");
    }
  }

  function shipIconSVG(length) {
    // A simple stylised hull silhouette; width communicates ship length.
    const width = 20 + length * 6;
    return (
      '<svg viewBox="0 0 ' + (width + 8) + ' 20" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M4 12 L10 5 L' + (width - 6) + ' 5 L' + (width + 2) + ' 12 L' + (width - 4) + ' 17 L8 17 Z" fill="currentColor"/>' +
      '</svg>'
    );
  }

  function buildFleetList(listEl, ships, colorClass) {
    listEl.innerHTML = "";
    ships.forEach((ship) => {
      const li = document.createElement("li");
      li.className = "fleet-item" + (ship.sunk ? " sunk" : "");
      li.dataset.shipId = String(ship.id);

      const icon = document.createElement("span");
      icon.className = "fleet-item-icon " + colorClass;
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
    buildFleetList(els.playerFleetList, state.playerShips, "mine");
    buildFleetList(els.enemyFleetList, state.enemyShips, "theirs");
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
    // restart animation
    toast.classList.remove("show");
    // force reflow so the class removal takes effect before re-adding
    void toast.offsetWidth;
    toast.classList.add("show");

    if (toastTimeout) window.clearTimeout(toastTimeout);
    toastTimeout = window.setTimeout(() => {
      toast.classList.remove("show");
    }, 1600);
  }

  // =========================================================
  // RESTART / NEW GAME
  // =========================================================

  function startNewGame() {
    state = createInitialState();
    state.playerShips = placeFleetRandomly(state.playerGrid);
    state.enemyShips = placeFleetRandomly(state.enemyGrid);

    buildBoardDOM(els.playerBoard, "player");
    buildBoardDOM(els.enemyBoard, "enemy");
    renderPlayerShips();

    setEnemyBoardInteractive(true);
    updateStatusBar();
    updateFleetPanels();
    hideModal();
  }

  function handleNewGameClick() {
    playSound("click");
    startNewGame();
  }

  // =========================================================
  // INIT
  // =========================================================

  function init() {
    cacheElements();
    els.newGameBtn.addEventListener("click", handleNewGameClick);
    els.modalRestartBtn.addEventListener("click", handleNewGameClick);
    els.soundToggle.addEventListener("click", toggleSound);
    startNewGame();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
