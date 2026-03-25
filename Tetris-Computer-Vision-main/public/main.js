/**
 * Tetris Hands — menu first, single + multiplayer, MediaPipe CV in-browser.
 *
 * FIXES + FEATURES:
 * - CV: requestAnimationFrame loop only (no camera_utils). Robust auto-retry start.
 * - CV: Hands instance persists across menu/restart (only closed if stopStreamTracks === true).
 * - Movement: position zones w/ hysteresis. Toggle inversion in ONE place only.
 * - Rotate: wrist twist (palm roll) using landmarks 0,5,17. CW/CCW by twist direction.
 * - Wave down: dy threshold in short window triggers soft drop burst.
 * - Debug/Logs: shows if onResults is firing + how many hands.
 */
(function () {
  "use strict";
  console.log("main.js loaded ✅");

  // ===================== GAME CONSTANTS =====================
  var BOARD_W = 10, BOARD_H = 20, BLOCK_PX = 28;
  var SCORE_TABLE = { 1: 100, 2: 300, 3: 500, 4: 800 };
  var LINES_PER_LEVEL = 10, GRAVITY_BASE_MS = 1000, GRAVITY_MIN_MS = 80;

  // ===================== GESTURE CONFIG (tweak here) =====================
  var GESTURE_CONFIG = {
    invertLeftRight: true,
    emaAlpha: 0.28,
    leftZoneEnter: 0.35,
    leftZoneExit: 0.45,
    rightZoneEnter: 0.65,
    rightZoneExit: 0.55,
    zoneHoldMs: 300,
    moveRepeatMs: 160,
    pinchThreshold: 0.08,
    rotateCooldownMs: 280,
    wristTwistTriggerDeg: 25,
    wristTwistReleaseDeg: 12,
    dropDyThreshold: 0.10,
    dropTimeWindowMs: 180,
    softDropRepeatMs: 80,
    softDropHoldMs: 650,
    openPalmTipMcpMin: 0.12,
    openPalmHoldMs: 500,
    hardDropCooldownMs: 800,
    twoHandPauseHoldMs: 1000,
    twoHandPauseCooldownMs: 1500,
    vSignHoldMs: 400,
    pauseDebounceMs: 800
  };
  var EMA_ALPHA = GESTURE_CONFIG.emaAlpha;
  var INVERT_LEFT_RIGHT = GESTURE_CONFIG.invertLeftRight;
  var LEFT_ENTER = GESTURE_CONFIG.leftZoneEnter;
  var LEFT_EXIT = GESTURE_CONFIG.leftZoneExit;
  var RIGHT_ENTER = GESTURE_CONFIG.rightZoneEnter;
  var RIGHT_EXIT = GESTURE_CONFIG.rightZoneExit;
  var MOVE_REPEAT_MS = GESTURE_CONFIG.moveRepeatMs;
  var DROP_DY_THRESHOLD = GESTURE_CONFIG.dropDyThreshold;
  var DROP_TIME_MS = GESTURE_CONFIG.dropTimeWindowMs;
  var SOFTDROP_REPEAT_MS = GESTURE_CONFIG.softDropRepeatMs;
  var SOFTDROP_HOLD_MS = GESTURE_CONFIG.softDropHoldMs;
  var TWIST_TRIGGER_DEG = GESTURE_CONFIG.wristTwistTriggerDeg;
  var TWIST_RELEASE_DEG = GESTURE_CONFIG.wristTwistReleaseDeg;
  var ROTATE_DEBOUNCE_MS = GESTURE_CONFIG.rotateCooldownMs;
  var OPEN_PALM_TIP_MCP_MIN = GESTURE_CONFIG.openPalmTipMcpMin;
  var OPEN_PALM_HOLD_MS = GESTURE_CONFIG.openPalmHoldMs;
  var HARD_DROP_DEBOUNCE_MS = GESTURE_CONFIG.hardDropCooldownMs;
  var V_SIGN_HOLD_MS = GESTURE_CONFIG.vSignHoldMs;
  var PAUSE_DEBOUNCE_MS = GESTURE_CONFIG.pauseDebounceMs;
  var LOCALSTORAGE_CAMERA_KEY = "tetris-camera-deviceId";

  // ===================== PIECES =====================
  var PIECES = {
    I: { id: 1, color: 0x00ffff, cells: [[0,1],[1,1],[2,1],[3,1]] },
    O: { id: 2, color: 0xffff00, cells: [[0,0],[1,0],[0,1],[1,1]] },
    T: { id: 3, color: 0xaa00ff, cells: [[1,0],[0,1],[1,1],[2,1]] },
    S: { id: 4, color: 0x00ff00, cells: [[1,0],[2,0],[0,1],[1,1]] },
    Z: { id: 5, color: 0xff0000, cells: [[0,0],[1,0],[1,1],[2,1]] },
    J: { id: 6, color: 0x0000ff, cells: [[0,0],[0,1],[1,1],[2,1]] },
    L: { id: 7, color: 0xff8800, cells: [[2,0],[0,1],[1,1],[2,1]] }
  };
  var PIECE_NAMES = ["I","O","T","S","Z","J","L"];

  function createEmptyBoard() {
    return Array.from({ length: BOARD_H }, function () { return Array(BOARD_W).fill(0); });
  }

  function makeBag() {
    var arr = PIECE_NAMES.slice();
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  function getPiece(name) { return PIECES[name] || PIECES.I; }

  // ===================== ROTATION =====================
  function rotateCells(cells, cw) {
    var rot = cw
      ? function(c){ return [c[1], -c[0]]; }
      : function(c){ return [-c[1], c[0]]; };

    var out = cells.map(function(c){ return rot(c); });
    var minX = Math.min.apply(null, out.map(function(c){return c[0];}));
    var minY = Math.min.apply(null, out.map(function(c){return c[1];}));
    return out.map(function(c){ return [c[0]-minX, c[1]-minY]; });
  }

  function collides(board, piece, px, py) {
    for (var i = 0; i < piece.cells.length; i++) {
      var x = piece.cells[i][0], y = piece.cells[i][1];
      var nx = px + x, ny = py + y;
      if (nx < 0 || nx >= BOARD_W || ny >= BOARD_H) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
    return false;
  }

  function merge(board, piece, px, py, id) {
    var b = board.map(function(r){ return r.slice(); });
    for (var i = 0; i < piece.cells.length; i++) {
      var y = py + piece.cells[i][1];
      if (y >= 0 && y < BOARD_H) b[y][px + piece.cells[i][0]] = id;
    }
    return b;
  }

  function clearLines(board) {
    var cleared = 0, b = board;
    for (var row = BOARD_H - 1; row >= 0; row--) {
      if (b[row].every(function(v){ return v > 0; })) {
        cleared++;
        b = b.slice(0, row).concat(b.slice(row + 1));
        b.unshift(Array(BOARD_W).fill(0));
        row++;
      }
    }
    return { board: b, cleared: cleared };
  }

  function spawnX(name) {
    var piece = getPiece(name);
    var w = Math.max.apply(null, piece.cells.map(function(c){ return c[0]; })) + 1;
    return Math.floor((BOARD_W - w) / 2);
  }

  // ===================== GAME STATE =====================
  var board = createEmptyBoard(), current = null, currentPx = 0, currentPy = 0, currentRot = 0;
  var bag = [], nextPieceName = null, score = 0, lines = 0, level = 1, gameOver = false, paused = false;
  var gravityAcc = 0, lastGravityMs = GRAVITY_BASE_MS;
  var opponentState = null;

  /** menu | ready | playing | paused | gameover */
  var gamePhase = "menu";

  function gravityMs() { return Math.max(GRAVITY_MIN_MS, GRAVITY_BASE_MS - (level - 1) * 80); }
  function refillBag() { if (bag.length === 0) bag = makeBag(); }

  function spawn() {
    refillBag();
    var name = nextPieceName || bag.shift();
    nextPieceName = bag.shift();
    var piece = getPiece(name);
    var px = spawnX(name), py = 0;
    if (collides(board, piece, px, py)) { gameOver = true; gamePhase = "gameover"; return; }
    current = { name: name, cells: piece.cells.map(function(c){ return c.slice(); }) };
    currentPx = px; currentPy = py; currentRot = 0;
  }

  function lock() {
    if (!current) return;
    var id = getPiece(current.name).id;
    board = merge(board, current, currentPx, currentPy, id);
    var result = clearLines(board);
    board = result.board;
    if (result.cleared > 0) {
      score += (SCORE_TABLE[result.cleared] || 800) * level;
      lines += result.cleared;
      level = Math.floor(lines / LINES_PER_LEVEL) + 1;
      lastGravityMs = gravityMs();
    }
    current = null;
    spawn();
  }

  function moveLeft() {
    if (gamePhase !== "playing" || gameOver || paused || !current) return;
    if (!collides(board, current, currentPx - 1, currentPy)) currentPx--;
  }

  function moveRight() {
    if (gamePhase !== "playing" || gameOver || paused || !current) return;
    if (!collides(board, current, currentPx + 1, currentPy)) currentPx++;
  }

  function rotateCW() {
    if (gamePhase !== "playing" || gameOver || paused || !current) return;
    if (current.name === "O") return;
    var nextCells = rotateCells(current.cells, true);
    var kicks = [0, -1, 1, -2, 2];
    for (var k = 0; k < kicks.length; k++) {
      if (!collides(board, { cells: nextCells }, currentPx + kicks[k], currentPy)) {
        current.cells = nextCells; currentPx += kicks[k]; currentRot = (currentRot + 1) % 4;
        return;
      }
    }
  }

  function rotateCCW() {
    if (gamePhase !== "playing" || gameOver || paused || !current) return;
    if (current.name === "O") return;
    var nextCells = rotateCells(current.cells, false);
    var kicks = [0, -1, 1, -2, 2];
    for (var k = 0; k < kicks.length; k++) {
      if (!collides(board, { cells: nextCells }, currentPx + kicks[k], currentPy)) {
        current.cells = nextCells; currentPx += kicks[k]; currentRot = (currentRot + 3) % 4;
        return;
      }
    }
  }

  function softDrop() {
    if (gamePhase !== "playing" || gameOver || paused || !current) return;
    if (!collides(board, current, currentPx, currentPy + 1)) { currentPy++; score += 1; return; }
    lock();
  }

  function hardDrop() {
    if (gamePhase !== "playing" || gameOver || paused || !current) return;
    while (!collides(board, current, currentPx, currentPy + 1)) { currentPy++; score += 2; }
    lock();
  }

  function hold() {
    if (gamePhase !== "playing" && gamePhase !== "ready") return;
    if (gameOver || paused || !current) return;
  }

  function togglePause() {
    if (gameOver) return;
    paused = !paused;
    gamePhase = paused ? "paused" : "playing";
    showPause(paused);
    setPauseLabel();
  }

  window.TetrisControls = {
    moveLeft: moveLeft,
    moveRight: moveRight,
    rotate: rotateCW,
    rotateCW: rotateCW,
    rotateCCW: rotateCCW,
    softDrop: softDrop,
    hardDrop: hardDrop,
    drop: hardDrop,
    hold: hold,
    togglePause: togglePause
  };

  function resetGame() {
    board = createEmptyBoard();
    current = null; bag = []; nextPieceName = null;
    score = 0; lines = 0; level = 1; gameOver = false; paused = false;
    gravityAcc = 0; lastGravityMs = GRAVITY_BASE_MS;
  }

  function showPause(show) {
    var el = document.getElementById("pauseOverlay");
    if (el) { if (show) el.classList.remove("hidden"); else el.classList.add("hidden"); }
  }

  function showGameOver(show) {
    var el = document.getElementById("gameOverOverlay");
    if (el) { if (show) el.classList.remove("hidden"); else el.classList.add("hidden"); }
  }

  function setPauseLabel() {
    var btn = document.getElementById("btnPause") || document.getElementById("btnPauseMulti");
    if (btn) btn.textContent = paused ? "RESUME" : "PAUSE";
  }

  function updateHud() {
    var a = document.getElementById("scoreEl"), b = document.getElementById("linesEl"), c = document.getElementById("levelEl");
    if (a) a.textContent = score; if (b) b.textContent = lines; if (c) c.textContent = level;

    var s1 = document.getElementById("mpScore1"), s2 = document.getElementById("mpLines1");
    if (s1) s1.textContent = score; if (s2) s2.textContent = lines;

    var o1 = document.getElementById("mpScore2"), o2 = document.getElementById("mpLines2");
    if (o1 && opponentState) o1.textContent = opponentState.score || 0;
    if (o2 && opponentState) o2.textContent = opponentState.lines || 0;
  }

  function drawNextPiece() {
    var canvas = document.getElementById("nextCanvas");
    if (!canvas) return;
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = "rgba(0,0,0,0.8)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (!nextPieceName) return;
    var piece = getPiece(nextPieceName);
    var cells = piece.cells;

    var minX = Math.min.apply(null, cells.map(function(c){return c[0];}));
    var minY = Math.min.apply(null, cells.map(function(c){return c[1];}));
    var maxX = Math.max.apply(null, cells.map(function(c){return c[0];}));
    var maxY = Math.max.apply(null, cells.map(function(c){return c[1];}));
    var cw = maxX - minX + 1, ch = maxY - minY + 1;

    var block = Math.min(80 / (cw + 1), 80 / (ch + 1), 18);
    var offX = (80 - cw * block) / 2, offY = (80 - ch * block) / 2;

    var hex = piece.color, r = (hex >> 16) & 0xff, g = (hex >> 8) & 0xff, bb = hex & 0xff;
    ctx.fillStyle = "rgb(" + r + "," + g + "," + bb + ")";
    cells.forEach(function(cell) {
      ctx.fillRect(offX + (cell[0] - minX) * block, offY + (cell[1] - minY) * block, block - 1, block - 1);
    });
  }

  function tickUi() {
    updateHud();
    drawNextPiece();
    showGameOver(gameOver);
  }

  function goToReadyState() {
    resetGame();
    gamePhase = "ready";
    showGameOver(false);
    showPause(false);
    setPauseLabel();
    var startOl = document.getElementById("startOverlaySingle");
    if (startOl) startOl.classList.remove("hidden");
    tickUi();
  }

  function startGame() {
    if (gamePhase === "gameover") return;
    gamePhase = "playing";
    spawn();
    var startOl = document.getElementById("startOverlaySingle");
    if (startOl) startOl.classList.add("hidden");
    var multiOl = document.getElementById("multiReadyOverlay");
    if (multiOl) multiOl.classList.add("hidden");
    var btnStartMulti = document.getElementById("btnStartMultiGame");
    if (btnStartMulti) btnStartMulti.classList.add("hidden");
    tickUi();
  }

  function goToReadyStateMulti() {
    resetGame();
    gamePhase = "ready";
    showGameOver(false);
    showPause(false);
    setPauseLabel();
    var multiOl = document.getElementById("multiReadyOverlay");
    if (multiOl) { multiOl.classList.remove("hidden"); }
    var label = document.getElementById("multiReadyLabel");
    if (label) label.textContent = isHost ? "Click START to begin" : "Waiting for host to start";
    var btnStartMulti = document.getElementById("btnStartMultiGame");
    if (btnStartMulti) {
      if (isHost) btnStartMulti.classList.remove("hidden");
      else btnStartMulti.classList.add("hidden");
    }
    tickUi();
  }

  // ===================== SCREEN / MULTI =====================
  var screen = "menu"; // menu | single | multi_lobby | multi_game
  var socket = io();
  var roomCode = null, isHost = false, playerCount = 0;
  var stateBroadcastInterval = null;

  function showScreen(id) {
    document.querySelectorAll(".screen").forEach(function(s) {
      s.classList.add("hidden");
    });
    var el = document.getElementById(id);
    if (el) el.classList.remove("hidden");
    if (id === "screen-menu") screen = "menu";
    else if (id === "screen-single") screen = "single";
    else if (id === "screen-multi-lobby") screen = "multi_lobby";
    else if (id === "screen-multi-game") screen = "multi_game";
  }

  function setScreen(s) {
    screen = s;
    var showId = s === "menu" ? "screen-menu"
      : s === "single" ? "screen-single"
      : s === "multi_lobby" ? "screen-multi-lobby"
      : "screen-multi-game";
    showScreen(showId);
  }

  // ===================== PHASER DRAW =====================
  var game = null;
  var BOARD_PX_W = BOARD_W * BLOCK_PX, BOARD_PX_H = BOARD_H * BLOCK_PX;

  function drawOneBoard(gfx, b, cur, cx, cy, ox, oy) {
    gfx.lineStyle(2, 0x00ffff, 0.9);
    gfx.strokeRect(ox, oy, BOARD_PX_W, BOARD_PX_H);

    for (var row = 0; row < BOARD_H; row++) {
      for (var col = 0; col < BOARD_W; col++) {
        var id = b[row][col];
        if (id) {
          var color = (PIECES[PIECE_NAMES[id - 1]] || PIECES.I).color;
          var x = ox + col * BLOCK_PX, y = oy + row * BLOCK_PX;
          gfx.fillStyle(color, 1);
          gfx.fillRect(x + 1, y + 1, BLOCK_PX - 2, BLOCK_PX - 2);
          gfx.lineStyle(1, 0xffffff, 0.3);
          gfx.strokeRect(x, y, BLOCK_PX, BLOCK_PX);
        }
      }
    }

    if (cur && cur.cells) {
      var piece = getPiece(cur.name);
      if (piece) {
        var color2 = piece.color;
        for (var i = 0; i < cur.cells.length; i++) {
          var xx = ox + (cx + cur.cells[i][0]) * BLOCK_PX, yy = oy + (cy + cur.cells[i][1]) * BLOCK_PX;
          gfx.fillStyle(color2, 1);
          gfx.fillRect(xx + 1, yy + 1, BLOCK_PX - 2, BLOCK_PX - 2);
          gfx.lineStyle(1, 0xffffff, 0.5);
          gfx.strokeRect(xx, yy, BLOCK_PX, BLOCK_PX);
        }
      }
    }
  }

  function drawBoardPhaser(gfx) {
    if (!gfx) return;
    gfx.clear();
    var w = window.innerWidth, h = window.innerHeight;

    if (screen === "single") {
      var ox = (w - BOARD_PX_W) / 2, oy = (h - BOARD_PX_H) / 2;
      drawOneBoard(gfx, board, current, currentPx, currentPy, ox, oy);
    } else if (screen === "multi_game") {
      var gap = 40;
      var totalW = BOARD_PX_W * 2 + gap;
      var startX = (w - totalW) / 2;
      var oy2 = (h - BOARD_PX_H) / 2;

      drawOneBoard(gfx, board, current, currentPx, currentPy, startX, oy2);

      var oppBoard = opponentState && opponentState.board ? opponentState.board : createEmptyBoard();
      var oppCur = null, oppPx = 0, oppPy = 0;
      if (opponentState) {
        oppPx = opponentState.currentPx != null ? opponentState.currentPx : 0;
        oppPy = opponentState.currentPy != null ? opponentState.currentPy : 0;
        if (opponentState.current && opponentState.current.name)
          oppCur = { name: opponentState.current.name, cells: opponentState.current.cells || [] };
      }
      drawOneBoard(gfx, oppBoard, oppCur, oppPx, oppPy, startX + BOARD_PX_W + gap, oy2);
    }
  }

  var config = {
    type: Phaser.AUTO,
    width: window.innerWidth,
    height: window.innerHeight,
    parent: "gameContainer",
    backgroundColor: "rgba(0,0,0,0)",
    scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: {
      create: function() {
        this.gfx = this.add.graphics();
        drawBoardPhaser(this.gfx);
        this.scale.on("resize", function() { drawBoardPhaser(this.gfx); }, this);
      },
      update: function(time, delta) {
        if (screen !== "single" && screen !== "multi_game") return;
        drawBoardPhaser(this.gfx);

        if (gamePhase !== "playing" || paused || gameOver) return;
        if (!current) return;

        gravityAcc += delta;
        if (gravityAcc >= lastGravityMs) {
          gravityAcc = 0;
          if (collides(board, current, currentPx, currentPy + 1)) lock();
          else currentPy++;
        }
      }
    }
  };

  function initPhaser() {
    if (game) return;
    if (typeof Phaser === "undefined") return;
    game = new Phaser.Game(config);
  }

  // ===================== SOCKET EVENTS =====================
  socket.on("room-created", function(data) {
    roomCode = data.roomCode;
    isHost = true;
    playerCount = 1;
    var lanEl = document.getElementById("lobbyLanUrl");
    var codeEl = document.getElementById("lobbyRoomCode");
    var statusEl = document.getElementById("lobbyStatus");
    if (lanEl) { lanEl.textContent = "On the other device, open: " + (data.lanUrl || "") + " and enter room code:"; lanEl.classList.remove("hidden"); }
    if (codeEl) { codeEl.textContent = data.roomCode; codeEl.classList.remove("hidden"); }
    if (statusEl) statusEl.textContent = "Room created. Waiting for player 2...";
    var btn = document.getElementById("btnStartMulti");
    if (btn) btn.classList.add("hidden");
  });

  socket.on("room-joined", function(data) {
    roomCode = data.roomCode;
    playerCount = data.playerCount || 2;
    var statusEl = document.getElementById("lobbyStatus");
    if (statusEl) statusEl.textContent = "Joined room. " + playerCount + "/2 players.";
  });

  socket.on("room-error", function(data) {
    var statusEl = document.getElementById("lobbyStatus");
    if (statusEl) statusEl.textContent = data.message || "Error";
  });

  socket.on("players-update", function(data) {
    playerCount = data.playerCount || 0;
    var statusEl = document.getElementById("lobbyStatus");
    if (statusEl) statusEl.textContent = playerCount + "/2 players.";
    var btn = document.getElementById("btnStartMulti");
    if (btn && isHost && playerCount >= 2) btn.classList.remove("hidden");
    else if (btn && (!isHost || playerCount < 2)) btn.classList.add("hidden");
  });

  socket.on("game-started", function() {
    document.body.classList.add("in-game");
    initPhaser();
    setScreen("multi_game");
    opponentState = null;
    goToReadyStateMulti();
    startWebcamLazy();

    if (stateBroadcastInterval) clearInterval(stateBroadcastInterval);
    stateBroadcastInterval = setInterval(function() {
      if (screen !== "multi_game" || !roomCode) return;
      socket.emit("state", {
        board: board,
        current: current ? { name: current.name, cells: current.cells } : null,
        currentPx: currentPx, currentPy: currentPy,
        score: score, lines: lines, level: level, gameOver: gameOver
      });
    }, 100);
  });

  socket.on("play-started", function() {
    startGame();
  });

  socket.on("opponent-state", function(payload) {
    opponentState = payload;
  });

  function getActiveHandsOverlay() {
    if (screen === "single") return document.getElementById("handsOverlaySingle");
    if (screen === "multi_game") return document.getElementById("handsOverlayMulti");
    return null;
  }

  function drawLandmarksOnOverlay(multiHandLandmarks, videoEl) {
    var canvas = getActiveHandsOverlay();
    if (!canvas || !videoEl || !multiHandLandmarks || multiHandLandmarks.length === 0) {
      if (canvas) {
        var ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      return;
    }
    var w = canvas.offsetWidth;
    var h = canvas.offsetHeight;
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, w, h);
    var vw = videoEl.videoWidth || 1;
    var vh = videoEl.videoHeight || 1;
    var scaleX = w / vw;
    var scaleY = h / vh;
    ctx.strokeStyle = "#00ffcc";
    ctx.fillStyle = "#00ffcc";
    ctx.lineWidth = 1;
    for (var handIdx = 0; handIdx < multiHandLandmarks.length; handIdx++) {
      var lm = multiHandLandmarks[handIdx];
      if (!lm || !lm.length) continue;
      for (var i = 0; i < lm.length; i++) {
        var x = lm[i].x * vw * scaleX;
        var y = lm[i].y * vh * scaleY;
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      if (typeof window.drawConnectors === "function" && window.MEDIAPIPE_HAND_CONNECTIONS) {
        window.drawConnectors(ctx, lm, window.MEDIAPIPE_HAND_CONNECTIONS, { color: "#00ffcc", lineWidth: 1 });
      }
    }
  }

  // ===================== MENU FLOW =====================
  function goMenu() {
    document.body.classList.remove("in-game");
    gamePhase = "menu";
    setScreen("menu");

    // CRITICAL: don’t kill stream tracks when going back to menu.
    // CV loop can stop, but keep stream alive.
    stopCameraAndCV(false);

    if (stateBroadcastInterval) { clearInterval(stateBroadcastInterval); stateBroadcastInterval = null; }
    roomCode = null; isHost = false; playerCount = 0;
    opponentState = null;
  }

  function startSingle() {
    showScreen("screen-single");
    document.body.classList.add("in-game");
    initPhaser();
    goToReadyState();
    startWebcamLazy();
  }

  function goMultiLobby() {
    showScreen("screen-multi-lobby");
    var st = document.getElementById("lobbyStatus");
    if (st) st.textContent = "";
    var lan = document.getElementById("lobbyLanUrl");
    if (lan) lan.classList.add("hidden");
    var code = document.getElementById("lobbyRoomCode");
    if (code) code.classList.add("hidden");
    var btn = document.getElementById("btnStartMulti");
    if (btn) btn.classList.add("hidden");
  }

  function setupMenuButtons() {
    var btnSingle = document.getElementById("btnSingle");
    var btnMulti = document.getElementById("btnMulti");
    var btnHow = document.getElementById("btnHowToPlay");
    var btnHowClose = document.getElementById("btnHowToPlayClose");
    if (btnSingle) btnSingle.onclick = startSingle;
    if (btnMulti) btnMulti.onclick = goMultiLobby;
    if (btnHow) btnHow.onclick = function() {
      var h = document.getElementById("howToPlayOverlay");
      if (h) h.classList.remove("hidden");
    };
    if (btnHowClose) btnHowClose.onclick = function() {
      var h = document.getElementById("howToPlayOverlay");
      if (h) h.classList.add("hidden");
    };
  }

  function setupSingleButtons() {
    var btnStart = document.getElementById("btnStartSingle");
    var btnPause = document.getElementById("btnPause");
    var btnRestart = document.getElementById("btnRestart");
    var btnExit = document.getElementById("btnExitSingle");
    if (btnStart) btnStart.onclick = startGame;
    if (btnPause) btnPause.onclick = function() {
      if (gameOver) return;
      paused = !paused;
      gamePhase = paused ? "paused" : "playing";
      showPause(paused);
      setPauseLabel();
    };
    if (btnRestart) btnRestart.onclick = goToReadyState;
    if (btnExit) btnExit.onclick = goMenu;
  }

  function setupLobbyButtons() {
    var btnHost = document.getElementById("btnHost");
    var btnJoin = document.getElementById("btnJoin");
    var btnBack = document.getElementById("btnBackLobby");
    var btnStartMulti = document.getElementById("btnStartMulti");
    if (btnHost) btnHost.onclick = function() { socket.emit("create-room"); };
    if (btnJoin) btnJoin.onclick = function() {
      var input = document.getElementById("roomCodeInput");
      var code = input ? input.value.trim().toUpperCase() : "";
      if (code.length >= 4) socket.emit("join-room", code);
      else {
        var st = document.getElementById("lobbyStatus");
        if (st) st.textContent = "Enter a valid room code (4–6 chars).";
      }
    };
    if (btnBack) btnBack.onclick = goMenu;
    if (btnStartMulti) btnStartMulti.onclick = function() { socket.emit("start-game"); };
  }

  function setupMultiGameButtons() {
    var btnStartMulti = document.getElementById("btnStartMultiGame");
    var btnPause = document.getElementById("btnPauseMulti");
    var btnExit = document.getElementById("btnExitMulti");
    if (btnStartMulti) btnStartMulti.onclick = function() {
      if (isHost) socket.emit("start-play");
    };
    if (btnPause) btnPause.onclick = function() {
      if (gameOver) return;
      paused = !paused;
      gamePhase = paused ? "paused" : "playing";
      showPause(paused);
      setPauseLabel();
    };
    if (btnExit) btnExit.onclick = function() {
      if (stateBroadcastInterval) { clearInterval(stateBroadcastInterval); stateBroadcastInterval = null; }
      goMenu();
    };
  }

  var btnResume = document.getElementById("btnResume");
  var btnRestartOverlay = document.getElementById("btnRestartOverlay");
  var btnExitOverlay = document.getElementById("btnExitOverlay");

  if (btnResume) btnResume.onclick = function() {
    paused = false;
    gamePhase = "playing";
    showPause(false);
    setPauseLabel();
  };
  if (btnRestartOverlay) btnRestartOverlay.onclick = function() {
    if (screen === "multi_game") goToReadyStateMulti();
    else goToReadyState();
  };
  if (btnExitOverlay) btnExitOverlay.onclick = goMenu;

  // ===================== KEYBOARD =====================
  document.addEventListener("keydown", function(e) {
    if (e.key === "Escape") {
      var how = document.getElementById("howToPlayOverlay");
      if (how && !how.classList.contains("hidden")) {
        how.classList.add("hidden");
      } else if (screen === "single" || screen === "multi_game") {
        goMenu();
      }
      e.preventDefault();
      return;
    }

    if (screen !== "single" && screen !== "multi_game") return;

    if (e.key === "Enter") {
      if (gamePhase === "ready") {
        if (screen === "multi_game" && !isHost) return;
        startGame();
        e.preventDefault();
      }
      return;
    }

    if (e.key === "p" || e.key === "P") {
      togglePause();
      e.preventDefault();
      return;
    }

    if (e.key === "r" || e.key === "R") {
      if (screen === "multi_game") goToReadyStateMulti();
      else goToReadyState();
      e.preventDefault();
      return;
    }

    if (gamePhase !== "playing" || paused || gameOver) return;

    switch (e.key) {
      case "ArrowLeft": moveLeft(); e.preventDefault(); break;
      case "ArrowRight": moveRight(); e.preventDefault(); break;
      case "ArrowUp": rotateCW(); e.preventDefault(); break;
      case "ArrowDown": softDrop(); e.preventDefault(); break;
      case " ": hardDrop(); e.preventDefault(); break;
    }
  });

  // ===================== CAMERA / CV =====================
  var videoPreview = document.getElementById("webcamPreview");
  var videoPreviewMulti = document.getElementById("webcamPreviewMulti");
  var menuCameraBlocked = document.getElementById("menuCameraBlocked");
  var webcamPanelStatus = document.getElementById("webcamPanelStatus");
  var webcamPanelStatusMulti = document.getElementById("webcamPanelStatusMulti");
  var cameraSelectSingle = document.getElementById("cameraSelectSingle");
  var cameraSelectMulti = document.getElementById("cameraSelectMulti");
  var selectedDeviceId = null;
  var selectedDeviceLabel = "";

  var webcamOk = false;
  var cameraStatus = "unknown";
  var cvFps = 0;
  var cvFpsLastTs = 0;
  var cvFpsFrames = 0;

  var cvManager = {
    stream: null,
    hands: null,
    isRunning: false,
    lastHandSeenMs: 0,
    videoEl: null,
    rafId: 0,
    _tick: null,
    _lastResultsLog: 0
  };

  function getActiveVideoEl() {
    if (screen === "single") return videoPreview;
    if (screen === "multi_game") return videoPreviewMulti;
    return videoPreview || videoPreviewMulti;
  }

  var handsDetectedCount = 0;

  function getActiveDebugEls() {
    if (screen === "single") {
      return {
        status: document.getElementById("webcamDebugStatus"),
        device: document.getElementById("webcamDebugDevice"),
        fps: document.getElementById("webcamDebugFps"),
        hands: document.getElementById("webcamDebugHands")
      };
    }
    return {
      status: document.getElementById("webcamDebugStatusMulti"),
      device: document.getElementById("webcamDebugDeviceMulti"),
      fps: document.getElementById("webcamDebugFpsMulti"),
      hands: document.getElementById("webcamDebugHandsMulti")
    };
  }

  function updateDebugOverlay() {
    var els = getActiveDebugEls();
    if (els.status) els.status.textContent = cameraStatus === "ready" ? "connected" : cameraStatus;
    if (els.device) els.device.textContent = selectedDeviceLabel || "(default)";
    if (els.fps) els.fps.textContent = cvFps + " FPS";
    if (els.hands) els.hands.textContent = "Hands: " + handsDetectedCount;
  }

  function updateCameraStatusUI() {
    if (menuCameraBlocked) {
      if (cameraStatus === "blocked") menuCameraBlocked.classList.remove("hidden");
      else menuCameraBlocked.classList.add("hidden");
    }
    if (webcamPanelStatus) {
      if (cameraStatus === "blocked") webcamPanelStatus.classList.remove("hidden");
      else webcamPanelStatus.classList.add("hidden");
    }
    if (webcamPanelStatusMulti) {
      if (cameraStatus === "blocked") webcamPanelStatusMulti.classList.remove("hidden");
      else webcamPanelStatusMulti.classList.add("hidden");
    }
    updateDebugOverlay();
  }

  function showCameraError(message) {
    console.error("[CV] Camera error:", message);
    cameraStatus = "blocked";
    webcamOk = false;
    if (webcamPanelStatus) {
      webcamPanelStatus.textContent = message || "Camera blocked — keyboard mode enabled";
      webcamPanelStatus.classList.remove("hidden");
    }
    if (webcamPanelStatusMulti) {
      webcamPanelStatusMulti.textContent = message || "Camera blocked — keyboard mode enabled";
      webcamPanelStatusMulti.classList.remove("hidden");
    }
    updateDebugOverlay();
  }

  function isDroidCamLabel(label) {
    return (label || "").toLowerCase().indexOf("droidcam") >= 0;
  }

  function populateCameraSelect(selectEl) {
    if (!selectEl || !navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return Promise.resolve();
    return navigator.mediaDevices.enumerateDevices().then(function(devices) {
      var videoInputs = devices.filter(function(d) { return d.kind === "videoinput"; });
      videoInputs = videoInputs.filter(function(d) { return !isDroidCamLabel(d.label); });
      var savedId = "";
      try { savedId = localStorage.getItem(LOCALSTORAGE_CAMERA_KEY) || ""; } catch (e) {}
      var prevId = selectEl.value || selectedDeviceId || savedId;
      selectEl.innerHTML = "";
      videoInputs.forEach(function(d, i) {
        var opt = document.createElement("option");
        opt.value = d.deviceId;
        opt.textContent = d.label || ("Camera " + (i + 1));
        selectEl.appendChild(opt);
      });
      if (videoInputs.length === 0) {
        var opt = document.createElement("option");
        opt.value = "";
        opt.textContent = "No cameras found";
        selectEl.appendChild(opt);
      } else {
        var wantId = prevId && videoInputs.some(function(d) { return d.deviceId === prevId; }) ? prevId : videoInputs[0].deviceId;
        selectEl.value = wantId;
      }
      return videoInputs;
    }).catch(function(err) {
      console.warn("[CV] enumerateDevices failed:", err);
      return [];
    });
  }

  function requestCamera(deviceId) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      cameraStatus = "blocked";
      webcamOk = false;
      showCameraError("getUserMedia not supported");
      return Promise.resolve(false);
    }

    if (cvManager.stream && cvManager.stream.active) {
      var track = cvManager.stream.getVideoTracks()[0];
      var currentId = track ? track.getSettings().deviceId : null;
      if (!deviceId || currentId === deviceId) {
        if (videoPreview) { videoPreview.srcObject = cvManager.stream; videoPreview.play().catch(function() {}); }
        if (videoPreviewMulti) { videoPreviewMulti.srcObject = cvManager.stream; videoPreviewMulti.play().catch(function() {}); }
        webcamOk = true;
        cameraStatus = "ready";
        updateCameraStatusUI();
        return Promise.resolve(true);
      }
    }

    var constraints = {
      video: deviceId
        ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
        : { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    };

    return navigator.mediaDevices.getUserMedia(constraints).then(function(stream) {
      if (cvManager.stream) {
        cvManager.stream.getTracks().forEach(function(t) { t.stop(); });
        cvManager.stream = null;
      }
      cvManager.stream = stream;
      var track = stream.getVideoTracks()[0];
      selectedDeviceId = track ? track.getSettings().deviceId : null;
      var rawLabel = (track && track.label) ? track.label : "";
      selectedDeviceLabel = isDroidCamLabel(rawLabel) ? "Webcam" : (rawLabel || "Webcam");

      if (videoPreview) { videoPreview.srcObject = stream; videoPreview.play().catch(function(){}); }
      if (videoPreviewMulti) { videoPreviewMulti.srcObject = stream; videoPreviewMulti.play().catch(function(){}); }

      webcamOk = true;
      cameraStatus = "ready";
      try { localStorage.setItem(LOCALSTORAGE_CAMERA_KEY, selectedDeviceId || ""); } catch (e) {}
      updateCameraStatusUI();
      populateCameraSelect(cameraSelectSingle).then(function() { return populateCameraSelect(cameraSelectMulti); });
      return true;
    }).catch(function(err) {
      var msg = (err && err.message) ? err.message : String(err);
      if (err.name === "NotFoundError") msg = "No camera found.";
      else if (err.name === "NotAllowedError") msg = "Camera permission denied.";
      else if (err.name === "NotReadableError") msg = "Camera in use or not readable.";
      showCameraError(msg);
      return false;
    });
  }

  function stopCameraAndCV(stopStreamTracks) {
    if (cvManager.rafId) {
      cancelAnimationFrame(cvManager.rafId);
      cvManager.rafId = 0;
    }
    cvManager._tick = null;
    cvManager.isRunning = false;
    cvManager.videoEl = null;

    // ✅ Only close Hands if we are fully stopping tracks
    if (stopStreamTracks && cvManager.hands && typeof cvManager.hands.close === "function") {
      try { cvManager.hands.close(); } catch (e) {}
      cvManager.hands = null;
    }

    if (stopStreamTracks && cvManager.stream) {
      cvManager.stream.getTracks().forEach(function(t){ t.stop(); });
      cvManager.stream = null;
      selectedDeviceId = null;
      selectedDeviceLabel = "";

      if (videoPreview) videoPreview.srcObject = null;
      if (videoPreviewMulti) videoPreviewMulti.srcObject = null;

      webcamOk = false;
      cameraStatus = "unknown";
      updateCameraStatusUI();
    }
    console.log("[CV] stopped. stopStreamTracks =", !!stopStreamTracks);
  }

  function onCameraSelectChange() {
    var sel = screen === "single" ? cameraSelectSingle : cameraSelectMulti;
    if (!sel) return;
    var devId = sel.value;
    if (devId === "") return;
    requestCamera(devId).then(function(ok) {
      if (ok) {
        var vid = getActiveVideoEl();
        if (vid && vid.srcObject) ensureCVRunning(vid);
      }
    });
  }

  // ===================== GESTURE HELPERS =====================
  function dist(lm, a, b) {
    return Math.hypot(lm[a].x - lm[b].x, lm[a].y - lm[b].y);
  }

  function palmCenter(lm) {
    var x = (lm[0].x + lm[5].x + lm[9].x + lm[13].x + lm[17].x) / 5;
    var y = (lm[0].y + lm[5].y + lm[9].y + lm[13].y + lm[17].y) / 5;
    return { x: x, y: y };
  }

  function wrapDeg(a) {
    while (a > 180) a -= 360;
    while (a < -180) a += 360;
    return a;
  }

  // Palm/wrist roll in degrees using landmarks 0,5,17
  function wristTwistDegrees(lm) {
    var v1x = lm[5].x - lm[0].x, v1y = lm[5].y - lm[0].y;
    var v2x = lm[17].x - lm[0].x, v2y = lm[17].y - lm[0].y;
    var a1 = Math.atan2(v1y, v1x);
    var a2 = Math.atan2(v2y, v2x);
    var deg = (a2 - a1) * 180 / Math.PI;
    return wrapDeg(deg);
  }

  function isOpenPalm(lm) {
    var tipMcp = function(tip, mcp) { return dist(lm, tip, mcp); };
    return tipMcp(8, 5) > OPEN_PALM_TIP_MCP_MIN && tipMcp(12, 9) > OPEN_PALM_TIP_MCP_MIN &&
           tipMcp(16, 13) > OPEN_PALM_TIP_MCP_MIN && tipMcp(20, 17) > OPEN_PALM_TIP_MCP_MIN &&
           tipMcp(4, 2) > OPEN_PALM_TIP_MCP_MIN * 0.8;
  }

  function isVSign(lm) {
    var tipMcp = function(tip, mcp) { return dist(lm, tip, mcp); };
    var indexExtended = tipMcp(8, 5) > OPEN_PALM_TIP_MCP_MIN;
    var middleExtended = tipMcp(12, 9) > OPEN_PALM_TIP_MCP_MIN;
    var ringCurled = tipMcp(16, 13) < OPEN_PALM_TIP_MCP_MIN * 0.9;
    var pinkyCurled = tipMcp(20, 17) < OPEN_PALM_TIP_MCP_MIN * 0.9;
    return indexExtended && middleExtended && ringCurled && pinkyCurled;
  }

  function isPinch(lm) {
    return dist(lm, 4, 8) < GESTURE_CONFIG.pinchThreshold;
  }

  // ===================== GESTURE STATE =====================
  var emaX = 0.5, emaY = 0.5, emaSet = false;
  var currentZone = "NONE";
  var lastMoveMs = 0;

  var twistBaselineDeg = null;
  var twistArmed = true;
  var rotateCooldownUntil = 0;

  var dropHistory = [];
  var softDropHeld = false;
  var softDropHeldUntil = 0;
  var lastSoftDropAt = 0;

  var openPalmPrev = false, openPalmStart = 0, hardDropCooldownUntil = 0;
  var vSignPrev = false, vSignStart = 0, pauseCooldownUntil = 0;
  var pinchPrev = false;

  function resetGestureState() {
    emaSet = false;
    currentZone = "NONE";
    lastMoveMs = 0;

    twistBaselineDeg = null;
    twistArmed = true;
    rotateCooldownUntil = 0;

    dropHistory.length = 0;
    softDropHeld = false;
    softDropHeldUntil = 0;
    lastSoftDropAt = 0;

    openPalmPrev = false; openPalmStart = 0; hardDropCooldownUntil = 0;
    vSignPrev = false; vSignStart = 0; pauseCooldownUntil = 0;
  }

  var twoHandPauseStart = 0;
  var twoHandPauseCooldownUntil = 0;

  // ===================== MEDIAPIPE RESULTS =====================
  function onResults(results) {
    var now = Date.now();
    var landmarks = results.multiHandLandmarks || [];
    handsDetectedCount = landmarks.length;
    drawLandmarksOnOverlay(landmarks, cvManager.videoEl);

    if (!cvManager._lastResultsLog || now - cvManager._lastResultsLog > 1000) {
      cvManager._lastResultsLog = now;
      console.log("[CV] onResults. hands:", handsDetectedCount);
    }

    if (landmarks.length === 0) {
      currentZone = "NONE";
      dropHistory.length = 0;
      softDropHeld = false;
      twistBaselineDeg = null;
      twistArmed = true;
      return;
    }

    cvManager.lastHandSeenMs = now;
    var lm = landmarks[0];
    var palm = palmCenter(lm);

    // --- left/right mapping (invert ONCE here) ---
    var rawX = palm.x;
    var rawY = palm.y;

    // The physical feeling you want is controlled by INVERT_LEFT_RIGHT
    // (we invert the X input once)
    if (INVERT_LEFT_RIGHT) rawX = 1 - rawX;

    if (!emaSet) { emaX = rawX; emaY = rawY; emaSet = true; }
    else {
      emaX = EMA_ALPHA * rawX + (1 - EMA_ALPHA) * emaX;
      emaY = EMA_ALPHA * rawY + (1 - EMA_ALPHA) * emaY;
    }

    var x = emaX;

    // --- 2-zone position move w/ hysteresis ---
    if (currentZone === "LEFT") {
      if (x > LEFT_EXIT) currentZone = "NONE";
      else if (gamePhase === "playing" && !paused && !gameOver) {
        if (now - lastMoveMs >= MOVE_REPEAT_MS || lastMoveMs === 0) {
          moveLeft();
          lastMoveMs = now;
        }
      }
    } else if (currentZone === "RIGHT") {
      if (x < RIGHT_EXIT) currentZone = "NONE";
      else if (gamePhase === "playing" && !paused && !gameOver) {
        if (now - lastMoveMs >= MOVE_REPEAT_MS || lastMoveMs === 0) {
          moveRight();
          lastMoveMs = now;
        }
      }
    } else {
      if (x < LEFT_ENTER) {
        currentZone = "LEFT";
        if (gamePhase === "playing" && !paused && !gameOver) { moveLeft(); lastMoveMs = now; }
      } else if (x > RIGHT_ENTER) {
        currentZone = "RIGHT";
        if (gamePhase === "playing" && !paused && !gameOver) { moveRight(); lastMoveMs = now; }
      }
    }

    // --- wrist twist rotate (0,5,17) ---
    var ang = wristTwistDegrees(lm);
    if (twistBaselineDeg == null) twistBaselineDeg = ang;
    var delta = wrapDeg(ang - twistBaselineDeg);

    // re-arm near baseline
    if (Math.abs(delta) < TWIST_RELEASE_DEG) {
      twistArmed = true;
      twistBaselineDeg = wrapDeg(twistBaselineDeg + 0.05 * wrapDeg(ang - twistBaselineDeg));
    }

    if (twistArmed && now > rotateCooldownUntil && gamePhase === "playing" && !paused && !gameOver) {
      if (delta > TWIST_TRIGGER_DEG) {
        rotateCW();
        rotateCooldownUntil = now + ROTATE_DEBOUNCE_MS;
        twistArmed = false;
        twistBaselineDeg = ang;
      } else if (delta < -TWIST_TRIGGER_DEG) {
        rotateCCW();
        rotateCooldownUntil = now + ROTATE_DEBOUNCE_MS;
        twistArmed = false;
        twistBaselineDeg = ang;
      }
    }

    var pinch = isPinch(lm);
    if (pinch && !pinchPrev && now > rotateCooldownUntil && gamePhase === "playing" && !paused && !gameOver) {
      rotateCW();
      rotateCooldownUntil = now + ROTATE_DEBOUNCE_MS;
    }
    pinchPrev = pinch;

    if (landmarks.length >= 2 && now > twoHandPauseCooldownUntil) {
      var lm1 = landmarks[0], lm2 = landmarks[1];
      if (isOpenPalm(lm1) && isOpenPalm(lm2)) {
        if (twoHandPauseStart === 0) twoHandPauseStart = now;
        if (now - twoHandPauseStart >= GESTURE_CONFIG.twoHandPauseHoldMs) {
          togglePause();
          twoHandPauseCooldownUntil = now + GESTURE_CONFIG.twoHandPauseCooldownMs;
          twoHandPauseStart = 0;
        }
      } else {
        twoHandPauseStart = 0;
      }
    } else {
      twoHandPauseStart = 0;
    }

    // --- wave down => soft drop burst ---
    dropHistory.push({ y: emaY, t: now });
    while (dropHistory.length > 0 && now - dropHistory[0].t > DROP_TIME_MS) dropHistory.shift();

    if (dropHistory.length >= 2) {
      var dy = dropHistory[dropHistory.length - 1].y - dropHistory[0].y;
      if (dy > DROP_DY_THRESHOLD) {
        softDropHeld = true;
        softDropHeldUntil = now + SOFTDROP_HOLD_MS;
      }
    }
    if (now > softDropHeldUntil) softDropHeld = false;

    if (softDropHeld && gamePhase === "playing" && !paused && !gameOver) {
      if (now - lastSoftDropAt >= SOFTDROP_REPEAT_MS) {
        softDrop();
        lastSoftDropAt = now;
      }
    }

    // --- optional gestures ---
    var openPalm = isOpenPalm(lm);
    var vSign = isVSign(lm);

    if (openPalm) {
      if (!openPalmPrev) openPalmStart = now;
      if (now - openPalmStart >= OPEN_PALM_HOLD_MS && now > hardDropCooldownUntil) {
        hardDrop();
        hardDropCooldownUntil = now + HARD_DROP_DEBOUNCE_MS;
        openPalmStart = 0;
      }
    } else openPalmStart = 0;
    openPalmPrev = openPalm;

    if (vSign) {
      if (!vSignPrev) vSignStart = now;
      if (now - vSignStart >= V_SIGN_HOLD_MS && now > pauseCooldownUntil) {
        togglePause();
        pauseCooldownUntil = now + PAUSE_DEBOUNCE_MS;
        vSignStart = 0;
      }
    } else vSignStart = 0;
    vSignPrev = vSign;
  }

  // ===================== CV LOOP (rAF) =====================
  function startCameraAndCV(targetVideoEl) {
    if (!targetVideoEl) return Promise.resolve(false);
    if (!targetVideoEl.srcObject || !targetVideoEl.srcObject.active) return Promise.resolve(false);

    if (!cvManager.hands) {
      if (typeof window.Hands === "undefined") {
        console.error("[CV] window.Hands is undefined. Load MediaPipe Hands script. Using keyboard only.");
        cameraStatus = "ready";
        updateDebugOverlay();
        return Promise.resolve(true);
      }

      var HandsClass = window.Hands;
      var handsInstance = new HandsClass({
        locateFile: function(f) { return "https://cdn.jsdelivr.net/npm/@mediapipe/hands/" + f; }
      });

      handsInstance.setOptions({
        maxNumHands: 1,
        modelComplexity: 1,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
      });

      handsInstance.onResults(onResults);
      cvManager.hands = handsInstance;
      console.log("[CV] Hands created");
    }

    // Cancel previous loop
    if (cvManager.rafId) {
      cancelAnimationFrame(cvManager.rafId);
      cvManager.rafId = 0;
    }

    cvManager.videoEl = targetVideoEl;
    cvManager.isRunning = true;

    console.log("[CV] LOOP STARTED (rAF) on", targetVideoEl.id);

    var lastSendTs = 0;
    var sendInFlight = false;
    var CV_FRAME_MS = 33;

    function tick() {
      if (!cvManager.isRunning || cvManager.videoEl !== targetVideoEl) return;
      cvManager.rafId = requestAnimationFrame(tick);

      if (!targetVideoEl.srcObject || targetVideoEl.readyState < 2) return;

      var now = performance.now();
      cvFpsFrames++;
      if (now - cvFpsLastTs >= 500) {
        cvFps = Math.round(cvFpsFrames * 1000 / (now - cvFpsLastTs));
        cvFpsFrames = 0;
        cvFpsLastTs = now;
        updateDebugOverlay();
      }
      if (now - lastSendTs < CV_FRAME_MS) return;
      if (sendInFlight) return;

      lastSendTs = now;
      sendInFlight = true;

      cvManager.hands.send({ image: targetVideoEl })
        .then(function() { sendInFlight = false; })
        .catch(function(e) {
          sendInFlight = false;
          // Don’t hard fail — CV should keep trying
        });
    }

    cvManager._tick = tick;
    cvManager.rafId = requestAnimationFrame(tick);
    return Promise.resolve(true);
  }

  function getSelectedDeviceId() {
    var sel = screen === "single" ? cameraSelectSingle : cameraSelectMulti;
    if (!sel || !sel.value) return undefined;
    return sel.value === "" ? undefined : sel.value;
  }

  function ensureCVRunning(activeVideoEl) {
    if (!activeVideoEl) return Promise.resolve(false);

    var deviceId = getSelectedDeviceId();
    return requestCamera(deviceId).then(function(ok) {
      if (!ok) return false;

      if (cvManager.isRunning && cvManager.videoEl === activeVideoEl) return true;
      if (!activeVideoEl.srcObject || !activeVideoEl.srcObject.active) return false;

      activeVideoEl.play().catch(function() {});
      return startCameraAndCV(activeVideoEl);
    });
  }

  // ✅ Robust “start and keep retrying” so it can’t silently fail
  function startWebcamLazy() {
    var vid = getActiveVideoEl();
    if (!vid) return;

    function tryStart() {
      ensureCVRunning(vid).then(function(ok) {
        console.log("[CV] ensureCVRunning ->", ok, "readyState:", vid.readyState, "hasStream:", !!vid.srcObject);
        if (ok && vid.srcObject) vid.play().catch(function() {});
        if (!ok || !cvManager.isRunning) setTimeout(tryStart, 500);
      });
    }

    tryStart();
  }

  // ===================== INIT =====================
  function init() {
    // UI tick
    setInterval(function() {
      if (screen === "single" || screen === "multi_game") tickUi();
    }, 100);

    setupMenuButtons();
    setupSingleButtons();
    setupLobbyButtons();
    setupMultiGameButtons();

    showScreen("screen-menu");

    // Start camera early so it’s ready when you enter game screens
    if (cameraSelectSingle) cameraSelectSingle.addEventListener("change", onCameraSelectChange);
    if (cameraSelectMulti) cameraSelectMulti.addEventListener("change", onCameraSelectChange);

    populateCameraSelect(cameraSelectSingle).then(function() {
      return populateCameraSelect(cameraSelectMulti);
    }).then(function() {
      updateCameraStatusUI();
    }).catch(function(err) {
      console.warn("[CV] init:", err);
    });
  }

  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
