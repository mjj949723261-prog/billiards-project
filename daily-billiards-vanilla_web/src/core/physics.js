/**
 * @file physics.js
 * @description 处理游戏的物理模拟，包括球体运动、球与球碰撞、
 * 球与库边碰撞的检测与响应，以及进球检测。
 */

import {
  BALL_BOUNCE,
  BALL_RADIUS,
  FIXED_TIMESTEP_MS,
  MAX_PHYSICS_STEPS_PER_FRAME,
  PLAYABLE_AREA_INSET,
  POCKET_RADIUS,
  POCKET_SCORE_EFFECT_DURATION,
  TABLE_HEIGHT,
  TABLE_WIDTH,
  TURN_TIME_LIMIT,
  VELOCITY_THRESHOLD,
  WALL_BOUNCE,
} from '../constants.js?v=20260429-room-entry-fix'
import { Vec2 } from '../math.js'
import { evaluateShot } from './rules.js'

const DEBUG_JITTER = typeof window !== 'undefined' && window.location.hash.includes('debug-jitter')
const BASE_FRAME_MS = 1000 / 60
const COLLISION_ITERATIONS = 6
const POSITION_CORRECTION = 0.68
const POSITION_SLOP = 0.02

function hasMovingBall(balls) {
  return balls.some(ball => {
    if (ball.pocketed) return false
    const velocity = ball.physicsVel || ball.vel
    return velocity.length() > VELOCITY_THRESHOLD
  })
}

/**
 * 更新单帧的游戏物理状态。
 * 编排球体位置更新、碰撞检测以及状态检查。
 * 
 * @param {BilliardsGame} game - 游戏实例。
 * @param {number} [frameMs=BASE_FRAME_MS] - 当前渲染帧耗时（毫秒）。
 */
export function updateGamePhysics(game, frameMs = BASE_FRAME_MS) {
  const active = game.balls.filter(ball => !ball.pocketed)
  const jitterStats = game.jitterStats || (game.jitterStats = {})
  const accumulatorBefore = typeof game.physicsAccumulatorMs === 'number' ? game.physicsAccumulatorMs : 0
  const frameBudgetMs = Math.max(0, frameMs)
  let movingBeforeStep = !!game.wasMoving

  if (game.shotActive && !jitterStats.shotPeakTracking) {
    jitterStats.shotPeakTracking = true
    jitterStats.shotPeakOverlap = 0
  } else if (!game.shotActive && jitterStats.shotPeakTracking) {
    jitterStats.shotPeakTracking = false
  }

  if (typeof game.physicsAccumulatorMs !== 'number') {
    game.physicsAccumulatorMs = 0
  }
  game.physicsAccumulatorMs += frameBudgetMs

  let substeps = 0
  let settledDuringPhysicsStep = false
  while (game.physicsAccumulatorMs >= FIXED_TIMESTEP_MS && substeps < MAX_PHYSICS_STEPS_PER_FRAME) {
    const dtScale = FIXED_TIMESTEP_MS / BASE_FRAME_MS

    active.forEach(ball => {
      ball.update(dtScale)
    })

    handleRailCollisions(game, active)
    handleBallCollisions(game, active)

    // 检查进球
    active.forEach(ball => {
      if (ball.pocketed) return
      game.pockets.forEach(pocket => {
        if (Vec2.distance(ball.physicsPos || ball.pos, pocket) < POCKET_RADIUS) {
          onBallPocketed(game, ball, pocket)
        }
      })
    })

    game.physicsAccumulatorMs -= FIXED_TIMESTEP_MS
    substeps++

    const movingAfterStep = hasMovingBall(active)
    if (movingBeforeStep && !movingAfterStep && !game.isGameOver) {
      settledDuringPhysicsStep = true
      movingBeforeStep = false
      game.physicsAccumulatorMs = 0
      game.evaluateShot()
      break
    }
    movingBeforeStep = movingAfterStep
  }

  if (DEBUG_JITTER) {
    jitterStats.lastPhysicsFrame = {
      frameMs,
      substeps,
      accumulatorBefore,
      accumulatorAfter: game.physicsAccumulatorMs,
      cappedAccumulator: false,
      collisionPairs: jitterStats.lastCollisionPairs || 0,
      maxOverlap: jitterStats.shotPeakOverlap || jitterStats.lastMaxOverlap || 0,
    }
  }

  const deltaSeconds = frameBudgetMs / 1000
  game.releaseFlash = Math.max(0, game.releaseFlash - deltaSeconds)

  // 更新进球得分动画的时间
  game.scorePocketEffects = game.scorePocketEffects
    .map(effect => ({ ...effect, age: effect.age + deltaSeconds }))
    .filter(effect => effect.age < effect.duration)
  
  // 时间耗尽逻辑
  if (game.timeLeft <= 0 && !game.isMoving()) {
    game.timeLeft = 0
  }

  // 当所有球停止移动时评估本轮结果
  if (!settledDuringPhysicsStep && game.wasMoving && !game.isMoving() && !game.isGameOver) {
    game.evaluateShot()
  }
  game.wasMoving = game.isMoving()
}

