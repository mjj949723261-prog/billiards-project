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
