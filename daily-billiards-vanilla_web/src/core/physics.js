/**
 * @file physics.js
 * @description 处理游戏的物理模拟，包括球体运动、球与球碰撞、
 * 球与库边碰撞的检测与响应，以及进球检测。
 */

import {
  BALL_BOUNCE,
  BALL_RADIUS,
  PLAYABLE_AREA_INSET,
  POCKET_RADIUS,
  POCKET_SCORE_EFFECT_DURATION,
  TABLE_HEIGHT,
  TABLE_WIDTH,
  TURN_TIME_LIMIT,
  WALL_BOUNCE,
} from '../constants.js'
import { Vec2 } from '../math.js'
import { evaluateShot } from './rules.js'

const FIXED_TIMESTEP_MS = 1000 / 120
const BASE_FRAME_MS = 1000 / 60
const MAX_SUBSTEPS = 5
const COLLISION_ITERATIONS = 4
const POSITION_CORRECTION = 0.82
const POSITION_SLOP = 0.01

/**
 * 更新单帧的游戏物理状态。
 * 编排球体位置更新、碰撞检测以及状态检查。
 * 
 * @param {BilliardsGame} game - 游戏实例。
 * @param {number} [frameMs=BASE_FRAME_MS] - 当前渲染帧耗时（毫秒）。
 */
export function updateGamePhysics(game, frameMs = BASE_FRAME_MS) {
  const active = game.balls.filter(ball => !ball.pocketed)

  if (typeof game.physicsAccumulatorMs !== 'number') {
    game.physicsAccumulatorMs = 0
  }
  game.physicsAccumulatorMs += Math.min(frameMs, FIXED_TIMESTEP_MS * MAX_SUBSTEPS)

  let substeps = 0
  while (game.physicsAccumulatorMs >= FIXED_TIMESTEP_MS && substeps < MAX_SUBSTEPS) {
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
  }

  if (substeps === MAX_SUBSTEPS && game.physicsAccumulatorMs > FIXED_TIMESTEP_MS) {
    game.physicsAccumulatorMs = 0
  }

  const deltaSeconds = Math.max(0, frameMs) / 1000
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
  if (game.wasMoving && !game.isMoving() && !game.isGameOver) {
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
  for (let iteration = 0; iteration < COLLISION_ITERATIONS; iteration++) {
    for (let i = 0; i < activeBalls.length; i++) {
      for (let j = i + 1; j < activeBalls.length; j++) {
        const first = activeBalls[i]
        const second = activeBalls[j]
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

        // 仅在第一轮处理速度冲量，后续迭代专注收敛重叠。
        if (iteration > 0) continue

        const impulse = -(1 + BALL_BOUNCE) * separation / 2
        const impulseVector = normal.clone().mul(impulse)
        firstVel.sub(impulseVector)
        secondVel.add(impulseVector)
      }
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
