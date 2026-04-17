/**
 * @file game.js
 * @description 台球应用程序的核心游戏引擎类。
 * 负责管理游戏循环、状态转换、物理更新、网络同步以及渲染编排。
 */

import {
  TABLE_WIDTH,
  TABLE_HEIGHT,
  BALL_RADIUS,
  POCKET_RADIUS,
  WALL_BOUNCE,
  BALL_BOUNCE,
  TURN_TIME_LIMIT,
  POCKET_SCORE_EFFECT_DURATION,
  PLAYABLE_AREA_INSET,
  HEAD_STRING_X,
  SHOT_POWER_SCALE,
  RELEASE_FLASH_DURATION,
} from './constants.js'
import { Vec2 } from './math.js'
import { Ball } from './entities/ball.js'
import { AudioManager } from './audio/audio-manager.js'
import { getAimGuide, getProjectedTravel } from './core/aim.js'
import { onBallPocketed, updateGamePhysics } from './core/physics.js'
import { applyGroups, evaluateShot, switchTurn } from './core/rules.js'
import { bindGameInput } from './input/bindings.js'
import { isPortraitHeldLandscapeSemanticMobile, isPortraitLayout, shouldRemapGameplayInput, shouldRotateGameplayStage } from './layout/mode.js'
import { PixiRenderer } from './render/pixi-renderer.js'
import { getPocketVisualCenters } from './render/table-renderer.js'
import { updateGameUi, updateTimerUi } from './ui/dom-ui.js'
import { GameClient } from './network/game-client.js'
import { applyStatusSync, createStatusSyncSnapshot } from './network/state-sync.js'

/**
 * 管理所有台球逻辑和状态的主游戏类。
 */
export class BilliardsGame {
  /**
   * 初始化游戏实例，设置渲染器、事件监听和游戏主循环。
   */
  constructor() {
    /** @type {AudioManager} 音频管理器，处理击球和碰撞音效。 */
    this.audio = new AudioManager()
    /** @type {Ball[]} 存储球桌上所有球的数组。 */
    this.balls = []
    /** @type {Object} 玩家得分，键为玩家索引 (1 或 2)。 */
    this.scores = { 1: 0, 2: 0 }
    /** @type {Object} 玩家分配的球组（'solid' 实色或 'stripe' 花色）。 */
    this.playerGroups = { 1: null, 2: null }
    /** @type {number} 当前行动的玩家索引。 */
    this.currentPlayer = 1
    /** @type {boolean} 用户是否正在拖拽球杆准备击球。 */
    this.isDragging = false
    /** @type {Vec2} 当前鼠标或触摸点在逻辑坐标系中的位置。 */
    this.mousePos = new Vec2(0, 0)
    /** @type {boolean} 是否收到了指针（鼠标/触摸）输入。 */
    this.hasPointerInput = false
    /** @type {number} 当前回合剩余时间（秒）。 */
    this.timeLeft = TURN_TIME_LIMIT
    /** @type {number} 上一次更新计时器的时间戳。 */
    this.lastTick = Date.now()
    /** @type {number} 上一次物理更新的时间戳。 */
    this.lastUpdate = Date.now()
    /** @type {number} UI 上显示的倒计时整数。 */
    this.displayedSecond = TURN_TIME_LIMIT
    /** @type {number} 回合到期的时间戳。 */
    this.expireAt = 0
    /** @type {boolean} 计时器是否暂停（例如球在移动时）。 */
    this.timerPaused = false
    /** @type {number} 与服务器的时间偏移量。 */
    this.serverTimeOffset = 0
    /** @type {boolean} 回合是否已被锁定（时间到或击球后）。 */
    this.isTurnLocked = false
    /** @type {number|null} 本地玩家的索引（1 或 2）。 */
    this.playerIndex = null
    /** @type {number} 当前瞄准的角度（弧度）。 */
    this.aimAngle = 0
    /** @type {number} 球杆向后拉动的距离（像素）。 */
    this.pullDistance = 0
    /** @type {number} 击球后闪光效果的剩余时间。 */
    this.releaseFlash = 0
    /** @type {string} 当前状态提示消息内容。 */
    this.statusMessage = ''
    /** @type {number} 状态消息消失的时间戳。 */
    this.statusUntil = 0
    /** @type {number|null} 提示消息的定时器引用。 */
    this.toastTimer = null
    /** @type {boolean} 是否显示远程对手的瞄准辅助线。 */
    this.showRemoteCue = false
    /** @type {boolean} 是否处于“白球在手”状态（自由放置母球）。 */
    this.ballInHand = false
    /** @type {string} “白球在手”的可放置区域（'table' 全场或 'kitchen' 开球区）。 */
    this.ballInHandZone = 'table'
    /** @type {boolean} 是否需要限制在开球区击向指定方向（特定开球规则）。 */
    this.requiresKitchenBreakDirection = false
    /** @type {boolean} 是否正在移动放置母球。 */
    this.placingCue = false
    /** @type {boolean} 当前母球放置位置是否合法。 */
    this.cuePlacementValid = true
    /** @type {Vec2|null} 母球上一个合法的放置位置。 */
    this.lastValidCuePosition = null
    /** @type {Array} 进球得分动画效果数组。 */
    this.scorePocketEffects = []
    /** @type {Array} 碰撞视觉效果数组。 */
    this.collisionEffects = []
    /** @type {boolean} 当前是否为开球击球。 */
    this.isBreakShot = true
    /** @type {boolean} 当前是否有击球动作正在进行（球在运动或规则评估中）。 */
    this.shotActive = false
    /** @type {Object|null} 记录当前击球的结果状态，用于评估规则。 */
    this.shotState = null

    /** @type {Vec2[]} 球桌六个球袋的中心坐标位置。 */
    this.pockets = getPocketVisualCenters()
    
    /** @type {PixiRenderer} 基于 Pixi.js 的渲染引擎实例。 */
    this.renderer = new PixiRenderer(this)
    /** @type {HTMLCanvasElement} 游戏渲染的 Canvas 画布元素。 */
    this.canvas = this.renderer.app.view

    window.addEventListener('resize', () => this.resize())
    this.resize(); this.init(); this.bindEvents(); this.loop()
  }

