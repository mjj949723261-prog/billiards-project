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

/**
 * 更新单帧的游戏物理状态。
 * 编排球体位置更新、碰撞检测以及状态检查。
 * 
 * @param {BilliardsGame} game - 游戏实例。
 * @param {number} dt - 时间步长缩放。
 */
export function updateGamePhysics(game, dt) {
  const active = game.balls.filter(ball => !ball.pocketed)
  
  // 更新每个球的位置和旋转
  active.forEach(ball => {
    ball.update()
  })

  const now = Date.now()
  const deltaSeconds = (now - game.lastTick) / 1000
  
  game.lastTick = now
  game.releaseFlash = Math.max(0, game.releaseFlash - deltaSeconds)

  // 更新进球得分动画的时间
  game.scorePocketEffects = game.scorePocketEffects
    .map(effect => ({ ...effect, age: effect.age + deltaSeconds }))
    .filter(effect => effect.age < effect.duration)

  game.updateTimerUI()
  const statusNode = document.getElementById('status')
  if (statusNode) {
    statusNode.innerText = game.getStatusText()
  }
  
  // 时间耗尽逻辑
  if (game.timeLeft <= 0 && !game.isMoving()) {
    game.timeLeft = 0
  }

  // 处理各种碰撞
  handleRailCollisions(game, active)
  handleBallCollisions(game, active)

  // 检查进球
  active.forEach(ball => {
    game.pockets.forEach(pocket => {
      if (Vec2.distance(ball.pos, pocket) < POCKET_RADIUS) onBallPocketed(game, ball, pocket)
    })
  })

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
    const halfWidth = TABLE_WIDTH / 2 - PLAYABLE_AREA_INSET
    const halfHeight = TABLE_HEIGHT / 2 - PLAYABLE_AREA_INSET
    
    // 检查是否靠近球袋，避免球袋处产生错误的库边碰撞
    const isNearPocket = game.pockets.some(p => Vec2.distance(ball.pos, p) < POCKET_RADIUS * 1.2)
    
    // 左右库边碰撞检测
    if (ball.pos.x < -halfWidth) {
      if (!isNearPocket || Math.abs(ball.pos.y) > POCKET_RADIUS) {
          const impact = Math.abs(ball.vel.x)
          ball.pos.x = -halfWidth
          ball.vel.x *= -WALL_BOUNCE
          ball.vel.y *= RAIL_FRICTION // 加入切向摩擦
          if (game.shotActive) game.shotState.railContacts++
          game.audio.playRailHit(Math.min(1, impact / 18))
          if (impact > 2) game.collisionEffects.push({ pos: new Vec2(-TABLE_WIDTH/2, ball.pos.y), age: 0, type: 'rail' })
      }
    }
    if (ball.pos.x > halfWidth) {
      if (!isNearPocket || Math.abs(ball.pos.y) > POCKET_RADIUS) {
          const impact = Math.abs(ball.vel.x)
          ball.pos.x = halfWidth
          ball.vel.x *= -WALL_BOUNCE
          ball.vel.y *= RAIL_FRICTION // 加入切向摩擦
          if (game.shotActive) game.shotState.railContacts++
          game.audio.playRailHit(Math.min(1, impact / 18))
          if (impact > 2) game.collisionEffects.push({ pos: new Vec2(TABLE_WIDTH/2, ball.pos.y), age: 0, type: 'rail' })
      }
    }

    // 上下库边碰撞检测
    if (ball.pos.y < -halfHeight) {
      if (!isNearPocket || (Math.abs(ball.pos.x) > POCKET_RADIUS && Math.abs(ball.pos.x - TABLE_WIDTH/2) > POCKET_RADIUS && Math.abs(ball.pos.x + TABLE_WIDTH/2) > POCKET_RADIUS)) {
          const impact = Math.abs(ball.vel.y)
          ball.pos.y = -halfHeight
          ball.vel.y *= -WALL_BOUNCE
          ball.vel.x *= RAIL_FRICTION // 加入切向摩擦
          if (game.shotActive) game.shotState.railContacts++
          game.audio.playRailHit(Math.min(1, impact / 18))
          if (impact > 2) game.collisionEffects.push({ pos: new Vec2(ball.pos.x, -TABLE_HEIGHT/2), age: 0, type: 'rail' })
      }
    }
    if (ball.pos.y > halfHeight) {
      if (!isNearPocket || (Math.abs(ball.pos.x) > POCKET_RADIUS && Math.abs(ball.pos.x - TABLE_WIDTH/2) > POCKET_RADIUS && Math.abs(ball.pos.x + TABLE_WIDTH/2) > POCKET_RADIUS)) {
          const impact = Math.abs(ball.vel.y)
          ball.pos.y = halfHeight
          ball.vel.y *= -WALL_BOUNCE
          ball.vel.x *= RAIL_FRICTION // 加入切向摩擦
          if (game.shotActive) game.shotState.railContacts++
          game.audio.playRailHit(Math.min(1, impact / 18))
          if (impact > 2) game.collisionEffects.push({ pos: new Vec2(ball.pos.x, TABLE_HEIGHT/2), age: 0, type: 'rail' })
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
  for (let i = 0; i < activeBalls.length; i++) {
    for (let j = i + 1; j < activeBalls.length; j++) {
      const first = activeBalls[i]
      const second = activeBalls[j]
      const distance = Vec2.distance(first.pos, second.pos)
      if (distance >= BALL_RADIUS * 2) continue

      const normal = second.pos.clone().sub(first.pos).normalize()
      const overlap = BALL_RADIUS * 2 - distance
      
      // 坐标修正：防止多球堆叠时的非物理震荡
      const correctionScale = 0.52; 
      first.pos.sub(normal.clone().mul(overlap * correctionScale))
      second.pos.add(normal.clone().mul(overlap * correctionScale))

      const relativeVelocity = second.vel.clone().sub(first.vel)
      const separation = relativeVelocity.dot(normal)
      
      // 记录击球首碰结果（用于规则判定）
      if (game.shotActive && !game.shotState.firstContact) {
        if (first === game.cueBall && second !== game.cueBall) game.shotState.firstContact = second
        if (second === game.cueBall && first !== game.cueBall) game.shotState.firstContact = first
      }

      // 音效与视觉反馈
      game.audio.playBallCollision(Math.min(1, Math.abs(separation) / 14))
      if (Math.abs(separation) > 3) {
          const midPoint = first.pos.clone().add(second.pos).mul(0.5);
          game.collisionEffects.push({ pos: midPoint, age: 0, type: 'ball' });
      }

      if (separation > 0) continue
      
      // 弹性碰撞冲量分配
      const impulse = -(1 + BALL_BOUNCE) * separation / 2
      const impulseVector = normal.clone().mul(impulse)
      first.vel.sub(impulseVector)
      second.vel.add(impulseVector)
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
