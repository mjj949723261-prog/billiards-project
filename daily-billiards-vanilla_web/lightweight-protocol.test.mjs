import test from 'node:test'
import assert from 'node:assert/strict'
import { Vec2 } from './src/math.js'
import { Ball } from './src/entities/ball.js'
import { getPocketCaptureProfile, getPocketMouthCenters, isBallCapturedByPocket } from './src/core/pocket-geometry.js'
import { getPocketVisualCenters } from './src/render/table-renderer.js'
import { 
  normalizeBallStateFromBalls, 
  buildBallStateHash, 
  createShotEndReport 
} from './src/network/shot-state.js'

test('Ball state normalization is deterministic', () => {
  const ball1 = new Ball(10.1234, 20.5678, '#fff', 'cue', 'cue')
  const ball2 = new Ball(30, 40, '#f00', 'solid', '1')
  
  const normalized = normalizeBallStateFromBalls([ball1, ball2])
  
  assert.equal(normalized.length, 2)
  assert.equal(normalized[0].id, 'cue:cue')
  assert.equal(normalized[0].x, 1012) // quantized
  assert.equal(normalized[1].id, 'solid:1')
  
  const hash1 = buildBallStateHash(normalized)
  const hash2 = buildBallStateHash(normalizeBallStateFromBalls([ball2, ball1])) // order should not matter
  
  assert.equal(hash1, hash2)
})

test('Shot end report captures physics state correctly', () => {
  const game = {
    turnId: 5,
    stateVersion: 12,
    shotToken: 'token-abc',
    isBreakShot: false,
    balls: [
        new Ball(0, 0, '#fff', 'cue', 'cue'),
        new Ball(100, 0, '#f00', 'solid', '1')
    ],
    shotState: {
        firstContact: { type: 'solid', label: '1' },
        pocketedBalls: [],
        cuePocketed: false,
        eightPocketed: false,
        railContacts: 2
    }
  }
  
  const report = createShotEndReport(game, 'shooter')
  
  assert.equal(report.turnId, 5)
  assert.equal(report.shotToken, 'token-abc')
  assert.equal(report.firstContactBallId, 'solid:1')
  assert.equal(report.railContacts, 2)
  assert.ok(report.finalStateHash.includes('cue:cue:0:0:0:0:0'))
})

test('Visual-Physical separation: renderPos follows physicsPos', () => {
  const ball = new Ball(0, 0, '#fff')
  ball.physicsPos.x = 100
  
  assert.equal(ball.renderPos.x, 0)
  
  ball.updateRender(0.5)
  assert.equal(ball.renderPos.x, 50)
  
  ball.updateRender(0.5)
  assert.equal(ball.renderPos.x, 75)
})

test('120Hz Physics: fixed timestep accumulation', async () => {
  globalThis.document = { getElementById: () => null };
  const { updateGamePhysics } = await import('./src/core/physics.js')
  const game = {
    balls: [new Ball(0, 0, '#fff')],
    pockets: [],
    physicsAccumulatorMs: 0,
    scorePocketEffects: [],
    updateTimerUI() {},
    getStatusText() { return '' },
    isMoving() { return true },
    evaluateShot() {}
  }
  
  const FIXED_TIMESTEP_MS = 1000 / 120
  
  // Simulate 16.67ms (60fps)
  updateGamePhysics(game, 16.67)
  
  // Should have executed 2 substeps (16.67 / 8.33 = 2)
  assert.ok(game.physicsAccumulatorMs < FIXED_TIMESTEP_MS)
  assert.ok(game.balls[0].physicsPos.x > 0 || game.balls[0].physicsVel.x === 0)
})

test('physics accumulator keeps leftover time instead of hard-capping long frames', async () => {
  globalThis.document = { getElementById: () => null }
  const { updateGamePhysics } = await import(`./src/core/physics.js?case=accumulator-${Date.now()}`)
  const game = {
    balls: [new Ball(0, 0, '#fff')],
    pockets: [],
    physicsAccumulatorMs: 0,
    scorePocketEffects: [],
    releaseFlash: 0,
    timeLeft: 10,
    wasMoving: false,
    isGameOver: false,
    updateTimerUI() {},
    getStatusText() { return '' },
    isMoving() { return false },
    evaluateShot() {},
  }

  updateGamePhysics(game, 120)

  assert.ok(game.physicsAccumulatorMs > 50)
  assert.ok(game.physicsAccumulatorMs < 60)
})