/**
 * 处理球入袋时的逻辑。
 * 更新得分、击球状态，并触发视觉/音频反馈。
 * 
 * @param {BilliardsGame} game - 游戏实例。
 * @param {Ball} ball - 进入球袋的球。
 * @param {Vec2} pocketPos - 球袋的位置。
 */
export function onBallPocketed(game, ball, pocketPos) {
  if (ball.pocketed) return
  ball.pocketed = true
  ball.vel = new Vec2(0, 0)
  ball.lastPocketPos = pocketPos ? pocketPos.clone() : null
  game.audio.playPocket()

  // 处理母球落袋
  if (ball.type === 'cue') {
    game.shotState.cuePocketed = true
    game.setStatusMessage(game.isBreakShot ? '开球犯规：白球落袋' : '犯规：白球落袋', 1800)
    game.updateUI()
    return
  }

  // 处理黑八落袋
  if (ball.type === 'eight') {
    game.shotState.eightPocketed = true
    game.setStatusMessage('黑八入袋', 1400)
    game.updateUI()
    return
  }

  // 计算合法进球效果
  const currentGroup = game.playerGroups[game.currentPlayer]
  const legalFirstTarget = game.getLegalFirstTargetType()
  const isOpenTableScoring = !currentGroup && ball.type !== 'eight'
  const isGroupedLegalScore = !!currentGroup && ball.type === legalFirstTarget
  
  if (pocketPos && (isOpenTableScoring || isGroupedLegalScore)) {
    spawnPocketScoreEffect(game, pocketPos)
  }
  
  game.shotState.pocketedBalls.push(ball)
  game.updateUI()
}

/**
 * 检测并解决球与球桌库边之间的碰撞。
 * @param {BilliardsGame} game - 游戏实例。
 * @param {Ball[]} activeBalls - 尚未入袋的球列表。
 */
function handleRailCollisions(game, activeBalls) {
  const RAIL_FRICTION = 0.96; // 库边切向摩擦力：使沿库边滑行的球自然减速
  activeBalls.forEach(ball => {
    const pos = ball.physicsPos || ball.pos
    const vel = ball.physicsVel || ball.vel
    const halfWidth = TABLE_WIDTH / 2 - PLAYABLE_AREA_INSET
    const halfHeight = TABLE_HEIGHT / 2 - PLAYABLE_AREA_INSET
    
    // 检查是否靠近球袋，避免球袋处产生错误的库边碰撞
    const isNearPocket = game.pockets.some(p => Vec2.distance(pos, p) < POCKET_RADIUS * 1.2)
    
    // 左右库边碰撞检测
    if (pos.x < -halfWidth) {
      if (!isNearPocket || Math.abs(pos.y) > POCKET_RADIUS) {
          const impact = Math.abs(vel.x)
          pos.x = -halfWidth
          vel.x *= -WALL_BOUNCE
          vel.y *= RAIL_FRICTION // 加入切向摩擦
          if (game.shotActive) game.shotState.railContacts++
          game.audio.playRailHit(Math.min(1, impact / 18))
          if (impact > 2) game.collisionEffects.push({ pos: new Vec2(-TABLE_WIDTH/2, pos.y), age: 0, type: 'rail' })
      }
    }
    if (pos.x > halfWidth) {
      if (!isNearPocket || Math.abs(pos.y) > POCKET_RADIUS) {
          const impact = Math.abs(vel.x)
          pos.x = halfWidth
          vel.x *= -WALL_BOUNCE
          vel.y *= RAIL_FRICTION // 加入切向摩擦
          if (game.shotActive) game.shotState.railContacts++
          game.audio.playRailHit(Math.min(1, impact / 18))
          if (impact > 2) game.collisionEffects.push({ pos: new Vec2(TABLE_WIDTH/2, pos.y), age: 0, type: 'rail' })
      }
    }

    // 上下库边碰撞检测
    if (pos.y < -halfHeight) {
      if (!isNearPocket || (Math.abs(pos.x) > POCKET_RADIUS && Math.abs(pos.x - TABLE_WIDTH/2) > POCKET_RADIUS && Math.abs(pos.x + TABLE_WIDTH/2) > POCKET_RADIUS)) {
          const impact = Math.abs(vel.y)
          pos.y = -halfHeight
          vel.y *= -WALL_BOUNCE
          vel.x *= RAIL_FRICTION // 加入切向摩擦
          if (game.shotActive) game.shotState.railContacts++
          game.audio.playRailHit(Math.min(1, impact / 18))
          if (impact > 2) game.collisionEffects.push({ pos: new Vec2(pos.x, -TABLE_HEIGHT/2), age: 0, type: 'rail' })
      }
    }
    if (pos.y > halfHeight) {
      if (!isNearPocket || (Math.abs(pos.x) > POCKET_RADIUS && Math.abs(pos.x - TABLE_WIDTH/2) > POCKET_RADIUS && Math.abs(pos.x + TABLE_WIDTH/2) > POCKET_RADIUS)) {
          const impact = Math.abs(vel.y)
          pos.y = halfHeight
          vel.y *= -WALL_BOUNCE
          vel.x *= RAIL_FRICTION // 加入切向摩擦
          if (game.shotActive) game.shotState.railContacts++
          game.audio.playRailHit(Math.min(1, impact / 18))
          if (impact > 2) game.collisionEffects.push({ pos: new Vec2(pos.x, TABLE_HEIGHT/2), age: 0, type: 'rail' })
      }
    }
  })
}

