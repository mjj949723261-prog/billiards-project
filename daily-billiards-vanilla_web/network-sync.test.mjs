import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { resolveRoomEntry } from './src/network/session-entry.js'
import { getRenderedCuePullDistance, getRenderedCuePowerRatio, shouldRenderAimGuides, resolveTableSurfaceSourceRect } from './src/render/table-renderer.js'
import { applyStatusSync, createStatusSyncSnapshot } from './src/network/state-sync.js'
import { Vec2 } from './src/math.js'
import { applyLayoutMode, hasDebugAlwaysDrag, isPortraitLayout, resolveRequestedLayoutMode } from './src/layout/mode.js'

test('GameClient can be imported without browser storage globals', async () => {
  const originalWindow = globalThis.window
  const originalLocalStorage = globalThis.localStorage
  const originalSockJS = globalThis.SockJS
  const originalStomp = globalThis.Stomp

  try {
    delete globalThis.window
    delete globalThis.localStorage
    delete globalThis.SockJS
    delete globalThis.Stomp

    const mod = await import(`./src/network/game-client.js?case=import-${Date.now()}`)

    assert.equal(typeof mod.GameClient.connect, 'function')
    assert.equal(typeof mod.GameClient.playerId, 'string')
  } finally {
    globalThis.window = originalWindow
    globalThis.localStorage = originalLocalStorage
    globalThis.SockJS = originalSockJS
    globalThis.Stomp = originalStomp
  }
})

test('frontend physics does not switch players locally when timer expires', async () => {
  const originalDocument = globalThis.document
  const originalDateNow = Date.now

  const statusNode = { innerText: '' }
  const timerNode = {
    innerText: '',
    classList: { toggle() {} },
  }

  globalThis.document = {
    getElementById(id) {
      if (id === 'status') return statusNode
      if (id === 'timer') return timerNode
      throw new Error(`unexpected element id: ${id}`)
    },
  }

  Date.now = () => 46_000

  try {
    const { updateGamePhysics } = await import(`./src/core/physics.js?case=timeout-${Date.now()}`)

    let updateUiCalls = 0
    const game = {
      balls: [],
      pockets: [],
      lastTick: 0,
      timeLeft: 0.1,
      releaseFlash: 0,
      scorePocketEffects: [],
      currentPlayer: 1,
      isGameOver: false,
      wasMoving: false,
      shotActive: false,
      collisionEffects: [],
      updateTimerUI() {},
      getStatusText() { return 'waiting' },
      isMoving() { return false },
      updateUI() { updateUiCalls++ },
      evaluateShot() {},
    }

    updateGamePhysics(game)

    assert.equal(game.currentPlayer, 1)
    assert.equal(updateUiCalls, 0)
  } finally {
    globalThis.document = originalDocument
    Date.now = originalDateNow
  }
})

test('only explicit room links auto join; prior room is suggestion only', () => {
  assert.deepEqual(resolveRoomEntry('ABCD1234', 'OLDROOM'), {
    autoJoinRoomId: 'ABCD1234',
    suggestedRoomId: 'ABCD1234',
  })

  assert.deepEqual(resolveRoomEntry(null, 'OLDROOM'), {
    autoJoinRoomId: null,
    suggestedRoomId: 'OLDROOM',
  })
})

test('JOIN messages for a playing room also transition the UI into game state', async () => {
  const originalWindow = globalThis.window
  const originalDocument = globalThis.document

  const matchStatus = { innerText: '' }
  let startedRoom = null

  globalThis.document = {
    getElementById(id) {
      if (id === 'match-status') return matchStatus
      throw new Error(`unexpected element id: ${id}`)
    },
  }
  globalThis.window = {
    handleGameStart(room) {
      startedRoom = room
    },
  }

  try {
    const { GameClient } = await import(`./src/network/game-client.js?case=join-playing-${Date.now()}`)
    GameClient.playerId = 'player_1'
    GameClient.onMessageReceived({
      type: 'JOIN',
      senderId: 'SYSTEM',
      content: {
        roomId: 'ROOM2026',
        status: 'PLAYING',
        currentTurnPlayerId: 'player_1',
      },
    })

    assert.equal(matchStatus.innerText, '找到球局，正在等待对手...')
    assert.equal(startedRoom?.roomId, 'ROOM2026')
  } finally {
    globalThis.window = originalWindow
    globalThis.document = originalDocument
  }
})

test('remote player cue should not render predictive guide lines', () => {
  assert.equal(shouldRenderAimGuides({ showRemoteCue: false }, true), true)
  assert.equal(shouldRenderAimGuides({ showRemoteCue: false }, false), false)
  assert.equal(shouldRenderAimGuides({ showRemoteCue: true }, true), false)
})

test('remote cue rendering keeps pullback visible even when local drag flag is false', () => {
  assert.equal(getRenderedCuePullDistance({ showRemoteCue: true, isDragging: false, pullDistance: 36 }), 36)
  assert.equal(getRenderedCuePowerRatio({ showRemoteCue: true, isDragging: false, pullDistance: 36 }) > 0, true)
  assert.equal(getRenderedCuePullDistance({ showRemoteCue: false, isDragging: false, pullDistance: 36 }), 0)
})

test('table surface source rect crops wide table art to the gameplay table ratio', () => {
  const rect = resolveTableSurfaceSourceRect(2998, 1408)
  const targetRatio = (820 + 34 * 2) / (410 + 34 * 2)

  assert.ok(rect.x > 0)
  assert.equal(rect.y, 0)
  assert.equal(rect.height, 1408)
  assert.ok(Math.abs(rect.width / rect.height - targetRatio) < 0.001)
})

test('foul status snapshot preserves remaining toast time for remote sync', () => {
  const snapshot = createStatusSyncSnapshot({
    statusMessage: '犯规：白球落袋',
    statusUntil: 8_200,
  }, 6_000)

  assert.deepEqual(snapshot, {
    statusMessage: '犯规：白球落袋',
    statusRemainingMs: 2_200,
  })

  const remoteGame = { statusMessage: '', statusUntil: 0 }
  const applied = applyStatusSync(remoteGame, snapshot, 10_000)

  assert.equal(applied, true)
  assert.equal(remoteGame.statusMessage, '犯规：白球落袋')
  assert.equal(remoteGame.statusUntil, 12_200)
})

test('game state snapshot includes cue ball placement coordinates for remote sync', async () => {
  const originalSessionStorage = globalThis.sessionStorage

  globalThis.sessionStorage = {
    getItem() { return null },
    setItem() {},
    removeItem() {},
  }

  const { BilliardsGame } = await import(`./src/game.js?case=placement-snapshot-${Date.now()}`)

  try {
    const game = Object.create(BilliardsGame.prototype)
    game.balls = [
      { type: 'cue', label: 'cue', pos: new Vec2(12, 34), pocketed: false },
      { type: 'solid', label: '1', pos: new Vec2(56, 78), pocketed: false },
    ]
    game.currentPlayer = 2
    game.ballInHand = true
    game.ballInHandZone = 'table'
    game.playerGroups = { 1: 'solid', 2: 'stripe' }
    game.scores = { 1: 1, 2: 2 }
    game.isBreakShot = false
    game.statusMessage = '自由球：请拖动母球放置'
    game.statusUntil = 5_000

    const snapshot = game.getGameStateSnapshot()

    assert.equal(snapshot.ballInHand, true)
    assert.equal(snapshot.balls[0].x, 12)
    assert.equal(snapshot.balls[0].y, 34)
  } finally {
    globalThis.sessionStorage = originalSessionStorage
  }
})

test('syncTimer pauses countdown without zeroing remaining time when server stops timer during a shot', async () => {
  const originalSessionStorage = globalThis.sessionStorage

  globalThis.sessionStorage = {
    getItem() { return null },
    setItem() {},
    removeItem() {},
  }

  const { BilliardsGame } = await import(`./src/game.js?case=timer-pause-${Date.now()}`)

  try {
    const game = Object.create(BilliardsGame.prototype)
    game.timeLeft = 18.6
    game.expireAt = 123_000
    game.serverTimeOffset = 0
    game.isTurnLocked = false
    game.timerPaused = false
    game.displayedSecond = 19

    game.syncTimer(100_000, 0, 100_000)

    assert.equal(game.expireAt, 0)
    assert.equal(game.timerPaused, true)
    assert.equal(game.timeLeft, 18.6)
  } finally {
    globalThis.sessionStorage = originalSessionStorage
  }
})