  /**
   * 重新计算视口缩放并调整渲染器尺寸，以适配不同的屏幕和布局模式。
   */
  resize() {
    const container = document.getElementById('game-container')
    const containerStyle = container ? window.getComputedStyle(container) : null
    const containerPaddingX = containerStyle
      ? (parseFloat(containerStyle.paddingLeft) || 0) + (parseFloat(containerStyle.paddingRight) || 0)
      : 0
    const containerPaddingY = containerStyle
      ? (parseFloat(containerStyle.paddingTop) || 0) + (parseFloat(containerStyle.paddingBottom) || 0)
      : 0

    const layoutWidth = container?.clientWidth ?? window.innerWidth
    const layoutHeight = container?.clientHeight ?? window.innerHeight

    const availableWidth = Math.max(0, layoutWidth - containerPaddingX);
    const availableHeight = Math.max(0, layoutHeight - containerPaddingY);
    const dpr = window.devicePixelRatio || 1;
    const isPortrait = shouldRotateGameplayStage(document, window);
    const body = document.body
    const isSemanticMobileGameplay = body?.classList.contains('layout-landscape')
      && body?.classList.contains('pointer-coarse')
    const baseWidth = isPortrait ? TABLE_HEIGHT : TABLE_WIDTH;
    const baseHeight = isPortrait ? TABLE_WIDTH : TABLE_HEIGHT;

    const railVisualPx = Math.max(10, Math.min(Math.min(availableWidth, availableHeight) * 0.026, 18))
    const semanticGameplayInset = isSemanticMobileGameplay
      ? Math.max(1, Math.min(Math.min(availableWidth, availableHeight) * 0.002, 3))
      : null
    const uiPaddingX = isSemanticMobileGameplay
      ? railVisualPx * 1.45 + semanticGameplayInset
      : (isPortrait ? 20 : 220)
    const uiPaddingY = isSemanticMobileGameplay
      ? railVisualPx * 1.15 + semanticGameplayInset
      : (isPortrait ? 180 : 20)

    const usableWidth = availableWidth - uiPaddingX;
    const usableHeight = availableHeight - uiPaddingY;
    
    const fittedScale = Math.min(usableWidth / baseWidth, usableHeight / baseHeight);
    
    this.viewScale = fittedScale;
    this.renderScale = fittedScale * dpr;

    this.renderer.resize(availableWidth, availableHeight, dpr, fittedScale, isPortrait, railVisualPx);

    if (new URLSearchParams(window.location.search).get('hideTopView') === '1') {
        const ui = document.getElementById('ui-layer');
        if (ui) ui.classList.add('hidden');
    }
  }