/**
 * 检测并解决台球之间的完全弹性碰撞。
 * @param {BilliardsGame} game - 游戏实例。
 * @param {Ball[]} activeBalls - 尚未入袋的球列表。
 */
function handleBallCollisions(game, activeBalls) {
  let maxOverlap = 0
  let collisionPairs = 0
  const orderedBalls = [...activeBalls].sort((first, second) => {
    const firstKey = `${first.type}:${first.label}`
    const secondKey = `${second.type}:${second.label}`
    return firstKey.localeCompare(secondKey)
  })

  for (let iteration = 0; iteration < COLLISION_ITERATIONS; iteration++) {
    let iterationMaxOverlap = 0
    for (let i = 0; i < orderedBalls.length; i++) {
      for (let j = i + 1; j < orderedBalls.length; j++) {
        const first = orderedBalls[i]
        const second = orderedBalls[j]
        const firstPos = first.physicsPos || first.pos
        const secondPos = second.physicsPos || second.pos
        const firstVel = first.physicsVel || first.vel
        const secondVel = second.physicsVel || second.vel
        const delta = secondPos.clone().sub(firstPos)
        let distance = delta.length()
        const minDistance = BALL_RADIUS * 2

        if (distance >= minDistance) continue

        if (distance < 1e-6) {
          delta.x = 1
          delta.y = 0
          distance = 1
        }

        const normal = delta.mul(1 / distance)
        const overlap = minDistance - distance
        collisionPairs++
        maxOverlap = Math.max(maxOverlap, overlap)
        iterationMaxOverlap = Math.max(iterationMaxOverlap, overlap)
        const correctionMagnitude = Math.max(0, overlap - POSITION_SLOP) * 0.5 * POSITION_CORRECTION

        if (correctionMagnitude > 0) {
          const correction = normal.clone().mul(correctionMagnitude)
          firstPos.sub(correction)
          secondPos.add(correction)
        }

        const relativeVelocity = secondVel.clone().sub(firstVel)
        const separation = relativeVelocity.dot(normal)

        if (iteration === 0) {
          // 记录击球首碰结果（用于规则判定）
          if (game.shotActive && !game.shotState.firstContact) {
            if (first === game.cueBall && second !== game.cueBall) game.shotState.firstContact = second
            if (second === game.cueBall && first !== game.cueBall) game.shotState.firstContact = first
          }

          // 音效与视觉反馈
          game.audio.playBallCollision(Math.min(1, Math.abs(separation) / 14))
          if (Math.abs(separation) > 3) {
            const midPoint = firstPos.clone().add(secondPos).mul(0.5)
            game.collisionEffects.push({ pos: midPoint, age: 0, type: 'ball' })
          }
        }

        if (separation >= 0) continue

        const impulse = -(1 + BALL_BOUNCE) * separation / 2
        const impulseVector = normal.clone().mul(impulse)
        firstVel.sub(impulseVector)
        secondVel.add(impulseVector)
      }
    }

    if (DEBUG_JITTER && iterationMaxOverlap > 0) {
      console.log(`[JitterLog] Collision iteration ${iteration + 1}: maxOverlap=${iterationMaxOverlap.toFixed(3)}px`)
    }
  }

  if (game.jitterStats) {
    game.jitterStats.lastMaxOverlap = maxOverlap
    game.jitterStats.lastCollisionPairs = collisionPairs
    if (game.jitterStats.shotPeakTracking) {
      game.jitterStats.shotPeakOverlap = Math.max(game.jitterStats.shotPeakOverlap || 0, maxOverlap)
    }
  }
}

/**
 * 在合法进球时，在球袋中心生成视觉火花效果。
 * @param {BilliardsGame} game - 游戏实例。
 * @param {Vec2} position - 球袋中心坐标。
 */
function spawnPocketScoreEffect(game, position) {
  game.scorePocketEffects.push({
    pos: position.clone(),
    age: 0,
    duration: POCKET_SCORE_EFFECT_DURATION,
    sparks: Array.from({ length: 12 }, (_, index) => {
      const angle = (Math.PI * 2 * index) / 12 + (index % 2) * 0.12
      const speed = 12 + (index % 4) * 4
      return {
        angle,
        speed,
        radius: 1.8 + (index % 3) * 0.7,
      }
    }),
  })
}