test('index page should load websocket libraries from local assets instead of external CDNs', () => {
  const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8')

  assert.match(html, /src="\.\/vendor\/sockjs\.min\.js"|src="vendor\/sockjs\.min\.js"/)
  assert.match(html, /src="\.\/vendor\/stomp\.min\.js"|src="vendor\/stomp\.min\.js"/)
  assert.doesNotMatch(html, /cdn\.jsdelivr\.net/)
})

test('main entry should expose connection errors inside the auth panel', () => {
  const source = fs.readFileSync(new URL('./main.js', import.meta.url), 'utf8')
  const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8')

  assert.match(source, /error-msg/)
  assert.match(source, /textContent|innerText/)
  assert.match(source, /classList\.remove\('hidden'\)/)
  assert.doesNotMatch(html, /id="game-info"/)
  assert.doesNotMatch(html, /复制链接/)
  assert.match(html, /双人台球/)
})

test('embedded portrait layout can be forced by host app or URL param', () => {
  assert.equal(resolveRequestedLayoutMode({
    BILLIARDS_LAYOUT_MODE: 'embedded-portrait',
    location: { search: '' },
  }), 'embedded-portrait')

  assert.equal(resolveRequestedLayoutMode({
    location: { search: '?room=ROOM2026&layout=embedded-portrait' },
  }), 'embedded-portrait')

  assert.equal(isPortraitLayout({
    BILLIARDS_LAYOUT_MODE: 'landscape',
    location: { search: '' },
    innerWidth: 390,
    innerHeight: 844,
  }), false)

  assert.equal(isPortraitLayout({
    BILLIARDS_LAYOUT_MODE: 'embedded-portrait',
    location: { search: '' },
    innerWidth: 844,
    innerHeight: 390,
  }), false)
})

test('applyLayoutMode updates body classes for embedded portrait hosts', () => {
  const classNames = new Set()
  const styleProps = {}
  const body = {
    classList: {
      add(...names) {
        names.forEach((name) => classNames.add(name))
      },
      remove(...names) {
        names.forEach((name) => classNames.delete(name))
      },
      toggle(name, force) {
        if (force) {
          classNames.add(name)
        } else {
          classNames.delete(name)
        }
      },
    },
    style: {
      setProperty(name, value) {
        styleProps[name] = value
      },
      removeProperty(name) {
        delete styleProps[name]
      },
    },
  }

  const result = applyLayoutMode(
    { body },
    {
      BILLIARDS_LAYOUT_MODE: 'embedded-portrait',
      location: { search: '' },
      innerWidth: 844,
      innerHeight: 390,
      matchMedia(query) {
        return { matches: query.includes('pointer: coarse') }
      },
    },
  )

  assert.equal(result.portrait, false)
  assert.equal(result.explicitMode, 'embedded-portrait')
  assert.equal(classNames.has('layout-landscape'), true)
  assert.equal(classNames.has('layout-mode-embedded-portrait'), true)
  assert.equal(classNames.has('pointer-coarse'), true)
  assert.equal(classNames.has('viewport-portrait'), true)
  assert.equal(styleProps['--viewport-semantic-landscape-scale'], String(390 / 844))
})

test('coarse-pointer phones render landscape classes even before device rotation', () => {
  const classNames = new Set()
  const styleProps = {}
  const body = {
    classList: {
      add(...names) {
        names.forEach((name) => classNames.add(name))
      },
      remove(...names) {
        names.forEach((name) => classNames.delete(name))
      },
      toggle(name, force) {
        if (force) {
          classNames.add(name)
        } else {
          classNames.delete(name)
        }
      },
    },
    style: {
      setProperty(name, value) {
        styleProps[name] = value
      },
      removeProperty(name) {
        delete styleProps[name]
      },
    },
  }
  const result = applyLayoutMode(
    { body, documentElement: {} },
    {
      location: { search: '' },
      innerWidth: 390,
      innerHeight: 844,
      matchMedia(query) {
        return { matches: query.includes('pointer: coarse') }
      },
    },
  )

  assert.equal(result.portrait, false)
  assert.equal(result.coarsePointer, true)
  assert.equal(classNames.has('layout-landscape'), true)
  assert.equal(classNames.has('layout-portrait'), false)
  assert.equal(classNames.has('viewport-portrait'), true)
  assert.equal(classNames.has('viewport-landscape'), false)
  assert.equal(styleProps['--viewport-semantic-landscape-scale'], String(390 / 844))
})

test('debugAlwaysDrag URL flag is opt-in and explicit', () => {
  assert.equal(hasDebugAlwaysDrag({ location: { search: '?debugAlwaysDrag=1' } }), true)
  assert.equal(hasDebugAlwaysDrag({ location: { search: '?room=12uuh' } }), false)
})

test('portrait-held semantic mobile gameplay remaps cue aiming onto the landscape-semantic axis', async () => {
  const originalDocument = globalThis.document
  const originalWindow = globalThis.window

  const classNames = new Set(['layout-landscape', 'pointer-coarse', 'viewport-portrait'])
  globalThis.document = {
    body: {
      classList: {
        contains(name) {
          return classNames.has(name)
        },
      },
    },
  }
  globalThis.window = {
    innerWidth: 390,
    innerHeight: 844,
    location: { search: '' },
  }

  try {
    const { BilliardsGame } = await import(`./src/game.js?case=touch-remap-${Date.now()}`)
    const game = Object.create(BilliardsGame.prototype)
    game.viewScale = 2
    game.mousePos = new Vec2(0, 0)
    game.hasPointerInput = false
    game.canvas = {
      getBoundingClientRect() {
        return { left: 100, top: 200, width: 300, height: 600 }
      },
    }

    game.updatePos({ clientX: 280, clientY: 560 }, 'aim')

    assert.equal(game.mousePos.x, 30)
    assert.equal(game.mousePos.y, -15)
  } finally {
    globalThis.document = originalDocument
    globalThis.window = originalWindow
  }
})

test('landscape-held semantic mobile gameplay keeps cue aiming on direct canvas coordinates', async () => {
  const originalDocument = globalThis.document
  const originalWindow = globalThis.window

  const classNames = new Set(['layout-landscape', 'pointer-coarse', 'viewport-landscape'])
  globalThis.document = {
    body: {
      classList: {
        contains(name) {
          return classNames.has(name)
        },
      },
    },
  }
  globalThis.window = {
    innerWidth: 844,
    innerHeight: 390,
    location: { search: '' },
  }

  try {
    const { BilliardsGame } = await import(`./src/game.js?case=touch-landscape-${Date.now()}`)
    const game = Object.create(BilliardsGame.prototype)
    game.viewScale = 2
    game.mousePos = new Vec2(0, 0)
    game.hasPointerInput = false
    game.canvas = {
      getBoundingClientRect() {
        return { left: 100, top: 200, width: 600, height: 300 }
      },
    }

    game.updatePos({ clientX: 280, clientY: 560 }, 'aim')

    assert.equal(game.mousePos.x, -60)
    assert.equal(game.mousePos.y, 105)
  } finally {
    globalThis.document = originalDocument
    globalThis.window = originalWindow
  }
})

test('landscape-held semantic mobile gameplay keeps cue-ball placement on direct canvas coordinates', async () => {
  const originalDocument = globalThis.document
  const originalWindow = globalThis.window

  const classNames = new Set(['layout-landscape', 'pointer-coarse', 'viewport-landscape'])
  globalThis.document = {
    body: {
      classList: {
        contains(name) {
          return classNames.has(name)
        },
      },
    },
  }
  globalThis.window = {
    innerWidth: 844,
    innerHeight: 390,
    location: { search: '' },
  }

  try {
    const { BilliardsGame } = await import(`./src/game.js?case=placement-landscape-${Date.now()}`)
    const game = Object.create(BilliardsGame.prototype)
    game.viewScale = 2
    game.mousePos = new Vec2(0, 0)
    game.hasPointerInput = false
    game.canvas = {
      getBoundingClientRect() {
        return { left: 100, top: 200, width: 600, height: 300 }
      },
    }

    game.updatePos({ clientX: 280, clientY: 560 }, 'placement')

    assert.equal(game.mousePos.x, -60)
    assert.equal(game.mousePos.y, 105)
  } finally {
    globalThis.document = originalDocument
    globalThis.window = originalWindow
  }
})