  /**
   * 重置游戏状态并将台球摆放在初始开球位置。
   */
  init() {
    this.balls = []; this.scores = { 1: 0, 2: 0 }; this.playerGroups = { 1: null, 2: null }
    this.isGameOver = false; this.currentPlayer = 1; this.timeLeft = TURN_TIME_LIMIT
    this.lastTick = Date.now(); this.lastUpdate = Date.now(); this.displayedSecond = TURN_TIME_LIMIT
    this.timerPaused = false
    this.playerIndex = GameClient.playerIndex || null
    this.hasPointerInput = false
    this.ballInHand = false; this.ballInHandZone = 'table'; this.requiresKitchenBreakDirection = false; this.placingCue = false; this.cuePlacementValid = true; this.lastValidCuePosition = null
    this.scorePocketEffects = []
    this.collisionEffects = []
    this.showRemoteCue = false
    this.isBreakShot = true; this.shotActive = false; this.statusMessage = ''; this.statusUntil = 0
    document.getElementById('game-over').classList.add('hidden')
    this.cueBall = new Ball(-TABLE_WIDTH / 4, 0, 'white', 'cue'); this.balls.push(this.cueBall)
    this.aimAngle = 0
    
    // 标准 8 号球摆放顺序
    const rackOrder = [1, 9, 2, 10, 8, 3, 11, 4, 12, 5, 7, 13, 6, 14, 15];
    const colors = { 1: '#facc15', 9: '#facc15', 2: '#2563eb', 10: '#2563eb', 3: '#dc2626', 11: '#dc2626', 4: '#6d28d9', 12: '#6d28d9', 5: '#f97316', 13: '#f97316', 6: '#16a34a', 14: '#16a34a', 7: '#7f1d1d', 15: '#7f1d1d', 8: '#000000' };

    let idx = 0;
    for (let r = 0; r < 5; r++) {
      for (let s = 0; s <= r; s++) {
        const ballNum = rackOrder[idx];
        let type = ballNum === 8 ? 'eight' : (ballNum > 8 ? 'stripe' : 'solid');
        this.balls.push(new Ball(TABLE_WIDTH / 4 + r * BALL_RADIUS * 2.1 * 0.86, (s - r / 2) * BALL_RADIUS * 2.1, colors[ballNum], type, ballNum.toString()));
        idx++;
      }
    }
    this.resetShotState()
    this.updateUI()
  }

  /**
   * 绑定用户输入事件（鼠标、触摸、键盘）。
   */
  bindEvents() {
    bindGameInput(this)
  }

  /**
   * 更新相对于逻辑坐标系的鼠标位置。
   * @param {MouseEvent|TouchEvent} e - 原始输入事件。
   */
  updatePos(e, intent = 'aim') {
    this.hasPointerInput = true
    const rect = this.canvas.getBoundingClientRect()
    const localX = (e.clientX - rect.left - rect.width / 2) / this.viewScale
    const localY = (e.clientY - rect.top - rect.height / 2) / this.viewScale
    const portraitHeldSemanticMobile = isPortraitHeldLandscapeSemanticMobile(document)
    const shouldRemapInput = shouldRemapGameplayInput(document, window)

    // Portrait-held phones still render a landscape-semantic room shell.
    // Cue aiming should follow the visible landscape axis, while direct
    // object manipulation (ball-in-hand placement) should keep following
    // the finger path on screen.
    if (portraitHeldSemanticMobile && (intent === 'aim' || intent === 'placement')) {
      this.mousePos.x = localY
      this.mousePos.y = -localX
      return
    }

    if (!shouldRemapInput) {
      this.mousePos.x = localX
      this.mousePos.y = localY
      return
    }
    this.mousePos.x = localX
    this.mousePos.y = localY
  }

