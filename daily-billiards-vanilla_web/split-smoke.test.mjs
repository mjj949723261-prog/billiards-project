import test from 'node:test'
import assert from 'node:assert/strict'

import {
  BALL_RADIUS,
  TABLE_WIDTH,
  TABLE_HEIGHT,
} from './src/constants.js'
import { getAimGuide, getProjectedTravel, getWallAimDistance } from './src/core/aim.js'
import { updateGamePhysics } from './src/core/physics.js'
import { applyGroups, evaluateShot, switchTurn } from './src/core/rules.js'
import { BilliardsGame, bootstrapGame } from './src/game.js'
import { bindGameInput } from './src/input/bindings.js'
import { Vec2 } from './src/math.js'
import { Ball } from './src/entities/ball.js'
import { drawGame } from './src/render/table-renderer.js'

test('shared constants expose table dimensions', () => {
  assert.equal(BALL_RADIUS, 14)
  assert.equal(TABLE_WIDTH, 820)
  assert.equal(TABLE_HEIGHT, 410)
})

test('Vec2 supports vector math', () => {
  const point = new Vec2(3, 4)
  assert.equal(point.length(), 5)

  point.normalize()
  assert.ok(Math.abs(point.length() - 1) < 1e-9)
})

test('Ball initializes with position and can update friction', () => {
  const ball = new Ball(10, 20, '#ffffff')
  ball.vel = new Vec2(2, 0)
  ball.update()

  assert.ok(ball.pos.x > 10)
  assert.equal(ball.pos.y, 20)
})

test('aim helpers detect first ball hit before wall', () => {
  const cueBall = new Ball(0, 0, '#fff')
  const targetBall = new Ball(80, 0, '#f00')
  const guide = getAimGuide(cueBall, [cueBall, targetBall], new Vec2(1, 0))

  assert.equal(guide.type, 'ball')
  assert.equal(guide.ball, targetBall)
  assert.ok(guide.distance < getWallAimDistance(cueBall.pos, new Vec2(1, 0)))
})

test('projected travel is capped by table edges and explicit limits', () => {
  const horizontalTravel = getProjectedTravel(new Vec2(0, 0), new Vec2(1, 0), 999)
  const limitedTravel = getProjectedTravel(new Vec2(0, 0), new Vec2(1, 0), 120)

  assert.ok(horizontalTravel > 120)
  assert.equal(limitedTravel, 120)
})

test('renderer and input modules expose integration entry points', () => {
  assert.equal(typeof bindGameInput, 'function')
  assert.equal(typeof drawGame, 'function')
})

test('physics and rules modules expose integration entry points', () => {
  assert.equal(typeof updateGamePhysics, 'function')
  assert.equal(typeof applyGroups, 'function')
  assert.equal(typeof evaluateShot, 'function')
  assert.equal(typeof switchTurn, 'function')
})

test('game module exposes class and bootstrap entry point', () => {
  assert.equal(typeof BilliardsGame, 'function')
  assert.equal(typeof bootstrapGame, 'function')
})