test('shot settlement can trigger from the physics step that stops the last moving ball', async () => {
  globalThis.document = { getElementById: () => null }
  const { updateGamePhysics } = await import(`./src/core/physics.js?case=settle-${Date.now()}`)
  const ball = new Ball(0, 0, '#fff')
  ball.vel = new Vec2(0.0105, 0)

  let evaluateCalls = 0
  const game = {
    balls: [ball],
    pockets: [],
    physicsAccumulatorMs: 1000 / 120,
    scorePocketEffects: [],
    releaseFlash: 0,
    timeLeft: 10,
    wasMoving: true,
    isGameOver: false,
    updateTimerUI() {},
    getStatusText() { return '' },
    isMoving() {
      return this.balls.some(currentBall => !currentBall.pocketed && currentBall.vel.length() > 0.01)
    },
    evaluateShot() { evaluateCalls += 1 },
  }

  updateGamePhysics(game, 0)

  assert.equal(evaluateCalls, 1)
  assert.equal(game.physicsAccumulatorMs, 0)
})

test('collision iterations keep resolving velocity for balls that are still overlapping', async () => {
  globalThis.document = { getElementById: () => null }
  const { updateGamePhysics } = await import(`./src/core/physics.js?case=collision-iterations-${Date.now()}`)
  const first = new Ball(-13.9, 0, '#fff', 'cue', 'cue')
  const second = new Ball(13.9, 0, '#f00', 'solid', '1')

  first.vel = new Vec2(1.2, 0)
  second.vel = new Vec2(-0.4, 0)

  const game = {
    balls: [second, first],
    cueBall: first,
    pockets: [],
    physicsAccumulatorMs: 1000 / 120,
    scorePocketEffects: [],
    releaseFlash: 0,
    timeLeft: 10,
    wasMoving: true,
    isGameOver: false,
    shotActive: true,
    shotState: { firstContact: null, railContacts: 0, pocketedBalls: [], cuePocketed: false, eightPocketed: false },
    audio: { playBallCollision() {}, playRailHit() {} },
    collisionEffects: [],
    updateTimerUI() {},
    getStatusText() { return '' },
    isMoving() {
      return this.balls.some(currentBall => !currentBall.pocketed && currentBall.vel.length() > 0.01)
    },
    evaluateShot() {},
  }

  updateGamePhysics(game, 0)

  assert.ok(first.vel.x < 0, `expected first ball to reverse, got ${first.vel.x}`)
  assert.ok(second.vel.x > 0, `expected second ball to move forward, got ${second.vel.x}`)
  assert.equal(game.shotState.firstContact, second)
})

test('cue-ball first contact resolves at the time of impact instead of leaving overlap behind', async () => {
  globalThis.document = { getElementById: () => null }
  const { updateGamePhysics } = await import(`./src/core/physics.js?case=cue-first-contact-${Date.now()}`)
  const cue = new Ball(0, 0, '#fff', 'cue', 'cue')
  const target = new Ball(29, 0, '#f00', 'solid', '1')

  cue.vel = new Vec2(4.5, 0)

  const game = {
    balls: [cue, target],
    cueBall: cue,
    pockets: [],
    physicsAccumulatorMs: 1000 / 120,
    scorePocketEffects: [],
    releaseFlash: 0,
    timeLeft: 10,
    wasMoving: true,
    isGameOver: false,
    shotActive: true,
    shotState: { firstContact: null, railContacts: 0, pocketedBalls: [], cuePocketed: false, eightPocketed: false },
    audio: { playBallCollision() {}, playRailHit() {} },
    collisionEffects: [],
    updateTimerUI() {},
    getStatusText() { return '' },
    isMoving() {
      return this.balls.some(ball => !ball.pocketed && ball.vel.length() > 0.01)
    },
    evaluateShot() {},
  }

  updateGamePhysics(game, 0)

  assert.ok(target.vel.x > 0, `expected target ball to start moving, got ${target.vel.x}`)
  assert.ok(target.pos.x - cue.pos.x >= 28, `expected balls to be separated after first contact, got distance ${target.pos.x - cue.pos.x}`)
  assert.ok(target.pos.x > 30, `expected target ball to advance using remaining time after impact, got ${target.pos.x}`)
  assert.equal(game.shotState.firstContact, target)
})