  /**
   * 检查球桌上是否有任何球正在移动。
   * @returns {boolean} 如果有任何球的速度高于阈值，则返回 true。
   */
  isMoving() { return this.balls.some(b => !b.pocketed && b.vel.length() > 0.05) }

  /**
   * 处理来自远程对手的瞄准同步。
   * @param {number} aimAngle - 对手的瞄准角度（弧度）。
   * @param {number} pullDistance - 对手的球杆拉动距离。
   */
  handleRemoteAim(aimAngle, pullDistance) {
    this.showRemoteCue = true
    this.aimAngle = aimAngle;
    this.pullDistance = pullDistance;
  }

  /**
   * 执行来自网络同步的远程击球事件。
   * @param {number} aimAngle - 击球角度（弧度）。
   * @param {number} powerRatio - 归一化的击球力度 (0-1)。
   */
  executeRemoteShoot(aimAngle, powerRatio) {
    this.showRemoteCue = false
    const aimDir = new Vec2(Math.cos(aimAngle), Math.sin(aimAngle))
    const speed = 4 + Math.pow(powerRatio, 1.35) * 34
    this.cueBall.vel = aimDir.mul(speed * SHOT_POWER_SCALE * 7.2)
    this.ballPocketedThisTurn = false
    this.releaseFlash = RELEASE_FLASH_DURATION
    this.requiresKitchenBreakDirection = false
    this.audio.playShot(powerRatio)
    this.pullDistance = 0
    this.beginShot()
  }

  /**
   * 创建当前游戏状态的快照以便进行网络同步。
   * @returns {Object} 游戏状态快照对象。
   */
  getGameStateSnapshot() {
    return {
      balls: this.balls.map(b => ({ type: b.type, label: b.label, x: b.pos.x, y: b.pos.y, vx: b.vel.x, vy: b.vel.y, rot: Array.from(b.rotMat), pocketed: b.pocketed })),
      currentPlayer: this.currentPlayer, timeLeft: this.timeLeft, ballInHand: this.ballInHand, ballInHandZone: this.ballInHandZone, playerGroups: { ...this.playerGroups }, scores: { ...this.scores }, isBreakShot: this.isBreakShot, ...createStatusSyncSnapshot(this),
    }
  }

  /**
   * 使用服务器的权威时间戳同步回合计时器。
   * @param {number} startTime - 回合开始时间戳。
   * @param {number} expireAt - 回合过期时间戳。
   * @param {number} serverTime - 当前服务器时间，用于计算偏移量。
   */
  syncTimer(startTime, expireAt, serverTime) {
    if (expireAt > 0 && serverTime) {
        this.expireAt = expireAt;
        this.timerPaused = false;
        this.serverTimeOffset = serverTime - Date.now();
        this.isTurnLocked = false;
        this.timeLeft = Math.max(0, (expireAt - (Date.now() + this.serverTimeOffset)) / 1000);
    } else {
        this.expireAt = 0;
        this.timerPaused = (expireAt === 0);
    }
    this.lastTick = Date.now();
  }