test('debugAlwaysDrag lets room input start cue dragging even when the turn is blocked', async () => {
  const originalWindow = globalThis.window
  const canvasListeners = new Map()
  const windowListeners = new Map()

  globalThis.window = {
    location: { search: '?debugAlwaysDrag=1' },
    addEventListener(type, listener) {
      windowListeners.set(type, listener)
    },
  }

  try {
    const [{ bindGameInput }, { GameClient }] = await Promise.all([
      import(`./src/input/bindings.js?case=debug-drag-${Date.now()}`),
      import(`./src/network/game-client.js?case=debug-drag-client-${Date.now()}`),
    ])

    GameClient.isMyTurn = false

    const game = {
      isTurnLocked: true,
      audio: { unlock() {} },
      ballInHand: false,
      placingCue: false,
      isGameOver: false,
      isDragging: false,
      pullDistance: 0,
      aimAngle: 0,
      mousePos: new Vec2(0, 0),
      cueBall: { pocketed: true, pos: new Vec2(0, 0), vel: new Vec2(0, 0) },
      canvas: {
        addEventListener(type, listener) {
          canvasListeners.set(type, listener)
        },
      },
      updatePos() {
        this.mousePos.x = 30
        this.mousePos.y = 0
      },
      isMoving() { return false },
    }

    bindGameInput(game)
    canvasListeners.get('mousedown')({ clientX: 0, clientY: 0 })

    assert.equal(game.isDragging, true)
    assert.equal(game.cueBall.pocketed, false)
    assert.equal(typeof windowListeners.get('mousemove'), 'function')
  } finally {
    globalThis.window = originalWindow
  }
})

test('portrait-held semantic mobile gameplay remaps cue-ball placement onto the rotated landscape-semantic axis', async () => {
  const originalDocument = globalThis.document
  const originalWindow = globalThis.window

  const classNames = new Set(['layout-landscape', 'pointer-coarse', 'viewport-portrait'])
  globalThis.document = {
    body: {
      classList: {
        contains(name) {
          return classNames.has(name)
        },
      },
    },
  }
  globalThis.window = {
    innerWidth: 390,
    innerHeight: 844,
    location: { search: '' },
  }

  try {
    const { BilliardsGame } = await import(`./src/game.js?case=placement-remap-${Date.now()}`)
    const game = Object.create(BilliardsGame.prototype)
    game.viewScale = 2
    game.mousePos = new Vec2(0, 0)
    game.hasPointerInput = false
    game.canvas = {
      getBoundingClientRect() {
        return { left: 100, top: 200, width: 300, height: 600 }
      },
    }

    game.updatePos({ clientX: 280, clientY: 560 }, 'placement')

    assert.equal(game.mousePos.x, 30)
    assert.equal(game.mousePos.y, -15)
  } finally {
    globalThis.document = originalDocument
    globalThis.window = originalWindow
  }
})

test('embedded portrait layout forces coarse-pointer mobile styling even on desktop hosts', () => {
  const classNames = new Set()
  const body = {
    classList: {
      add(...names) {
        names.forEach((name) => classNames.add(name))
      },
      remove(...names) {
        names.forEach((name) => classNames.delete(name))
      },
      toggle(name, force) {
        if (force) {
          classNames.add(name)
        } else {
          classNames.delete(name)
        }
      },
    },
  }

  const result = applyLayoutMode(
    { body },
    {
      location: { search: '?room=ROOM999&layout=embedded-portrait' },
      innerWidth: 1440,
      innerHeight: 900,
      matchMedia() {
        return { matches: false }
      },
    },
  )

  assert.equal(result.explicitMode, 'embedded-portrait')
  assert.equal(result.coarsePointer, true)
  assert.equal(classNames.has('pointer-coarse'), true)
})

test('embedded portrait HUD removes legacy game info wiring', () => {
  const uiSource = fs.readFileSync(new URL('./src/ui/dom-ui.js', import.meta.url), 'utf8')
  const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8')

  assert.doesNotMatch(html, /id="game-info"/)
  assert.doesNotMatch(uiSource, /gameInfo/)
  assert.doesNotMatch(uiSource, /insertBefore/)
})

test('score boxes show timer and power only for the current player', () => {
  const uiSource = fs.readFileSync(new URL('./src/ui/dom-ui.js', import.meta.url), 'utf8')

  assert.match(uiSource, /const p1SideTimer = document\.getElementById\('p1-side-timer'\)/)
  assert.match(uiSource, /const p2SideTimer = document\.getElementById\('p2-side-timer'\)/)
  assert.doesNotMatch(uiSource, /center-turn-timer/)
  assert.match(uiSource, /p1SideTimer\.innerText = game\.currentPlayer === 1 \? displayVal : ''/)
  assert.match(uiSource, /p2SideTimer\.innerText = game\.currentPlayer === 2 \? displayVal : ''/)
  assert.match(uiSource, /p1Bar\.style\.opacity = \(game\.currentPlayer === 1 && powerPercent > 0\) \? '0\.8' : '0'/)
  assert.match(uiSource, /p2Bar\.style\.opacity = \(game\.currentPlayer === 2 && powerPercent > 0\) \? '0\.8' : '0'/)
})

test('timer text updates immediately when turn changes sides even if remaining second is unchanged', async () => {
  const originalDocument = globalThis.document

  const makeNode = (text = '') => ({
    innerText: text,
    classList: {
      classes: new Set(),
      add(...tokens) {
        tokens.forEach(token => this.classes.add(token))
      },
      remove(...tokens) {
        tokens.forEach(token => this.classes.delete(token))
      },
      toggle(token, force) {
        if (force === undefined) {
          if (this.classes.has(token)) this.classes.delete(token)
          else this.classes.add(token)
          return
        }
        if (force) this.classes.add(token)
        else this.classes.delete(token)
      },
    },
  })

  const nodes = {
    'p1-side-timer': makeNode(''),
    'p2-side-timer': makeNode(''),
  }

  globalThis.document = {
    getElementById(id) {
      return nodes[id] || null
    },
  }

  try {
    const { updateTimerUi } = await import(`./src/ui/dom-ui.js?case=timer-switch-${Date.now()}`)
    const game = {
      currentPlayer: 2,
      timeLeft: 12,
      displayedSecond: 12,
    }

    updateTimerUi(game)

    assert.equal(nodes['p1-side-timer'].innerText, '')
    assert.equal(nodes['p2-side-timer'].innerText, 12)
    assert.equal(nodes['p2-side-timer'].classList.classes.has('hidden'), false)
  } finally {
    globalThis.document = originalDocument
  }
})

test('spectator timer visibility should rely on authoritative server timer instead of local shot state', () => {
  const source = fs.readFileSync(new URL('./src/game.js', import.meta.url), 'utf8')

  assert.match(source, /const shouldHideTimer = this\.timerPaused \|\| \(GameClient\.isMyTurn && \(this\.isMoving\(\) \|\| this\.shotActive\)\)/)
  assert.match(source, /this\.displayedSecond = shouldHideTimer \? -1 : Math\.ceil\(this\.timeLeft\)/)
})

test('open table ball list shows placeholders instead of assigning solids and stripes early', async () => {
  const originalDocument = globalThis.document
  const originalSessionStorage = globalThis.sessionStorage

  class FakeNode {
    constructor(tagName = 'div') {
      this.tagName = tagName
      this.children = []
      this.innerHTML = ''
      this.className = ''
      this.textContent = ''
      this.style = {
        props: {},
        setProperty(name, value) {
          this.props[name] = value
        },
      }
      this.classList = {
        classes: new Set(),
        add: (...tokens) => tokens.forEach(token => this.classList.classes.add(token)),
      }
    }

    appendChild(child) {
      this.children.push(child)
      return child
    }
  }

  const container = new FakeNode('div')

  globalThis.document = {
    getElementById(id) {
      if (id === 'p1-balls') return container
      return null
    },
    createElement(tagName) {
      return new FakeNode(tagName)
    },
  }

  globalThis.sessionStorage = {
    getItem() { return null },
    setItem() {},
    removeItem() {},
  }

  try {
    const { renderBallList } = await import(`./src/ui/dom-ui.js?case=open-table-placeholders-${Date.now()}`)
    const game = {
      balls: [
        { type: 'solid', label: '1', pocketed: false, color: '#facc15' },
        { type: 'solid', label: '2', pocketed: false, color: '#2563eb' },
        { type: 'stripe', label: '9', pocketed: false, color: '#facc15' },
        { type: 'eight', label: '8', pocketed: false, color: '#000000' },
      ],
    }

    renderBallList(game, 1, null)

    assert.equal(container.children.length, 8)
    assert.equal(container.children.every(child => child.className.includes('placeholder')), true)
    assert.equal(container.children.some(child => child.textContent === '8'), false)
    assert.equal(container.children.some(child => child.children.some(grandChild => grandChild.textContent)), false)
  } finally {
    globalThis.document = originalDocument
    globalThis.sessionStorage = originalSessionStorage
  }
})