test('cue-ball first contact snaps cue and target render positions to the resolved physics positions', async () => {
  globalThis.document = { getElementById: () => null }
  const { updateGamePhysics } = await import(`./src/core/physics.js?case=cue-first-contact-render-${Date.now()}`)
  const cue = new Ball(0, 0, '#fff', 'cue', 'cue')
  const target = new Ball(29, 0, '#f00', 'solid', '1')

  cue.vel = new Vec2(4.5, 0)

  const game = {
    balls: [cue, target],
    cueBall: cue,
    pockets: [],
    physicsAccumulatorMs: 1000 / 120,
    scorePocketEffects: [],
    releaseFlash: 0,
    timeLeft: 10,
    wasMoving: true,
    isGameOver: false,
    shotActive: true,
    shotState: { firstContact: null, railContacts: 0, pocketedBalls: [], cuePocketed: false, eightPocketed: false },
    audio: { playBallCollision() {}, playRailHit() {} },
    collisionEffects: [],
    updateTimerUI() {},
    getStatusText() { return '' },
    isMoving() {
      return this.balls.some(ball => !ball.pocketed && ball.vel.length() > 0.01)
    },
    evaluateShot() {},
  }

  updateGamePhysics(game, 0)

  assert.equal(cue.renderPos.x, cue.pos.x)
  assert.equal(cue.renderPos.y, cue.pos.y)
  assert.equal(target.renderPos.x, target.pos.x)
  assert.equal(target.renderPos.y, target.pos.y)
})

test('balls that are only near the pocket lip do not pocket until they travel deeper into the pocket', async () => {
  globalThis.document = { getElementById: () => null }
  const { updateGamePhysics } = await import(`./src/core/physics.js?case=pocket-lip-${Date.now()}`)
  const mouth = getPocketMouthCenters()[1]
  const pocket = new Vec2(0, -189)
  const pockets = getPocketVisualCenters()

  const createGame = (ball) => ({
    balls: [ball],
    cueBall: ball,
    pockets,
    currentPlayer: 1,
    playerGroups: { 1: null, 2: null },
    physicsAccumulatorMs: 1000 / 120,
    scorePocketEffects: [],
    releaseFlash: 0,
    timeLeft: 10,
    wasMoving: false,
    isGameOver: false,
    shotActive: false,
    shotState: { firstContact: null, railContacts: 0, pocketedBalls: [], cuePocketed: false, eightPocketed: false },
    audio: { playBallCollision() {}, playRailHit() {}, playPocket() {} },
    collisionEffects: [],
    updateTimerUI() {},
    updateUI() {},
    setStatusMessage() {},
    getStatusText() { return '' },
    getLegalFirstTargetType() { return 'solid' },
    isMoving() {
      return this.balls.some(ball => !ball.pocketed && ball.vel.length() > 0.01)
    },
    evaluateShot() {},
  })

  const nearLipBall = new Ball(mouth.x, mouth.y - 1, '#f00', 'solid', '1')
  const deepBall = new Ball(mouth.x, mouth.y - 10, '#00f', 'solid', '2')

  updateGamePhysics(createGame(nearLipBall), 0)
  updateGamePhysics(createGame(deepBall), 0)

  assert.equal(nearLipBall.pocketed, false, 'expected a ball near the pocket lip to stay on the table')
  assert.equal(deepBall.pocketed, true, 'expected a deeper ball to still pocket')
})

test('pocket capture geometry requires crossing the mouth depth instead of only entering the radius', () => {
  const mouth = getPocketMouthCenters()[1]
  const pocket = new Vec2(0, -189)
  const nearLipPos = new Vec2(mouth.x, mouth.y - 1)
  const shallowSidePos = new Vec2(mouth.x, mouth.y - 5)
  const deepPos = new Vec2(mouth.x, mouth.y - 10)

  assert.equal(isBallCapturedByPocket(nearLipPos, pocket, 1), false)
  assert.equal(isBallCapturedByPocket(shallowSidePos, pocket, 1), false)
  assert.equal(isBallCapturedByPocket(deepPos, pocket, 1), true)
})

test('pocket capture geometry accepts balls that travel through the pocket jaw corridor before reaching the center', () => {
  const pocket = new Vec2(-375, -176)
  const profile = getPocketCaptureProfile(pocket, 0)
  const jawCorridorPos = profile.mouth
    .clone()
    .add(profile.axis.clone().mul(profile.mouthDepth + 2))
    .add(profile.tangent.clone().mul(profile.mouthHalfWidth - 1))

  assert.equal(isBallCapturedByPocket(jawCorridorPos, pocket, 0), true)
})