  /**
   * 应用从网络接收到的游戏状态快照。
   * @param {Object} snapshot - 要应用的状态快照。
   */
  applyGameStateSnapshot(snapshot) {
    const rawBallState = snapshot.ballState || snapshot.balls || (snapshot.room && snapshot.room.ballState);
    const ballsToApply = Array.isArray(rawBallState) ? rawBallState : rawBallState?.balls;
    if (!ballsToApply || !Array.isArray(ballsToApply)) return;

    const isServerSync = snapshot.room !== undefined;
    const isLive = snapshot.isLive === true || isServerSync;

    ballsToApply.forEach(s => {
      const ball = this.balls.find(b => b.type === s.type && b.label === s.label)
      if (ball) {
        if (isLive) {
            // 手机端优化：更小的权重 (0.15) 让高频同步纠偏极其平滑
            const weight = isServerSync ? 0.2 : 0.15; 
            ball.pos.x = ball.pos.x * (1 - weight) + s.x * weight;
            ball.pos.y = ball.pos.y * (1 - weight) + s.y * weight;
            if (s.vx !== undefined && (Math.abs(s.vx) > 0.05 || Math.abs(s.vy) > 0.05)) {
                ball.vel.x = ball.vel.x * 0.8 + s.vx * 0.2;
                ball.vel.y = ball.vel.y * 0.8 + s.vy * 0.2;
            }
            if (s.rot && s.rot.length === 9) ball.rotMat.set(s.rot);
            ball.pocketed = s.pocketed;
        } else {
            ball.pos.x = s.x; ball.pos.y = s.y; ball.pocketed = s.pocketed; ball.vel = new Vec2(0, 0);
            if (s.rot) ball.rotMat.set(s.rot);
        }
      }
    })

    if (isLive && !snapshot.forceBusinessUpdate) return;
    const room = snapshot.room || snapshot;
    if (room.currentPlayer !== undefined) this.currentPlayer = room.currentPlayer
    if (room.ballInHand !== undefined) this.ballInHand = room.ballInHand
    this.playerGroups = room.playerGroups || this.playerGroups;
    this.scores = room.scores || this.scores;
    this.isBreakShot = room.isBreakShot !== undefined ? room.isBreakShot : this.isBreakShot;
    this.showRemoteCue = false; this.shotActive = false;
    applyStatusSync(this, room); this.updateUI();
  }

  /**
   * 重置用于在击球后评估规则的临时击球状态。
   */
  resetShotState() {
    this.shotState = { firstContact: null, pocketedBalls: [], cuePocketed: false, eightPocketed: false, railContacts: 0, playerGroupBefore: this.playerGroups[this.currentPlayer], remainingGroupBefore: this.getRemainingBallsForPlayer(this.currentPlayer) };
  }

  /**
   * 标记击球开始，锁定瞄准并启动物理模拟。
   */
  beginShot() { this.shotActive = true; this.resetShotState(); }

  /**
   * 计算指定玩家在球桌上剩余的球数。
   * @param {number} player - 玩家索引 (1 或 2)。
   * @returns {number} 剩余球的数量。
   */
  getRemainingBallsForPlayer(player) {
    const group = this.playerGroups[player];
    return group ? this.balls.filter(ball => ball.type === group && !ball.pocketed).length : 0;
  }

  /**
   * 确定当前玩家必须首先触碰的合法球类型。
   * @returns {string|null} 合法球类型（'solid', 'stripe', 'eight' 或 null 如果桌面上球组未定）。
   */
  getLegalFirstTargetType() {
    const group = this.playerGroups[this.currentPlayer];
    return group ? (this.getRemainingBallsForPlayer(this.currentPlayer) === 0 ? 'eight' : group) : null;
  }

  /**
   * 检查指定位置是否合法，以便放置母球（白球在手）。
   * @param {Vec2} position - 提议放置的坐标。
   * @returns {boolean} 如果位置在范围内且不与其他球重叠，则返回 true。
   */
  isCuePlacementLegal(position) {
    const hw = TABLE_WIDTH / 2 - PLAYABLE_AREA_INSET, hh = TABLE_HEIGHT / 2 - PLAYABLE_AREA_INSET;
    if (position.x < -hw || position.x > hw || position.y < -hh || position.y > hh) return false;
    if (this.ballInHandZone === 'kitchen' && position.x > HEAD_STRING_X) return false;
    return !this.balls.some(ball => ball !== this.cueBall && !ball.pocketed && Vec2.distance(ball.pos, position) < BALL_RADIUS * 2 + 2);
  }

  /**
   * 尝试在当前鼠标位置放置母球。
   */
  tryPlaceCueBall() {
    const hw = TABLE_WIDTH / 2 - PLAYABLE_AREA_INSET, hh = TABLE_HEIGHT / 2 - PLAYABLE_AREA_INSET;
    const clampedXMax = this.ballInHandZone === 'kitchen' ? HEAD_STRING_X : hw;
    const next = new Vec2(Math.max(-hw, Math.min(clampedXMax, this.mousePos.x)), Math.max(-hh, Math.min(hh, this.mousePos.y)));
    this.cueBall.vel = new Vec2(0, 0); this.cueBall.pocketed = false;
    if (this.cuePlacementValid = this.isCuePlacementLegal(next)) { this.cueBall.pos = next; this.lastValidCuePosition = next.clone(); }
    else if (this.lastValidCuePosition) this.cueBall.pos = this.lastValidCuePosition.clone();
    else this.cueBall.pos = next;
  }

