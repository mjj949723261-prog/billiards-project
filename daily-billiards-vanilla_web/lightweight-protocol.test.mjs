import test from 'node:test'
import assert from 'node:assert/strict'
import { Vec2 } from './src/math.js'
import { Ball } from './src/entities/ball.js'
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