test('corner-pocket approach is not bounced back by rail collisions before pocket capture', async () => {
  globalThis.document = { getElementById: () => null }
  const { updateGamePhysics } = await import(`./src/core/physics.js?case=corner-pocket-rail-${Date.now()}`)
  const pockets = getPocketVisualCenters()
  const cornerPocket = pockets[0]
  const profile = getPocketCaptureProfile(cornerPocket, 0)
  const ball = new Ball(profile.mouth.x - 5, profile.mouth.y - 6, '#f00', 'solid', '1')
  ball.vel = new Vec2(-0.8, -0.8)

  const game = {
    balls: [ball],
    cueBall: ball,
    pockets,
    currentPlayer: 1,
    playerGroups: { 1: null, 2: null },
    physicsAccumulatorMs: 1000 / 120,
    scorePocketEffects: [],
    releaseFlash: 0,
    timeLeft: 10,
    wasMoving: true,
    isGameOver: false,
    shotActive: false,
    shotState: { firstContact: null, railContacts: 0, pocketedBalls: [], cuePocketed: false, eightPocketed: false },
    audio: { playBallCollision() {}, playRailHit() {}, playPocket() {} },
    collisionEffects: [],
    updateTimerUI() {},
    updateUI() {},
    setStatusMessage() {},
    getStatusText() { return '' },
    getLegalFirstTargetType() { return 'solid' },
    isMoving() {
      return this.balls.some(currentBall => !currentBall.pocketed && currentBall.vel.length() > 0.01)
    },
    evaluateShot() {},
  }

  updateGamePhysics(game, 0)

  assert.equal(ball.pocketed, true, 'expected corner-pocket approach to pocket instead of bouncing back')
})

test('pocketed balls keep a short visible pocket animation instead of disappearing immediately', async () => {
  globalThis.document = { getElementById: () => null }
  const { onBallPocketed, updateGamePhysics } = await import(`./src/core/physics.js?case=pocket-animation-${Date.now()}`)
  const ball = new Ball(0, 0, '#fff', 'cue', 'cue')
  const pocket = new Vec2(0, -189)
  const game = {
    balls: [ball],
    cueBall: ball,
    pockets: [pocket],
    currentPlayer: 1,
    playerGroups: { 1: null, 2: null },
    physicsAccumulatorMs: 0,
    scorePocketEffects: [],
    releaseFlash: 0,
    timeLeft: 10,
    wasMoving: false,
    isGameOver: false,
    isBreakShot: false,
    shotActive: false,
    shotState: { firstContact: null, railContacts: 0, pocketedBalls: [], cuePocketed: false, eightPocketed: false },
    audio: { playBallCollision() {}, playRailHit() {}, playPocket() {} },
    collisionEffects: [],
    updateTimerUI() {},
    updateUI() {},
    setStatusMessage() {},
    getStatusText() { return '' },
    getLegalFirstTargetType() { return 'solid' },
    isMoving() { return false },
    evaluateShot() {},
  }

  onBallPocketed(game, ball, pocket)

  assert.equal(ball.pocketed, true)
  assert.equal(ball.isPocketAnimationVisible(), true)

  updateGamePhysics(game, 80)

  assert.equal(ball.isPocketAnimationVisible(), true)
  assert.ok(ball.renderPocketAlpha < 1 && ball.renderPocketAlpha > 0)
  assert.ok(ball.renderPocketScale < 1 && ball.renderPocketScale > 0.2)
})

test('all pocketed balls trigger the shared pocket fireworks effect', async () => {
  globalThis.document = { getElementById: () => null }
  const { onBallPocketed } = await import(`./src/core/physics.js?case=shared-pocket-effect-${Date.now()}`)
  const cueBall = new Ball(0, 0, '#fff', 'cue', 'cue')
  const objectBall = new Ball(10, 0, '#f00', 'solid', '1')
  const pocket = new Vec2(0, -189)

  const createGame = () => ({
    balls: [cueBall, objectBall],
    cueBall,
    pockets: [pocket],
    currentPlayer: 1,
    playerGroups: { 1: null, 2: null },
    scorePocketEffects: [],
    shotState: { firstContact: null, railContacts: 0, pocketedBalls: [], cuePocketed: false, eightPocketed: false },
    isBreakShot: false,
    audio: { playBallCollision() {}, playRailHit() {}, playPocket() {} },
    collisionEffects: [],
    updateUI() {},
    setStatusMessage() {},
    getLegalFirstTargetType() { return 'solid' },
  })

  const cueGame = createGame()
  onBallPocketed(cueGame, cueBall, pocket)
  assert.equal(cueGame.scorePocketEffects.length, 1)

  const objectGame = createGame()
  onBallPocketed(objectGame, objectBall, pocket)
  assert.equal(objectGame.scorePocketEffects.length, 1)
})