  /**
   * 在 UI 中显示临时的提示消息（Toast）。
   * @param {string} msg - 消息文本。
   * @param {number} [duration=1800] - 持续时间（毫秒）。
   */
  setStatusMessage(msg, duration = 1800) {
    this.statusMessage = msg; this.statusUntil = Date.now() + duration;
    const toast = document.getElementById('toast-message');
    if (toast) {
      if (this.toastTimer) clearTimeout(this.toastTimer);
      toast.innerText = msg; toast.classList.remove('hidden'); toast.classList.add('show');
      this.toastTimer = setTimeout(() => { toast.classList.remove('show'); toast.classList.add('hidden'); }, duration);
    }
  }

  /**
   * 获取当前要显示的提示文本（例如：玩家的回合或白球在手的操作说明）。
   * @returns {string} 状态文本。
   */
  getStatusText() {
    if (this.statusMessage && Date.now() < this.statusUntil) return this.statusMessage;
    return this.ballInHand ? (this.ballInHandZone === 'kitchen' ? '白球在手，请在线后摆球' : `白球在手，轮到玩家${this.currentPlayer}`) : `轮到玩家${this.currentPlayer}击球`;
  }

  /**
   * 汇总当前击球的结果（进球情况）。
   * @returns {Object} 进球汇总。
   */
  getCurrentShotSummary() {
    return { ownPocketed: this.shotState.pocketedBalls.filter(ball => ball.type === this.playerGroups[this.currentPlayer]).length, coloredPocketed: this.shotState.pocketedBalls.filter(ball => ball.type === 'solid' || ball.type === 'stripe') };
  }

  /**
   * 当球入袋时，在球袋处生成视觉动画效果。
   * @param {Vec2} pos - 球袋位置。
   */
  spawnPocketScoreEffect(pos) {
    if (pos) this.scorePocketEffects.push({ pos: pos.clone(), age: 0, duration: POCKET_SCORE_EFFECT_DURATION, sparks: Array.from({ length: 12 }, (_, i) => ({ angle: (Math.PI * 2 * i) / 12 + (i % 2) * 0.12, speed: 12 + (i % 4) * 4, radius: 1.8 + (i % 3) * 0.7 })) });
  }

  /** @ignore 规则模块代理方法 */
  applyGroups(group) { applyGroups(this, group); }
  /** @ignore 规则模块代理方法 */
  switchTurn(wb = false, zone = 'table') { switchTurn(this, wb, zone); }
  /** @ignore 规则模块代理方法 */
  evaluateShot() { const wasMyTurn = GameClient.isMyTurn; evaluateShot(this); if (!this.isMoving() && !this.shotActive && wasMyTurn) GameClient.sendSync(this.getGameStateSnapshot()); }