test('GAME_START handler reinitializes existing local game state before applying OPEN groups', () => {
  const source = fs.readFileSync(new URL('./main.js', import.meta.url), 'utf8')

  assert.match(source, /const isFreshGameStart = msgType === 'GAME_START'/)
  assert.match(source, /else if \(isPlaying && \(isLocalNewSession \|\| isFreshGameStart\)\) \{\s*window\.game\.init\(\);/s)
})

test('refresh restore normalizes persisted ballState before applying snapshot', () => {
  const source = fs.readFileSync(new URL('./main.js', import.meta.url), 'utf8')

  assert.match(source, /const restoredSnapshot = Array\.isArray\(roomData\.ballState\) \? \{ balls: roomData\.ballState \} : roomData\.ballState;/)
  assert.match(source, /window\.game\.applyGameStateSnapshot\(restoredSnapshot\);/)
})

test('logged-in flow exposes lobby as a dedicated overlay view', () => {
  const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8')
  const css = fs.readFileSync(new URL('./style.css', import.meta.url), 'utf8')

  assert.match(html, /id="lobby-panel" class="panel hidden"/)
  assert.match(html, /class="lobby-shell"/)
  assert.match(html, /id="btn-match" class="primary lobby-primary-action"/)
  assert.match(html, /id="btn-room-join"/)
  assert.match(html, /id="btn-room-focus"/)
  assert.match(html, /id="display-rank"/)
  assert.doesNotMatch(html, /id="user-info-panel"/)
  assert.match(css, /#lobby-panel/)
  assert.match(css, /\.lobby-shell/)
  assert.match(css, /\.hero-card/)
  assert.match(css, /\.side-mode-card/)
  assert.match(css, /body\.layout-landscape\.pointer-coarse\.viewport-portrait #lobby-panel/)
  assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*#lobby-panel\s*\{[\s\S]*width:\s*100vw;[\s\S]*height:\s*100vh;/)
  assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*#lobby-panel\s*\{[\s\S]*--lobby-semantic-long:\s*100vw;[\s\S]*--lobby-semantic-short:\s*100vh;/)
  assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*\.lobby-shell\s*\{[\s\S]*width:\s*100vw;[\s\S]*height:\s*100vh;[\s\S]*display:\s*flex;[\s\S]*flex-direction:\s*column;/)
  assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*\.lobby-card-grid\s*\{[\s\S]*display:\s*grid;[\s\S]*grid-template-columns:\s*minmax\(0, 1\.05fr\) minmax\(0, 1\.12fr\) minmax\(0, 0\.88fr\);/)
  assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*\.top-icon\s*\{[\s\S]*width:\s*clamp\(26px,\s*calc\(var\(--lobby-semantic-long\)\s*\*\s*0\.04\),\s*34px\) !important;[\s\S]*min-height:\s*clamp\(42px,\s*calc\(var\(--lobby-semantic-short\)\s*\*\s*0\.11\),\s*50px\);/)
  assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*\.mode-orb\s*\{[\s\S]*width:\s*clamp\(34px,\s*calc\(var\(--lobby-semantic-long\)\s*\*\s*0\.04\),\s*42px\) !important;[\s\S]*min-height:\s*clamp\(50px,\s*calc\(var\(--lobby-semantic-short\)\s*\*\s*0\.13\),\s*58px\);/)
  assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*\.mode-orb em,\s*[\s\S]*\.top-icon em\s*\{[\s\S]*font-size:\s*clamp\(0\.4rem,\s*calc\(var\(--lobby-semantic-long\)\s*\*\s*0\.01\),\s*0\.56rem\);/)
  assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*\.top-icon span\s*\{[\s\S]*width:\s*clamp\(20px,\s*calc\(var\(--lobby-semantic-long\)\s*\*\s*0\.03\),\s*26px\);/)
  assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*\.currency-pill,\s*[\s\S]*\.top-action-dot,\s*[\s\S]*\.top-action-ring\s*\{[\s\S]*width:\s*clamp\(30px,\s*calc\(var\(--lobby-semantic-long\)\s*\*\s*0\.05\),\s*42px\);/)
  assert.match(css, /\.currency-pill\s*\{[\s\S]*display:\s*inline-flex;[\s\S]*justify-content:\s*center;/)
  assert.match(css, /\.top-action-dot,\s*[\s\S]*\.top-action-ring\s*\{[\s\S]*display:\s*inline-flex !important;[\s\S]*justify-content:\s*center;/)
  assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*\.lobby-left-rail,\s*[\s\S]*\.lobby-right-rail\s*\{[\s\S]*width:\s*clamp\(24px,\s*calc\(var\(--lobby-semantic-long\)\s*\*\s*0\.05\),\s*42px\);/)
  assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*\.rail-btn,\s*[\s\S]*\.vertical-pill,\s*[\s\S]*\.rail-logout\s*\{[\s\S]*min-height:\s*clamp\(40px,\s*calc\(var\(--lobby-semantic-short\)\s*\*\s*0\.12\),\s*62px\);/)
  assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*\.floating-coin\s*\{[\s\S]*right:\s*clamp\(4px,\s*calc\(var\(--lobby-semantic-long\)\s*\*\s*0\.01\),\s*14px\);[\s\S]*bottom:\s*clamp\(36px,\s*calc\(var\(--lobby-semantic-short\)\s*\*\s*0\.1\),\s*72px\);/)
  assert.doesNotMatch(css, /body\.layout-landscape\.pointer-coarse\.viewport-portrait \.lobby-shell\s*\{[\s\S]*rotate\(90deg\)/)
  assert.match(css, /body\.layout-landscape\.pointer-coarse\.viewport-portrait #lobby-panel\s*\{/)
  assert.match(css, /body\.layout-landscape\.pointer-coarse\.viewport-portrait \.lobby-shell\s*\{[\s\S]*width:\s*var\(--lobby-semantic-long\);[\s\S]*height:\s*var\(--lobby-semantic-short\);[\s\S]*min-height:\s*var\(--lobby-semantic-short\);/)
  assert.doesNotMatch(css, /body\.layout-landscape\.pointer-coarse\.viewport-portrait \.lobby-stage\s*\{/)
  assert.doesNotMatch(css, /body\.layout-landscape\.pointer-coarse\.viewport-portrait \.lobby-card-grid\s*\{/)
  assert.doesNotMatch(css, /body\.layout-landscape\.pointer-coarse\.viewport-portrait \.lobby-header-row\s*\{/)
  assert.doesNotMatch(css, /body\.layout-landscape\.pointer-coarse\.viewport-portrait \.lobby-profile-mini\s*\{/)
  assert.doesNotMatch(css, /body\.layout-landscape\.pointer-coarse\.viewport-portrait \.currency-pill,\s*[\s\S]*\.top-action-dot,\s*[\s\S]*\.top-action-ring\s*\{/)
  assert.doesNotMatch(css, /body\.layout-landscape\.pointer-coarse\.viewport-portrait \.floating-coin\s*\{/)
  assert.doesNotMatch(css, /body\.layout-landscape\.pointer-coarse\.viewport-portrait \.lobby-left-rail,\s*[\s\S]*\.lobby-right-rail\s*\{/)
  assert.doesNotMatch(css, /body\.layout-landscape\.pointer-coarse\.viewport-portrait \.rail-btn,\s*[\s\S]*\.vertical-pill,\s*[\s\S]*\.rail-logout\s*\{/)

  const coarseLobbyBlock = css.match(/@media \(pointer: coarse\)\s*\{([\s\S]*?)\}\s*body\.layout-landscape\.pointer-coarse\.viewport-portrait #auth-panel/)?.[1] ?? ''
  const lobbyScopedBlock = coarseLobbyBlock.slice(coarseLobbyBlock.indexOf('#lobby-panel'))
  const normalizedLobbyBlock = lobbyScopedBlock.replace(/100vw|100vh/g, '')
  assert.doesNotMatch(normalizedLobbyBlock, /\b\d+(?:\.\d+)?(?:vw|vh)\b/)
})

test('desktop width breakpoints are scoped away from coarse-pointer mobile semantics', () => {
  const css = fs.readFileSync(new URL('./style.css', import.meta.url), 'utf8')

  assert.match(css, /@media \(max-width: 1180px\) and \(pointer: fine\)/)
  assert.match(css, /@media \(max-width: 980px\) and \(pointer: fine\)/)
  assert.match(css, /@media \(max-width: 720px\) and \(pointer: fine\)/)
  assert.doesNotMatch(css, /@media \(max-width: 1180px\)\s*\{/)
  assert.doesNotMatch(css, /@media \(max-width: 980px\)\s*\{/)
  assert.doesNotMatch(css, /@media \(max-width: 720px\)\s*\{/)
})

test('auth flow uses a dedicated mobile page shell without sharing lobby layout rules', () => {
  const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8')
  const css = fs.readFileSync(new URL('./style.css', import.meta.url), 'utf8')

  assert.match(html, /id="auth-panel" class="panel"/)
  assert.match(html, /class="auth-shell"/)
  assert.match(html, /class="auth-stage"/)
  assert.match(html, /class="auth-brand"/)
  assert.match(html, /class="auth-card"/)
  assert.match(html, /class="auth-form"/)

  assert.match(css, /#auth-panel\s*\{[\s\S]*width:\s*100vw;[\s\S]*height:\s*100vh;/)
  assert.match(css, /\.auth-shell\s*\{[\s\S]*min-height:\s*100vh;/)
  assert.match(css, /\.auth-stage\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(320px, 420px\);/)
  assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*#auth-panel\s*\{[\s\S]*width:\s*100vw;[\s\S]*height:\s*100vh;/)
  assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*\.auth-stage\s*\{[\s\S]*display:\s*flex;[\s\S]*flex-direction:\s*row;/)
  assert.doesNotMatch(css, /body\.layout-landscape\.pointer-coarse\.viewport-portrait \.auth-shell\s*\{[\s\S]*rotate\(90deg\)/)

  assert.doesNotMatch(css, /#login-form,\s*#register-form,\s*#lobby-panel/)
})

test('auth flow shares the same semantic long-short sizing model across phone holds', () => {
  const css = fs.readFileSync(new URL('./style.css', import.meta.url), 'utf8')

  assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*#auth-panel\s*\{[\s\S]*--auth-semantic-long:\s*100vw;[\s\S]*--auth-semantic-short:\s*100vh;/)
  assert.match(css, /body\.layout-landscape\.pointer-coarse\.viewport-portrait #auth-panel\s*\{[\s\S]*--auth-semantic-long:\s*100vh;[\s\S]*--auth-semantic-short:\s*100vw;/)
  assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*\.auth-stage\s*\{[\s\S]*width:\s*100%;[\s\S]*min-height:\s*100%;[\s\S]*display:\s*flex;[\s\S]*flex-direction:\s*row;/)
  assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*\.auth-brand-ball\s*\{[\s\S]*width:\s*clamp\(48px,\s*calc\(var\(--auth-semantic-short\)\s*\*\s*0\.14\),\s*72px\);[\s\S]*height:\s*clamp\(48px,\s*calc\(var\(--auth-semantic-short\)\s*\*\s*0\.14\),\s*72px\);/)
  assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*\.auth-card\s*\{[\s\S]*width:\s*clamp\(240px,\s*calc\(var\(--auth-semantic-long\)\s*\*\s*0\.42\),\s*420px\);/)
  assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*#auth-panel input,\s*[\s\S]*#auth-panel button\s*\{[\s\S]*min-height:\s*clamp\(40px,\s*calc\(var\(--auth-semantic-short\)\s*\*\s*0\.12\),\s*56px\);/)

  const coarseAuthBlock = css.match(/@media \(pointer: coarse\)\s*\{([\s\S]*?)\}\s*body\.layout-landscape\.pointer-coarse\.viewport-portrait #auth-panel/)?.[1] ?? ''
  const authScopedBlock = coarseAuthBlock.slice(coarseAuthBlock.indexOf('#auth-panel'))
  const normalizedAuthBlock = authScopedBlock.replace(/100vw|100vh|100dvw|100dvh/g, '')
  assert.doesNotMatch(normalizedAuthBlock, /\b\d+(?:\.\d+)?(?:vw|vh)\b/)
})

test('main entry delegates auth and lobby concerns to dedicated ui modules', () => {
  const source = fs.readFileSync(new URL('./main.js', import.meta.url), 'utf8')

  assert.match(source, /from '\.\/src\/ui\/overlay-views\.js'/)
  assert.match(source, /from '\.\/src\/ui\/auth-controller\.js'/)
  assert.match(source, /from '\.\/src\/ui\/lobby-controller\.js'/)
  assert.match(source, /function startMatchmaking\(requestedRoomId = ''\)/)
  assert.match(source, /bindAuthActions\(\{/)
  assert.match(source, /bindLobbyActions\(\{/)
  assert.match(source, /showLobbyView\(\)/)
})

test('main entry supports a dev URL flag for direct play view access', () => {
  const source = fs.readFileSync(new URL('./main.js', import.meta.url), 'utf8')

  assert.match(source, /const devView = urlParams\.get\('dev'\)/)
  assert.match(source, /if \(devView === 'play'\) \{/)
  assert.match(source, /showGameView\(\)/)
  assert.match(source, /if \(!window\.game\) \{\s*window\.game = bootstrapGame\(\);\s*\}/s)
  assert.match(source, /window\.game\.updateUI\(\)/)
})

test('matchmaking keeps lobby as backdrop and exposes a dedicated status dialog contract', () => {
  const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8')
  const css = fs.readFileSync(new URL('./style.css', import.meta.url), 'utf8')
  const overlays = fs.readFileSync(new URL('./src/ui/overlay-views.js', import.meta.url), 'utf8')

  assert.match(html, /id="matchmaking-panel" class="panel hidden"/)
  assert.match(html, /class="matchmaking-backdrop"/)
  assert.match(html, /class="matchmaking-shell"/)
  assert.match(html, /class="matchmaking-dialog"/)
  assert.match(html, /class="matchmaking-stage"/)
  assert.match(html, /class="matchmaking-status-pane"/)
  assert.match(html, /class="matchmaking-side-pane"/)
  assert.match(html, /id="matchmaking-badge"/)
  assert.match(html, /id="matchmaking-title"/)
  assert.match(html, /id="match-status"/)
  assert.match(html, /id="current-room-display"/)
  assert.match(html, /id="room-id-val"/)
  assert.match(html, /id="btn-copy-room"/)
  assert.match(html, /id="btn-cancel"/)

  assert.match(overlays, /showMatchmakingView\(message = '正在寻找对手\.\.\.', options = \{\}\)/)
  assert.match(overlays, /lobbyPanel\?\.classList\.remove\('hidden'\)/)
  assert.match(overlays, /matchmakingPanel\?\.classList\.remove\('hidden'\)/)

  assert.match(css, /#matchmaking-panel/)
  assert.match(css, /\.matchmaking-backdrop/)
  assert.match(css, /\.matchmaking-shell/)
  assert.match(css, /\.matchmaking-dialog/)
  assert.match(css, /\.matchmaking-stage/)
  assert.match(css, /\.matchmaking-status-pane/)
  assert.match(css, /\.matchmaking-side-pane/)
  assert.match(css, /\.matchmaking-room-card/)
  assert.match(css, /\.matchmaking-actions/)
  assert.match(css, /\.matchmaking-stage\s*\{[\s\S]*display:\s*grid;[\s\S]*grid-template-columns:\s*minmax\(0,\s*1\.35fr\)\s*minmax\(280px,\s*0\.9fr\);/)
  assert.match(css, /body\.layout-landscape\.pointer-coarse #matchmaking-panel\s*\{[\s\S]*width:\s*100vw;[\s\S]*height:\s*100vh;/)
  assert.match(css, /body\.layout-landscape\.pointer-coarse \.matchmaking-shell\s*\{[\s\S]*width:\s*100vw;[\s\S]*height:\s*100vh;/)
  assert.match(css, /body\.layout-landscape\.pointer-coarse \.matchmaking-dialog\s*\{[\s\S]*width:\s*clamp\(260px,\s*calc\(var\(--matchmaking-semantic-long\)\s*\*\s*0\.72\),\s*760px\);/)
  assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*#matchmaking-panel\s*\{[\s\S]*width:\s*100vw;[\s\S]*height:\s*100vh;/)
  assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*\.matchmaking-shell\s*\{[\s\S]*width:\s*100vw;[\s\S]*height:\s*100vh;/)
  assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*\.matchmaking-dialog\s*\{[\s\S]*width:\s*clamp\(260px,\s*calc\(var\(--matchmaking-semantic-long\)\s*\*\s*0\.72\),\s*760px\);/)
  assert.match(css, /body\.layout-landscape\.pointer-coarse\.viewport-portrait \.matchmaking-shell\s*\{[\s\S]*position:\s*absolute;[\s\S]*left:\s*50%;[\s\S]*top:\s*50%;[\s\S]*width:\s*var\(--matchmaking-semantic-long\);[\s\S]*height:\s*var\(--matchmaking-semantic-short\);[\s\S]*transform:\s*translate\(-50%,\s*-50%\)\s*rotate\(90deg\);/)
  assert.match(css, /body\.layout-landscape\.pointer-coarse\.viewport-portrait #lobby-panel\s*\{[\s\S]*position:\s*absolute;[\s\S]*left:\s*50%;[\s\S]*top:\s*50%;[\s\S]*width:\s*var\(--lobby-semantic-long\);[\s\S]*height:\s*var\(--lobby-semantic-short\);[\s\S]*transform:\s*translate\(-50%,\s*-50%\)\s*rotate\(90deg\);/)
  assert.doesNotMatch(css, /body\.layout-landscape\.pointer-coarse\.viewport-portrait \.matchmaking-dialog\s*\{/)
  assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*\.matchmaking-stage\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1\.35fr\)\s*minmax\(220px,\s*0\.92fr\);/)
  assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*\.matchmaking-status-pane\s*\{[\s\S]*padding:\s*clamp\(14px,\s*calc\(var\(--matchmaking-semantic-short\)\s*\*\s*0\.05\),\s*24px\);/)
  assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*\.matchmaking-spinner-wrap\s*\{[\s\S]*width:\s*clamp\(54px,\s*calc\(var\(--matchmaking-semantic-short\)\s*\*\s*0\.18\),\s*92px\);/)
  assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*#match-status\s*\{[\s\S]*font-size:\s*clamp\(0\.8rem,\s*calc\(var\(--matchmaking-semantic-short\)\s*\*\s*0\.03\),\s*1rem\);/)
  assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*\.matchmaking-primary-action\s*\{[\s\S]*min-width:\s*clamp\(96px,\s*calc\(var\(--matchmaking-semantic-long\)\s*\*\s*0\.18\),\s*148px\);/)
})

test('matchmaking shares the same semantic long-short sizing model across phone holds', () => {
  const css = fs.readFileSync(new URL('./style.css', import.meta.url), 'utf8')

  assert.match(css, /body\.layout-landscape\.pointer-coarse #matchmaking-panel\s*\{[\s\S]*--matchmaking-semantic-long:\s*100vw;[\s\S]*--matchmaking-semantic-short:\s*100vh;/)
  assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*#matchmaking-panel\s*\{[\s\S]*--matchmaking-semantic-long:\s*100vw;[\s\S]*--matchmaking-semantic-short:\s*100vh;/)
  assert.match(css, /body\.layout-landscape\.pointer-coarse\.viewport-portrait #matchmaking-panel\s*\{[\s\S]*--matchmaking-semantic-long:\s*100vh;[\s\S]*--matchmaking-semantic-short:\s*100vw;/)
  assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*\.matchmaking-dialog\s*\{[\s\S]*width:\s*clamp\(260px,\s*calc\(var\(--matchmaking-semantic-long\)\s*\*\s*0\.72\),\s*760px\);/)
  assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*\.matchmaking-stage\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1\.35fr\)\s*minmax\(220px,\s*0\.92fr\);/)
  assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*\.matchmaking-status-pane\s*\{[\s\S]*padding:\s*clamp\(14px,\s*calc\(var\(--matchmaking-semantic-short\)\s*\*\s*0\.05\),\s*24px\);/)
  assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*\.matchmaking-spinner-wrap\s*\{[\s\S]*width:\s*clamp\(54px,\s*calc\(var\(--matchmaking-semantic-short\)\s*\*\s*0\.18\),\s*92px\);/)
  assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*#match-status\s*\{[\s\S]*font-size:\s*clamp\(0\.8rem,\s*calc\(var\(--matchmaking-semantic-short\)\s*\*\s*0\.03\),\s*1rem\);/)
  assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*\.matchmaking-primary-action\s*\{[\s\S]*min-width:\s*clamp\(96px,\s*calc\(var\(--matchmaking-semantic-long\)\s*\*\s*0\.18\),\s*148px\);/)
  assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*\.matchmaking-actions\s*\{[\s\S]*flex-direction:\s*column;[\s\S]*align-items:\s*stretch;/)
  assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*\.matchmaking-footnote\s*\{[\s\S]*max-width:\s*none;[\s\S]*text-align:\s*left;/)

  const coarseMatchBlock = css.match(/@media \(pointer: coarse\)\s*\{([\s\S]*?)\}\s*body\.layout-landscape\.pointer-coarse\.viewport-portrait #auth-panel/)?.[1] ?? ''
  const matchScopedBlock = coarseMatchBlock.slice(coarseMatchBlock.indexOf('#matchmaking-panel'))
  const normalizedMatchBlock = matchScopedBlock.replace(/100vw|100vh|100dvw|100dvh/g, '')
  assert.doesNotMatch(normalizedMatchBlock, /\b\d+(?:\.\d+)?(?:vw|vh)\b/)
})

test('portrait coarse matchmaking dialog fits the physical viewport and collapses to one column', () => {
  const css = fs.readFileSync(new URL('./style.css', import.meta.url), 'utf8')

  assert.match(css, /body\.layout-landscape\.pointer-coarse\.viewport-portrait \.matchmaking-shell\s*\{[\s\S]*position:\s*absolute;[\s\S]*left:\s*50%;[\s\S]*top:\s*50%;[\s\S]*width:\s*var\(--matchmaking-semantic-long\);[\s\S]*height:\s*var\(--matchmaking-semantic-short\);[\s\S]*transform-origin:\s*center center;[\s\S]*transform:\s*translate\(-50%,\s*-50%\)\s*rotate\(90deg\);/)
  assert.doesNotMatch(css, /body\.layout-landscape\.pointer-coarse\.viewport-portrait \.matchmaking-dialog\s*\{/)
  assert.doesNotMatch(css, /body\.layout-landscape\.pointer-coarse\.viewport-portrait \.matchmaking-stage\s*\{/)
  assert.doesNotMatch(css, /body\.layout-landscape\.pointer-coarse\.viewport-portrait \.matchmaking-actions\s*\{/)
})

test('gameplay uses the same semantic long-short sizing model across phone holds', () => {
  const css = fs.readFileSync(new URL('./style.css', import.meta.url), 'utf8')
  const uiSource = fs.readFileSync(new URL('./src/ui/dom-ui.js', import.meta.url), 'utf8')
  const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8')
  const layoutSource = fs.readFileSync(new URL('./src/layout/mode.js', import.meta.url), 'utf8')
  const gameSource = fs.readFileSync(new URL('./src/game.js', import.meta.url), 'utf8')
  const tableRendererSource = fs.readFileSync(new URL('./src/render/table-renderer.js', import.meta.url), 'utf8')

  assert.match(html, /id="header-ui"/)
  assert.match(html, /id="network-indicator"/)
  assert.match(html, /id="player1-score"/)
  assert.match(html, /id="player2-score"/)
  assert.match(html, /id="btn-leave-room"/)
  assert.match(html, /id="btn-audio-toggle"/)
  assert.match(html, /class="gameplay-side-panel gameplay-side-panel-left"/)
  assert.match(html, /class="gameplay-side-panel gameplay-side-panel-right"/)
  assert.match(html, /class="player-avatar"/)
  assert.match(html, /class="player-side-track"/)
  assert.match(html, /id="p1-side-timer"/)
  assert.match(html, /id="p2-side-timer"/)
  assert.doesNotMatch(html, /class="hud-center-slot"/)
  assert.doesNotMatch(html, /id="center-turn-timer"/)
  assert.doesNotMatch(html, /class="player-summary"/)
  assert.doesNotMatch(html, /class="player-meta"/)
  assert.doesNotMatch(html, /id="p1-status"/)
  assert.doesNotMatch(html, /id="p2-status"/)
  assert.doesNotMatch(html, /class="score-val"/)
  assert.doesNotMatch(html, /class="group-indicator"/)
  assert.match(html, /id="game-container"/)
  assert.match(html, /id="game-canvas"/)

  assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*#app-wrapper\s*\{[\s\S]*--gameplay-semantic-long:\s*100vw;[\s\S]*--gameplay-semantic-short:\s*100vh;/)
  assert.match(css, /body\.layout-landscape\.pointer-coarse\.viewport-portrait #app-wrapper\s*\{[\s\S]*--gameplay-semantic-long:\s*100vh;[\s\S]*--gameplay-semantic-short:\s*100vw;[\s\S]*position:\s*absolute;[\s\S]*left:\s*50%;[\s\S]*top:\s*50%;[\s\S]*width:\s*var\(--gameplay-semantic-long\);[\s\S]*height:\s*var\(--gameplay-semantic-short\);[\s\S]*transform:\s*translate\(-50%,\s*-50%\)\s*rotate\(90deg\);/)
  assert.doesNotMatch(html, /id="rotate-device-overlay"/)
  assert.doesNotMatch(css, /#rotate-device-overlay\s*\{/)
  assert.doesNotMatch(css, /body\.layout-landscape\.pointer-coarse\.viewport-portrait #ui-layer,\s*[\s\S]*#app-wrapper\s*\{[\s\S]*visibility:\s*hidden;/)
  assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*#header-ui\s*\{[\s\S]*height:\s*clamp\(52px,\s*calc\(var\(--gameplay-semantic-short\)\s*\*\s*0\.11\),\s*72px\);/)
  assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*#game-container\s*\{[\s\S]*padding-top:\s*clamp\(56px,\s*calc\(var\(--gameplay-semantic-short\)\s*\*\s*0\.12\),\s*78px\);/)
  assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*\.hud-center-slot\s*\{[\s\S]*position:\s*absolute;[\s\S]*left:\s*50%;[\s\S]*z-index:\s*3;/)
  assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*\.side-score-box\s*\{[\s\S]*width:\s*clamp\(50px,\s*calc\(var\(--gameplay-semantic-long\)\s*\*\s*0\.07\),\s*72px\);/)
  assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*\.turn-timer\s*\{[\s\S]*min-width:\s*clamp\(32px,\s*calc\(var\(--gameplay-semantic-short\)\s*\*\s*0\.1\),\s*52px\);/)
  assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*\.mini-ball\s*\{[\s\S]*width:\s*clamp\(10px,\s*calc\(var\(--gameplay-semantic-short\)\s*\*\s*0\.032\),\s*16px\);/)
  assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*\.player-name\s*\{[\s\S]*writing-mode:\s*vertical-rl;/)

  assert.match(uiSource, /const shouldUseSideBySideHud = true/)
  assert.doesNotMatch(uiSource, /const isPortrait = window\.innerWidth < window\.innerHeight/)

  assert.match(layoutSource, /export function shouldRotateGameplayStage\(doc = globalThis\.document, win = globalThis\.window\)/)
  assert.match(layoutSource, /export function shouldRemapGameplayInput\(doc = globalThis\.document, win = globalThis\.window\)/)
  assert.match(layoutSource, /return isLandscapeSemanticMobile \? false : isPortraitLayout\(win\)/)
  assert.match(gameSource, /import \{ isPortraitLayout, shouldRemapGameplayInput, shouldRotateGameplayStage \} from '\.\/layout\/mode\.js'/)
  assert.match(gameSource, /const isPortrait = shouldRotateGameplayStage\(document, window\)/)
  assert.match(gameSource, /const shouldRemapInput = shouldRemapGameplayInput\(document, window\)/)
  assert.match(tableRendererSource, /import \{ isPortraitLayout, shouldRotateGameplayStage \} from '\.\.\/layout\/mode\.js'/)
  assert.match(tableRendererSource, /const isPortrait = shouldRotateGameplayStage\(document, window\)/)
})

test('portrait coarse-pointer viewports keep the landscape-semantic UI visible without a rotate prompt', () => {
  const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8')
  const css = fs.readFileSync(new URL('./style.css', import.meta.url), 'utf8')

  assert.doesNotMatch(html, /id="rotate-device-overlay"/)
  assert.doesNotMatch(html, /请横屏使用/)
  assert.doesNotMatch(css, /#rotate-device-overlay\s*\{/)
  assert.doesNotMatch(css, /body\.layout-landscape\.pointer-coarse\.viewport-portrait #ui-layer,\s*[\s\S]*#app-wrapper\s*\{[\s\S]*visibility:\s*hidden;[\s\S]*pointer-events:\s*none;/)
  assert.match(css, /body\.layout-landscape\.pointer-coarse\.viewport-portrait #app-wrapper\s*\{[\s\S]*transform:\s*translate\(-50%,\s*-50%\)\s*rotate\(90deg\);/)
})

test('gameplay fits table cloth first and treats rail thickness as a separate visual layer', () => {
  const gameSource = fs.readFileSync(new URL('./src/game.js', import.meta.url), 'utf8')
  const rendererSource = fs.readFileSync(new URL('./src/render/pixi-renderer.js', import.meta.url), 'utf8')

  assert.match(gameSource, /const baseWidth = isPortrait \? TABLE_HEIGHT : TABLE_WIDTH;/)
  assert.match(gameSource, /const baseHeight = isPortrait \? TABLE_WIDTH : TABLE_HEIGHT;/)
  assert.match(gameSource, /const railVisualPx = Math\.max\(10, Math\.min\(Math\.min\(availableWidth, availableHeight\) \* 0\.026, 18\)\)/)
  assert.match(gameSource, /const semanticGameplayInset = isSemanticMobileGameplay\s*\?\s*Math\.max\(1,\s*Math\.min\(Math\.min\(availableWidth,\s*availableHeight\)\s*\*\s*0\.002,\s*3\)\)\s*:\s*null/)
  assert.match(gameSource, /const uiPaddingX = isSemanticMobileGameplay\s*\?\s*railVisualPx \* 2 \+ semanticGameplayInset/)
  assert.match(gameSource, /const uiPaddingY = isSemanticMobileGameplay\s*\?\s*railVisualPx \* 2 \+ semanticGameplayInset/)
  assert.match(gameSource, /const fittedScale = Math\.min\(usableWidth \/ baseWidth, usableHeight \/ baseHeight\);/)
  assert.match(gameSource, /this\.renderer\.resize\(availableWidth, availableHeight, dpr, fittedScale, isPortrait, railVisualPx\);/)

  assert.match(rendererSource, /this\.visualRailThickness = RAIL_THICKNESS;/)
  assert.match(rendererSource, /resize\(availableWidth, availableHeight, dpr, fittedScale, isPortrait, railVisualPx\)/)
  assert.match(rendererSource, /this\.visualRailThickness = fittedScale > 0 \? railVisualPx \/ fittedScale : RAIL_THICKNESS;/)
  assert.match(rendererSource, /const borderW = TABLE_WIDTH \+ this\.visualRailThickness \* 2;/)
  assert.match(rendererSource, /const borderH = TABLE_HEIGHT \+ this\.visualRailThickness \* 2;/)
})

test('debug rolling area overlay marks the playable cloth bounds in the pixi renderer', () => {
  const rendererSource = fs.readFileSync(new URL('./src/render/pixi-renderer.js', import.meta.url), 'utf8')

  assert.match(rendererSource, /const rollAreaX = -TABLE_WIDTH \/ 2 \+ BALL_RADIUS;/)
  assert.match(rendererSource, /const rollAreaY = -TABLE_HEIGHT \/ 2 \+ BALL_RADIUS;/)
  assert.match(rendererSource, /const rollAreaWidth = TABLE_WIDTH - BALL_RADIUS \* 2;/)
  assert.match(rendererSource, /const rollAreaHeight = TABLE_HEIGHT - BALL_RADIUS \* 2;/)
  assert.match(rendererSource, /rollArea\.beginFill\(0xff3b30,\s*0\.16\);/)
})

test('debug rolling area overlay marks the playable cloth bounds in the canvas fallback', () => {
  const canvasSource = fs.readFileSync(new URL('./src/render/table-renderer.js', import.meta.url), 'utf8')

  assert.match(canvasSource, /const rollAreaX = -TABLE_WIDTH \/ 2 \+ BALL_RADIUS/)
  assert.match(canvasSource, /const rollAreaY = -TABLE_HEIGHT \/ 2 \+ BALL_RADIUS/)
  assert.match(canvasSource, /const rollAreaWidth = TABLE_WIDTH - BALL_RADIUS \* 2/)
  assert.match(canvasSource, /const rollAreaHeight = TABLE_HEIGHT - BALL_RADIUS \* 2/)
  assert.match(canvasSource, /ctx\.fillStyle = 'rgba\(255,\s*59,\s*48,\s*0\.16\)'/)
})

test('gameplay top hud uses slim side rails around the centered timer instead of large corner cards', () => {
  const css = fs.readFileSync(new URL('./style.css', import.meta.url), 'utf8')

  assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*#game-container\s*\{[\s\S]*padding-top:\s*clamp\(56px,\s*calc\(var\(--gameplay-semantic-short\)\s*\*\s*0\.12\),\s*78px\);/)
  assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*\.gameplay-side-panel\s*\{[\s\S]*position:\s*absolute;[\s\S]*top:\s*50%;[\s\S]*transform:\s*translateY\(-50%\);/)
  assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*\.gameplay-side-panel-left\s*\{[\s\S]*left:\s*clamp\(6px,\s*calc\(var\(--gameplay-semantic-long\)\s*\*\s*0\.01\),\s*14px\);/)
  assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*\.gameplay-side-panel-right\s*\{[\s\S]*right:\s*clamp\(6px,\s*calc\(var\(--gameplay-semantic-long\)\s*\*\s*0\.01\),\s*14px\);/)
  assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*\.side-score-box\s*\{[\s\S]*width:\s*clamp\(50px,\s*calc\(var\(--gameplay-semantic-long\)\s*\*\s*0\.07\),\s*72px\);/)
  assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*\.side-score-box\s*\{[\s\S]*min-height:\s*clamp\(176px,\s*calc\(var\(--gameplay-semantic-short\)\s*\*\s*0\.48\),\s*288px\);/)
  assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*\.side-score-box\s*\{[\s\S]*flex-direction:\s*column !important;[\s\S]*align-items:\s*center;/)
  assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*\.player-avatar\s*\{[\s\S]*width:\s*clamp\(40px,\s*calc\(var\(--gameplay-semantic-short\)\s*\*\s*0\.11\),\s*54px\);/)
  assert.match(css, /\.network-indicator::before/)
  assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*\.room-tool-chip\s*\{[\s\S]*font-size:\s*clamp\(0\.48rem,\s*calc\(var\(--gameplay-semantic-short\)\s*\*\s*0\.016\),\s*0\.62rem\);/)
  assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*\.player-side-timer\s*\{[\s\S]*display:\s*flex;[\s\S]*writing-mode:\s*vertical-rl;/)
  assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*\.side-ball-list\s*\{[\s\S]*flex-direction:\s*column;[\s\S]*gap:\s*clamp\(4px,\s*calc\(var\(--gameplay-semantic-short\)\s*\*\s*0\.012\),\s*7px\);[\s\S]*background:\s*transparent;/)
  assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*\.player-ball-label\s*\{[\s\S]*writing-mode:\s*vertical-rl;/)
  assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*\.player-side-info-row\s*\{[\s\S]*display:\s*grid;[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/)
  assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*\.player-side-track\s*\{[\s\S]*display:\s*flex;[\s\S]*flex-direction:\s*column;/)
  assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*\.player-side-meta\s*\{[\s\S]*justify-content:\s*space-between;/)
})

test('club table realism render contract', () => {
  const rendererSource = fs.readFileSync(new URL('./src/render/pixi-renderer.js', import.meta.url), 'utf8')
  const tableRendererSource = fs.readFileSync(new URL('./src/render/table-renderer.js', import.meta.url), 'utf8')

  assert.match(rendererSource, /textures\.tableSurface = PIXI\.Texture\.from\('\.\/assets\/table-surface\.png'\);/)
  assert.match(rendererSource, /if \(!textures\.tableSurface\.baseTexture\.valid\) \{/)
  assert.match(rendererSource, /const tableSurface = new PIXI\.Sprite\(this\.textures\.tableSurface\);/)
  assert.match(rendererSource, /tableSurface\.width = borderW;/)
  assert.match(rendererSource, /tableSurface\.height = borderH;/)

  assert.match(tableRendererSource, /const tableSurfaceImage = typeof Image !== 'undefined' \? new Image\(\) : null/)
  assert.match(tableRendererSource, /if \(tableSurfaceImage\) \{\s*tableSurfaceImage\.src = '\.\/assets\/table-surface\.png'/)
  assert.match(tableRendererSource, /if \(tableSurfaceImage && tableSurfaceImage\.complete && tableSurfaceImage\.naturalWidth > 0\) \{/)
  assert.match(tableRendererSource, /ctx\.drawImage\(\s*tableSurfaceImage,/)
})

test('pixi renderer keeps a single cue overlay layer when redrawing the table', () => {
  const rendererSource = fs.readFileSync(new URL('./src/render/pixi-renderer.js', import.meta.url), 'utf8')

  assert.match(rendererSource, /resetUiOverlayLayers\(\)\s*\{/)
  assert.match(rendererSource, /if \(this\.dynamicGraphics\) \{\s*this\.dynamicGraphics\.destroy\(\);\s*this\.dynamicGraphics = null;\s*\}/)
  assert.match(rendererSource, /if \(this\.cueStickContainer\) \{\s*this\.cueStickContainer\.destroy\(\{ children: true \}\);\s*this\.cueStickContainer = null;\s*this\.cueStick = null;\s*\}/)
  assert.match(rendererSource, /createUiOverlayLayers\(\)\s*\{\s*this\.dynamicGraphics = new PIXI\.Graphics\(\);\s*this\.uiLayer\.addChild\(this\.dynamicGraphics\);\s*this\.cueStickContainer = new PIXI\.Container\(\);\s*this\.uiLayer\.addChild\(this\.cueStickContainer\);\s*this\.drawCueStickGraphics\(\);\s*\}/s)
  assert.match(rendererSource, /drawStaticTable\(\)\s*\{\s*this\.staticLayer\.removeChildren\(\);\s*this\.resetUiOverlayLayers\(\);/s)
})

test('game state snapshot accepts nested ballState.balls payloads from room sync', () => {
  const gameSource = fs.readFileSync(new URL('./src/game.js', import.meta.url), 'utf8')

  assert.match(gameSource, /const rawBallState = snapshot\.ballState \|\| snapshot\.balls \|\| \(snapshot\.room && snapshot\.room\.ballState\);/)
  assert.match(gameSource, /const ballsToApply = Array\.isArray\(rawBallState\)\s*\?\s*rawBallState\s*:\s*rawBallState\?\.balls;/)
  assert.match(gameSource, /if \(!ballsToApply \|\| !Array\.isArray\(ballsToApply\)\) return;/)
})

test('gameplay room layout splits tools top and players on short rails without a bottom control bar', () => {
  const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8')
  const css = fs.readFileSync(new URL('./style.css', import.meta.url), 'utf8')

  assert.match(html, /class="room-tools room-tools-left"/)
  assert.match(html, /class="room-tools room-tools-right"/)
  assert.match(html, /class="gameplay-side-panel gameplay-side-panel-left"/)
  assert.match(html, /class="gameplay-side-panel gameplay-side-panel-right"/)
  assert.match(html, /id="player1-score"/)
  assert.match(html, /id="player2-score"/)
  assert.match(html, /class="top-aim-strip"/)
  assert.match(html, /id="aim-strip-knob"/)
  assert.doesNotMatch(html, /class="hud-center-slot"/)
  assert.doesNotMatch(html, /class="hud-player-slot hud-player-slot-left"/)
  assert.doesNotMatch(html, /class="hud-player-slot hud-player-slot-right"/)
  assert.doesNotMatch(html, /class="table-power-strip"/)
  assert.doesNotMatch(html, /id="power-strip-fill"/)

  assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*\.gameplay-side-panel\s*\{[\s\S]*position:\s*absolute;[\s\S]*top:\s*50%;[\s\S]*transform:\s*translateY\(-50%\);/)
  assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*\.gameplay-side-panel-left\s*\{[\s\S]*left:\s*clamp\(/)
  assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*\.gameplay-side-panel-right\s*\{[\s\S]*right:\s*clamp\(/)
  assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*\.top-aim-strip\s*\{[\s\S]*width:\s*clamp\(170px,\s*calc\(var\(--gameplay-semantic-long\)\s*\*\s*0\.25\),\s*260px\);/)
  assert.match(css, /@media \(pointer: coarse\)\s*\{[\s\S]*#game-container\s*\{[\s\S]*padding-bottom:\s*clamp\(8px,\s*calc\(var\(--gameplay-semantic-short\)\s*\*\s*0\.03\),\s*18px\);/)
})
