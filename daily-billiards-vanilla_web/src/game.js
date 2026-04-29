/**
 * @file game.js
 * @description 台球应用程序的核心游戏引擎类。
 * 负责管理游戏循环、状态转换、物理更新、网络同步以及渲染编排。
 */

import {
  TABLE_WIDTH,
  TABLE_HEIGHT,
  BALL_RADIUS,
  FIXED_TIMESTEP_MS,
  POCKET_RADIUS,
  WALL_BOUNCE,
  BALL_BOUNCE,
  TURN_TIME_LIMIT,
  MAX_PHYSICS_STEPS_PER_FRAME,
  POCKET_SCORE_EFFECT_DURATION,
  PLAYABLE_AREA_INSET,
  HEAD_STRING_X,
  SHOT_POWER_SCALE,
  RELEASE_FLASH_DURATION,
} from './constants.js?v=20260429-room-entry-fix'
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
import { buildSettledSnapshotPayload, createShotEndReport, snapshotStateFromRoomPayload } from './network/shot-state.js'

const DEBUG_JITTER = typeof window !== 'undefined' && window.location.hash.includes('debug-jitter')

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
    /** @type {number} 固定步长物理累积器（毫秒）。 */
    this.physicsAccumulatorMs = 0
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
    /** @type {number} 当前服务端回合序号。 */
    this.turnId = 1
    /** @type {number} 当前稳定桌面版本。 */
    this.stateVersion = 1
    /** @type {string|null} 当前回合的一次性出杆令牌。 */
    this.shotToken = null
    /** @type {string} 当前房间阶段。 */
    this.roomPhase = 'WAITING'
    /** @type {string} 最近一次稳定桌面的归一化哈希。 */
    this.stateHash = ''
    /** @type {Object|null} 最近一次稳定桌面快照。 */
    this.lastSettledSnapshot = null
    /** @type {Object|null} 本地乐观出杆的待确认输入。 */
    this.pendingShotRequest = null
    /** @type {boolean} 当前是否正在等待服务端结算本杆。 */
    this.awaitingShotResult = false
    /** @type {string|null} 最近一次已执行的击球 ID，用于避免重复重放。 */
    this.lastAppliedShotId = null
    /** @type {number} 最近一次已知击球的启动时间。 */
    this.lastKnownShotStartedAt = 0
    /** @type {string|null} 最近一次已知击球的发起玩家 ID。 */
    this.lastKnownShotPlayerId = null
    /** @type {string|null} 最近一次已知击球的协议标签。 */
    this.lastKnownShotProtocol = null
    /** @type {boolean} 重连恢复时是否仍在等待 settled 对账。 */
    this.awaitingSettledSync = false
    /** @type {string|null} 最近一次已知 settled 结果签名。 */
    this.lastSettledSignature = null

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
    this.physicsAccumulatorMs = 0
    this.timerPaused = false
    this.playerIndex = GameClient.playerIndex || null
    this.hasPointerInput = false
    this.ballInHand = false; this.ballInHandZone = 'table'; this.requiresKitchenBreakDirection = false; this.placingCue = false; this.cuePlacementValid = true; this.lastValidCuePosition = null
    this.scorePocketEffects = []
    this.collisionEffects = []
    this.showRemoteCue = false
    this.isBreakShot = true; this.shotActive = false; this.statusMessage = ''; this.statusUntil = 0
    this.lastAppliedShotId = null
    this.lastKnownShotStartedAt = 0
    this.lastKnownShotPlayerId = null
    this.lastKnownShotProtocol = null
    this.awaitingSettledSync = false
    this.lastSettledSignature = null
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
    this.commitSettledSnapshot()
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
  isMoving() { return this.balls.some(b => !b.pocketed && b.vel.length() > 0.01) }

  /**
   * 检查渲染层是否仍在追赶物理层。
   * 用于避免“逻辑上已停球，但画面还在滑动”时过早重新显示球杆。
   * @returns {boolean} 是否存在可见的渲染追赶。
   */
  hasVisualMotion() {
    return this.balls.some(ball => {
      if (ball.pocketed) return false
      const physicsPos = ball.physicsPos || ball.pos
      const renderPos = ball.renderPos || physicsPos
      return Math.hypot(physicsPos.x - renderPos.x, physicsPos.y - renderPos.y) > 0.35
    })
  }

  /**
   * 根据快照判断该局是否仍处于球体运动中。
   * @param {Object|null|undefined} snapshot - 房间或同步快照。
   * @returns {boolean} 是否检测到显著运动。
   */
  hasSnapshotMotion(snapshot) {
    const rawBallState = snapshot?.ballState || snapshot?.balls || (snapshot?.room && snapshot.room.ballState)
    const balls = Array.isArray(rawBallState) ? rawBallState : rawBallState?.balls
    if (!Array.isArray(balls)) return false
    return balls.some(ball => {
      if (ball?.pocketed) return false
      const vx = Number(ball?.vx || 0)
      const vy = Number(ball?.vy || 0)
      return Math.abs(vx) > 0.05 || Math.abs(vy) > 0.05
    })
  }

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
   * 生成可在多端重放的击球初始条件。
   * @param {number} powerRatio - 归一化击球力度。
   * @returns {Object} 击球启动载荷。
   */
  createShotStartData(powerRatio) {
    return {
      protocol: 'shot-start-v1',
      shotId: `shot_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`,
      aimAngle: this.aimAngle,
      powerRatio,
      cueBallX: this.cueBall.pos.x,
      cueBallY: this.cueBall.pos.y,
      startedAt: Date.now(),
      randomSeed: null,
    }
  }

  /**
   * 按给定的击球初始条件启动本地物理模拟。
   * 本地玩家与远程重放都走同一套入口，避免两套逻辑渐行渐远。
   * @param {Object} shotData - 击球启动载荷。
   * @param {Object} [options] - 额外控制项。
   * @param {boolean} [options.remote=false] - 是否为远程重放。
   * @returns {boolean} 是否成功启动本次击球。
   */
  applyShotStart(shotData, { remote = false } = {}) {
    if (DEBUG_JITTER) console.log(`[ShotDebug] applyShotStart: remote=${remote}, shotId=${shotData?.shotId}, aimAngle=${shotData?.aimAngle}`);
    if (!shotData || typeof shotData !== 'object') {
      if (DEBUG_JITTER) console.error('[ShotDebug] Invalid shotData object:', shotData);
      return false
    }
    const { shotId = null, aimAngle, powerRatio, cueBallX, cueBallY } = shotData
    if (!Number.isFinite(aimAngle) || !Number.isFinite(powerRatio)) {
      if (DEBUG_JITTER) console.error('[ShotDebug] Invalid aimAngle or powerRatio:', aimAngle, powerRatio);
      return false
    }
    if (remote && shotId && shotId === this.lastAppliedShotId) {
      if (DEBUG_JITTER) console.warn('[ShotDebug] Ignoring duplicate shotId:', shotId);
      return false
    }

    const safePowerRatio = Math.max(0, Math.min(1, powerRatio))
    this.showRemoteCue = false
    this.aimAngle = aimAngle
    this.isDragging = false
    this.pullDistance = 0

    if (Number.isFinite(cueBallX) && Number.isFinite(cueBallY)) {
      this.cueBall.pos = new Vec2(cueBallX, cueBallY)
    }

    const aimDir = new Vec2(Math.cos(aimAngle), Math.sin(aimAngle))
    const speed = 4 + Math.pow(safePowerRatio, 1.35) * 34
    this.cueBall.vel = aimDir.mul(speed * SHOT_POWER_SCALE * 7.2)
    if (DEBUG_JITTER) console.log(`[ShotDebug] Launching cue ball: vel=${this.cueBall.vel.x.toFixed(2)}, ${this.cueBall.vel.y.toFixed(2)}`);
    this.ballPocketedThisTurn = false
    this.releaseFlash = RELEASE_FLASH_DURATION
    this.requiresKitchenBreakDirection = false
    this.audio.playShot(safePowerRatio)
    this.beginShot()
    this.lastAppliedShotId = shotId
    this.lastKnownShotStartedAt = Number.isFinite(shotData.startedAt) ? shotData.startedAt : this.lastKnownShotStartedAt
    this.lastKnownShotPlayerId = remote ? this.playerIdByNumber?.[this.currentPlayer] || this.lastKnownShotPlayerId : GameClient.playerId
    this.lastKnownShotProtocol = typeof shotData.protocol === 'string' ? shotData.protocol : this.lastKnownShotProtocol
    return true
  }

  /**
   * 在本地已经乐观起杆后，补写服务端确认下来的权威击球元数据。
   * 这样 shooter 端也能拿到 shotId / startedAt，后续 settled 对账才不会丢上下文。
   * @param {Object} shotData - 服务端确认后的击球载荷。
   */
  reconcileAcceptedShot(shotData) {
    if (!shotData || typeof shotData !== 'object') return
    if (typeof shotData.shotId === 'string' && shotData.shotId) {
      this.lastAppliedShotId = shotData.shotId
    }
    if (Number.isFinite(shotData.startedAt)) {
      this.lastKnownShotStartedAt = shotData.startedAt
    }
    if (typeof shotData.protocol === 'string' && shotData.protocol) {
      this.lastKnownShotProtocol = shotData.protocol
    }
  }

  /**
   * 执行来自网络同步的远程击球事件。
   * @param {Object} shotData - 击球初始条件。
   */
  executeRemoteShoot(shotData) {
    this.applyShotStart(shotData, { remote: true })
  }

  executeAcceptedShotInput(shotData) {
    this.executeRemoteShoot(shotData)
  }

  /**
   * 创建当前游戏状态的快照以便进行网络同步。
   * @returns {Object} 游戏状态快照对象。
   */
  getGameStateSnapshot() {
    return {
      balls: this.balls.map(b => {
        const pos = b.physicsPos || b.pos
        const vel = b.physicsVel || b.vel || new Vec2(0, 0)
        const rot = b.physicsRot || b.rotMat || new Float32Array(9)
        return { type: b.type, label: b.label, x: pos.x, y: pos.y, vx: vel.x, vy: vel.y, rot: Array.from(rot), pocketed: b.pocketed }
      }),
      currentPlayer: this.currentPlayer, timeLeft: this.timeLeft, ballInHand: this.ballInHand, ballInHandZone: this.ballInHandZone, playerGroups: { ...this.playerGroups }, scores: { ...this.scores }, isBreakShot: this.isBreakShot, turnId: this.turnId, stateVersion: this.stateVersion, stateHash: this.stateHash, roomPhase: this.roomPhase, shotToken: this.shotToken, ...createStatusSyncSnapshot(this),
    }
  }

  /**
   * 为当前停球结果生成稳定签名。
   * 该签名不追求安全强度，只要求多端对同一 settled 结果产生同一串文本。
   * @returns {string} settled 结果签名。
   */
  createSettledSignature() {
    const ballSegments = this.balls
      .map(ball => ({
        type: ball.type,
        label: ball.label,
        x: Math.round(ball.pos.x * 100) / 100,
        y: Math.round(ball.pos.y * 100) / 100,
        pocketed: ball.pocketed === true,
      }))
      .sort((a, b) => `${a.type}:${a.label}`.localeCompare(`${b.type}:${b.label}`))
      .map(ball => `${ball.type}:${ball.label}:${ball.x}:${ball.y}:${ball.pocketed ? 1 : 0}`)

    return [
      `cp:${this.currentPlayer}`,
      `bh:${this.ballInHand ? 1 : 0}`,
      `zone:${this.ballInHandZone}`,
      `g1:${this.playerGroups[1] || 'open'}`,
      `g2:${this.playerGroups[2] || 'open'}`,
      `s1:${this.scores[1] ?? 0}`,
      `s2:${this.scores[2] ?? 0}`,
      `break:${this.isBreakShot ? 1 : 0}`,
      ...ballSegments,
    ].join('|')
  }

  /**
   * 创建“球停稳后对账”用的状态快照。
   * 该快照是多端重新对齐业务状态的唯一正式入口。
   * @returns {Object} settled 状态快照。
   */
  createSettledSyncSnapshot() {
    return {
      ...this.getGameStateSnapshot(),
      syncKind: 'settled',
      settledAt: Date.now(),
      settledSignature: this.createSettledSignature(),
      sourceShotId: this.lastAppliedShotId,
      shotProtocol: this.lastKnownShotProtocol,
    }
  }

  /**
   * 创建白球摆放中的轻量级实时同步快照。
   * 仅用于视觉跟随，不触发回合与业务状态切换。
   * @returns {Object} live placement 快照。
   */
  createLivePlacementSnapshot() {
    return {
      ...this.getGameStateSnapshot(),
      isLive: true,
      syncKind: 'live-placement',
    }
  }

  /**
   * 创建白球摆放完成后的提交快照。
   * 这不是上一杆 settled 对账，而是当前回合开始前的桌面确认。
   * @returns {Object} placement commit 快照。
   */
  createPlacementCommitSnapshot() {
    return {
      ...this.getGameStateSnapshot(),
      syncKind: 'ball-in-hand-commit',
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

    const isPlacementLiveSync = snapshot.isLive === true && snapshot.ballInHand === true;
    const isMotionLiveSync = snapshot.isLive === true && !isPlacementLiveSync;

    // Movement-period whole-table live sync causes remote physics to get
    // continuously rewritten during dense collisions. Ignore those updates
    // and only keep ball-in-hand placement previews and settled snapshots.
    if (isMotionLiveSync && !snapshot.forceBusinessUpdate) return;
    const isServerSync = snapshot.room !== undefined;
    const isAuthoritative = snapshot.authoritative === true;
    const isLive = snapshot.isLive === true;
    const isSettledSync = snapshot.syncKind === 'settled' || snapshot.syncKind === 'authoritative-settled';

    ballsToApply.forEach(s => {
      const ball = this.balls.find(b => b.type === s.type && b.label === s.label)
      if (ball) {
        const physicsPos = ball.physicsPos || ball.pos
        const physicsVel = ball.physicsVel || ball.vel
        const physicsRot = ball.physicsRot || ball.rotMat
        const renderPos = ball.renderPos || physicsPos
        const renderRot = ball.renderRot || physicsRot
        const wasPocketed = ball.pocketed

        physicsPos.x = s.x;
        physicsPos.y = s.y;
        ball.pocketed = s.pocketed;
        if (!isPlacementLiveSync) {
          physicsVel.x = 0;
          physicsVel.y = 0;
        } else if (s.vx !== undefined && s.vy !== undefined) {
          physicsVel.x = s.vx;
          physicsVel.y = s.vy;
        }
        if (s.rot) physicsRot.set(s.rot);

        const deviation = Math.hypot(physicsPos.x - renderPos.x, physicsPos.y - renderPos.y)
        const shouldSnapRender = isPlacementLiveSync || wasPocketed !== ball.pocketed || deviation > BALL_RADIUS * 1.0

        if (DEBUG_JITTER && deviation > 1) {
          console.log(`[JitterLog] Ball ${ball.label || ball.type} corrected by ${deviation.toFixed(2)}px, snap=${shouldSnapRender}`)
        }

        if (shouldSnapRender && typeof ball.syncPhysicsToRender === 'function') {
          ball.syncPhysicsToRender()
        } else if (shouldSnapRender) {
          renderPos.x = physicsPos.x
          renderPos.y = physicsPos.y
          if (renderRot?.set) renderRot.set(physicsRot)
        }
      }
    })

    if (isPlacementLiveSync && !snapshot.forceBusinessUpdate) return;
    if (!isAuthoritative && !isSettledSync && isLive && !isPlacementLiveSync && !snapshot.forceBusinessUpdate) return;
    const room = snapshot.room || snapshot;
    const protocolState = snapshotStateFromRoomPayload(room)
    this.turnId = protocolState.turnId
    this.stateVersion = protocolState.stateVersion
    this.shotToken = protocolState.shotToken
    this.roomPhase = protocolState.roomPhase
    this.stateHash = protocolState.stateHash || this.stateHash
    if (room.currentPlayer !== undefined) this.currentPlayer = room.currentPlayer
    if (room.ballInHand !== undefined) this.ballInHand = room.ballInHand
    if (room.ballInHandZone) this.ballInHandZone = room.ballInHandZone
    if (typeof room.lastShotId === 'string' && room.lastShotId) this.lastAppliedShotId = room.lastShotId
    if (typeof room.lastShotPlayerId === 'string' && room.lastShotPlayerId) this.lastKnownShotPlayerId = room.lastShotPlayerId
    if (typeof room.lastShotProtocol === 'string' && room.lastShotProtocol) this.lastKnownShotProtocol = room.lastShotProtocol
    if (typeof room.lastShotStartedAt === 'number' && room.lastShotStartedAt > 0) this.lastKnownShotStartedAt = room.lastShotStartedAt
    if (typeof room.lastSettledSignature === 'string' && room.lastSettledSignature) this.lastSettledSignature = room.lastSettledSignature
    if (isSettledSync || isAuthoritative) this.awaitingSettledSync = false
    if (this.ballInHand && this.cueBall?.pocketed) {
      this.cueBall.pocketed = false
      this.cueBall.clearPocketAnimation?.()
      this.cueBall.pos = new Vec2(this.ballInHandZone === 'kitchen' ? HEAD_STRING_X : -TABLE_WIDTH / 4, 0)
      this.cueBall.vel = new Vec2(0, 0)
      this.cueBall.syncPhysicsToRender?.()
    }
    this.playerGroups = room.playerGroups || this.playerGroups;
    this.scores = room.scores || this.scores;
    this.isBreakShot = room.isBreakShot !== undefined ? room.isBreakShot : this.isBreakShot;
    this.showRemoteCue = false; this.shotActive = false; this.awaitingShotResult = false;
    if (!isPlacementLiveSync) {
      this.commitSettledSnapshot()
    }
    if (isAuthoritative) {
      this.isDragging = false;
      this.pullDistance = 0;
      this.isTurnLocked = false;
    }
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

  beginLocalAuthoritativeShot(shotInput) {
    this.pendingShotRequest = shotInput
    this.roomPhase = 'RESOLVING'
    this.awaitingShotResult = true
  }

  commitSettledSnapshot() {
    const snapshot = buildSettledSnapshotPayload(this)
    this.lastSettledSnapshot = snapshot
    this.stateHash = snapshot.stateHash
    return snapshot
  }

  rollbackToSettledSnapshot(reason = '出杆未被服务器接受') {
    if (!this.lastSettledSnapshot?.balls) return
    this.applyGameStateSnapshot({
      balls: this.lastSettledSnapshot.balls,
      forceBusinessUpdate: true,
      turnId: this.turnId,
      stateVersion: this.stateVersion,
      stateHash: this.lastSettledSnapshot.stateHash,
      roomPhase: 'PLAYING',
      shotToken: this.shotToken,
      currentPlayer: this.currentPlayer,
      ballInHand: this.ballInHand,
      ballInHandZone: this.ballInHandZone,
      playerGroups: { ...this.playerGroups },
      scores: { ...this.scores },
      isBreakShot: this.isBreakShot,
    })
    this.pendingShotRequest = null
    this.awaitingShotResult = false
    this.roomPhase = 'PLAYING'
    this.setStatusMessage(reason, 2000)
  }

  applyShotResult(result) {
    if (!result) return
    if (result.finalBallState) {
      this.applyGameStateSnapshot({
        balls: result.finalBallState,
        turnId: result.turnId ?? this.turnId,
        stateVersion: result.stateVersion ?? this.stateVersion,
        stateHash: result.stateHash || this.stateHash,
        roomPhase: result.roomPhase || 'PLAYING',
        shotToken: result.nextShotToken || result.shotToken || this.shotToken,
        currentPlayer: result.currentPlayer ?? this.currentPlayer,
        ballInHand: result.ballInHand ?? this.ballInHand,
        ballInHandZone: result.ballInHandZone || this.ballInHandZone,
        playerGroups: result.playerGroups || this.playerGroups,
        scores: result.scores || this.scores,
        isBreakShot: result.isBreakShot ?? false,
        forceBusinessUpdate: true,
        statusMessage: result.statusMessage || '',
        statusRemainingMs: result.statusRemainingMs || 0,
      })
    }
    if (result.currentPlayer !== undefined) this.currentPlayer = result.currentPlayer
    if (result.ballInHand !== undefined) this.ballInHand = result.ballInHand
    if (result.ballInHandZone) this.ballInHandZone = result.ballInHandZone
    if (result.playerGroups) this.playerGroups = result.playerGroups
    if (result.scores) this.scores = result.scores
    this.isBreakShot = result.isBreakShot !== undefined ? result.isBreakShot : false
    this.turnId = result.nextTurnId ?? result.turnId ?? this.turnId
    this.stateVersion = result.stateVersion ?? this.stateVersion
    this.shotToken = result.nextShotToken || this.shotToken
    this.roomPhase = result.roomPhase || 'PLAYING'
    this.pendingShotRequest = null
    this.awaitingShotResult = false
    this.shotActive = false
    this.showRemoteCue = false
    this.pullDistance = 0
    this.isDragging = false
    this.commitSettledSnapshot()
    this.updateUI()
  }

  buildShotEndReport(senderRole = 'shooter') {
    return createShotEndReport(this, senderRole)
  }

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
    this.cueBall.vel = new Vec2(0, 0); this.cueBall.pocketed = false; this.cueBall.clearPocketAnimation?.();
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
    if (this.awaitingSettledSync) return '正在恢复对局，请等待当前球路结算'
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
  evaluateShot() {
    const wasMyTurn = GameClient.isMyTurn
    if (GameClient.usesLightweightAuthority()) {
      if (!this.shotActive || this.isGameOver) return
      this.shotActive = false
      this.awaitingShotResult = true
      this.roomPhase = 'RESOLVING'
      const senderRole = wasMyTurn ? 'shooter' : 'witness'
      GameClient.sendShotEndReport(this.buildShotEndReport(senderRole))
      if (wasMyTurn) {
        this.setStatusMessage('本杆结算中', 1800)
      }
      return
    }
    evaluateShot(this)
    if (!this.isMoving() && !this.shotActive && wasMyTurn) GameClient.sendSync(this.createSettledSyncSnapshot())
  }

  /**
   * 每帧调用的主逻辑更新。处理物理、计时器和同步逻辑。
   */
  update() {
    const now = Date.now();
    const frameMs = Math.min(80, now - this.lastUpdate);
    const deltaSeconds = Math.max(0, frameMs) / 1000
    this.lastUpdate = now;
    updateGamePhysics(this, frameMs);
    
    if (!this.isGameOver) {
        if (this.timerPaused) {} 
        else if (this.expireAt && this.serverTimeOffset !== undefined) {
            const remaining = this.expireAt - (Date.now() + this.serverTimeOffset);
            this.timeLeft = Math.max(0, remaining / 1000);
            if (remaining <= 0 && !this.isTurnLocked && !this.isMoving() && !this.shotActive) { this.isTurnLocked = true; this.isDragging = false; this.pullDistance = 0; this.updateUI(); if (GameClient.isMyTurn) this.setStatusMessage("时间到，回合结束", 2000); }
        } else if (!this.isMoving() && !this.shotActive) {
            const dtSec = frameMs / 1000;
            this.timeLeft = Math.max(0, this.timeLeft - dtSec);
        }
        const shouldHideTimer = this.timerPaused || (GameClient.isMyTurn && (this.isMoving() || this.shotActive));
        this.displayedSecond = shouldHideTimer ? -1 : Math.ceil(this.timeLeft);
        this.updateTimerUI();
    }
    this.lastTick = now;
    this.updateTimerUI();
    const statusNode = document.getElementById('status')
    if (statusNode) {
      statusNode.innerText = this.getStatusText()
    }
    this.collisionEffects = this.collisionEffects.map(e => ({ ...e, age: e.age + 1 })).filter(e => e.age < 15);

    if (this.isMoving() && GameClient.isMyTurn) {
        this.syncCounter = 0;
    } else this.syncCounter = 0;

    if (GameClient.isMyTurn && this.ballInHand && this.placingCue) {
        if (++this.placementSyncCounter % 2 === 0) GameClient.sendSync(this.createLivePlacementSnapshot());
    } else this.placementSyncCounter = 0;

    if (GameClient.isMyTurn && this.roomPhase === 'PLAYING' && !this.ballInHand && !this.isTurnLocked && !this.awaitingSettledSync && !this.isMoving() && (this.isDragging || this.hasPointerInput)) {
        if (++this.aimSyncCounter % 2 === 0) GameClient.sendAim({ aimAngle: this.aimAngle, pullDistance: this.isDragging ? this.pullDistance : 0 });
        this.updateUI();
    } else if (this.showRemoteCue) this.updateUI();
    else this.aimSyncCounter = 0;

    this.balls.forEach(ball => {
      if (typeof ball.updateRender === 'function') {
        ball.updateRender(deltaSeconds);
      }
    });

    if (DEBUG_JITTER) {
      const maxRenderLag = this.balls.reduce((maxLag, ball) => {
        const physicsPos = ball.physicsPos || ball.pos
        const renderPos = ball.renderPos || physicsPos
        return Math.max(maxLag, Math.hypot(physicsPos.x - renderPos.x, physicsPos.y - renderPos.y))
      }, 0)

      this.jitterStats = this.jitterStats || {}
      this.jitterStats.lastRenderLag = maxRenderLag

      const lastPhysicsFrame = this.jitterStats.lastPhysicsFrame
      if (lastPhysicsFrame) {
        console.log(
          `[JitterLog] frame=${lastPhysicsFrame.frameMs.toFixed(2)}ms substeps=${lastPhysicsFrame.substeps} `
          + `acc=${lastPhysicsFrame.accumulatorBefore.toFixed(2)}->${lastPhysicsFrame.accumulatorAfter.toFixed(2)} `
          + `pairs=${lastPhysicsFrame.collisionPairs} overlap=${lastPhysicsFrame.maxOverlap.toFixed(3)} `
          + `renderLag=${maxRenderLag.toFixed(3)}`
        )
        this.jitterStats.lastPhysicsFrame = null
      }
    }
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