  /**
   * 每帧调用的主逻辑更新。处理物理、计时器和同步逻辑。
   */
  update() {
    const now = Date.now();
    const dt = Math.min(2.0, (now - this.lastUpdate) / 16.66);
    this.lastUpdate = now;

    updateGamePhysics(this, dt);
    
    if (!this.isGameOver) {
        if (this.timerPaused) {} 
        else if (this.expireAt && this.serverTimeOffset !== undefined) {
            const remaining = this.expireAt - (Date.now() + this.serverTimeOffset);
            this.timeLeft = Math.max(0, remaining / 1000);
            if (remaining <= 0 && !this.isTurnLocked && !this.isMoving() && !this.shotActive) { this.isTurnLocked = true; this.isDragging = false; this.pullDistance = 0; this.updateUI(); if (GameClient.isMyTurn) this.setStatusMessage("时间到，回合结束", 2000); }
        } else if (!this.isMoving() && !this.shotActive) {
            const dtSec = (now - this.lastTick) / 1000;
            this.timeLeft = Math.max(0, this.timeLeft - dtSec);
        }
        const shouldHideTimer = this.timerPaused || (GameClient.isMyTurn && (this.isMoving() || this.shotActive));
        this.displayedSecond = shouldHideTimer ? -1 : Math.ceil(this.timeLeft);
        this.updateTimerUI();
    }
    this.lastTick = now;
    this.collisionEffects = this.collisionEffects.map(e => ({ ...e, age: e.age + 1 })).filter(e => e.age < 15);

    if (this.isMoving() && GameClient.isMyTurn) {
        if (++this.syncCounter % 2 === 0) GameClient.sendSync({ balls: this.balls.map(b => ({ type: b.type, label: b.label, x: b.pos.x, y: b.pos.y, rot: Array.from(b.rotMat), pocketed: b.pocketed, vx: b.vel.x, vy: b.vel.y })), isLive: true });
    } else this.syncCounter = 0;

    if (GameClient.isMyTurn && this.ballInHand && this.placingCue) {
        if (++this.placementSyncCounter % 2 === 0) { const snap = this.getGameStateSnapshot(); snap.isLive = true; GameClient.sendSync(snap); }
    } else this.placementSyncCounter = 0;

    if (GameClient.isMyTurn && !this.ballInHand && !this.isMoving() && (this.isDragging || this.hasPointerInput)) {
        if (++this.aimSyncCounter % 2 === 0) GameClient.sendAim({ aimAngle: this.aimAngle, pullDistance: this.isDragging ? this.pullDistance : 0 });
        this.updateUI();
    } else if (this.showRemoteCue) this.updateUI();
    else this.aimSyncCounter = 0;
  }

  /**
   * 当球进入球袋时触发的回调。
   * @param {Ball} ball - 进球。
   * @param {Vec2} pos - 球袋中心坐标。
   */
  onBallPocketed(ball, pos) { onBallPocketed(this, ball, pos); }

  /**
   * 刷新基于 DOM 的 UI 层。
   */
  updateUI() { this.playerIndex = GameClient.playerIndex || this.playerIndex; if (GameClient.playerIndex) GameClient.isMyTurn = (this.currentPlayer === GameClient.playerIndex); updateGameUi(this); }

  /**
   * 刷新回合倒计时 UI。
   */
  updateTimerUI() { updateTimerUi(this); }

  /**
   * 获取用于瞄准的视觉辅助数据。
   * @param {Vec2} dir - 归一化的瞄准方向。
   * @returns {Object} 瞄准引导参数。
   */
  getAimGuide(dir) { return getAimGuide(this.cueBall, this.balls, dir); }

  /**
   * 预测球的行进路径（射线投射）。
   * @param {Vec2} start - 起始坐标。
   * @param {Vec2} dir - 归一化的方向。
   * @param {number} [limit=220] - 最大投射距离。
   * @returns {Vec2} 预测路径的终点。
   */
  getProjectedTravel(start, dir, limit = 220) { return getProjectedTravel(start, dir, limit); }

  /**
   * 结束游戏并显示获胜者。
   * @param {number} winner - 获胜玩家的索引 (1 或 2)。
   */
  endGame(winner) {
    this.isGameOver = true; this.ballInHand = false; this.placingCue = false; this.audio.playWin();
    const gameOverEl = document.getElementById('game-over'), winnerTextEl = document.getElementById('winner-text');
    if (gameOverEl) gameOverEl.classList.remove('hidden');
    if (winnerTextEl) { const pid = this.playerIdByNumber?.[winner]; winnerTextEl.innerText = `${pid ? GameClient.playerNames?.[pid] : `玩家 ${winner}`} 获胜！`; }
  }

  /**
   * 通过 Pixi.js 渲染当前帧。
   */
  draw() { this.renderer.render(this); }

  /**
   * 使用 requestAnimationFrame 的持续游戏循环。
   */
  loop() { this.update(); this.draw(); requestAnimationFrame(() => this.loop()); }
}

/**
 * 引导并启动一个新的台球游戏实例。
 * @returns {BilliardsGame} 初始化后的游戏实例。
 */
export function bootstrapGame() { return new BilliardsGame(); }
