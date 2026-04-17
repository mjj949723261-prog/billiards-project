/**
 * @file aim.js
 * @description 提供计算瞄准引导、球体碰撞射线投射以及库边反弹预测的工具函数。
 */

import { BALL_RADIUS, TABLE_WIDTH, TABLE_HEIGHT } from '../constants.js'
import { Vec2 } from '../math.js'

/**
 * 计算母球在给定方向上的瞄准引导数据。
 * 通过射线投射（Ray-casting）找到与另一个球或库边的第一个碰撞点。
 * 
 * @param {Ball} cueBall - 母球实体。
 * @param {Ball[]} balls - 球桌上所有球的数组。
 * @param {Vec2} direction - 瞄准的归一化方向向量。
 * @returns {Object} 瞄准引导结果，包含命中类型、距离、命中点以及碰撞法线。
 */
export function getAimGuide(cueBall, balls, direction) {
  const rayDir = direction.clone().normalize()
  let bestHit = null
  const candidates = balls.filter(ball => !ball.pocketed && ball !== cueBall)

  // 遍历所有目标球，检查射线是否与球体相交
  candidates.forEach(ball => {
    const toBall = ball.pos.clone().sub(cueBall.pos)
    const projection = toBall.dot(rayDir)
    if (projection <= 0) return

    // 找到射线到球心的最近点
    const closestPoint = cueBall.pos.clone().add(rayDir.clone().mul(projection))
    const distanceToCenter = Vec2.distance(closestPoint, ball.pos)
    const combinedRadius = BALL_RADIUS * 2
    if (distanceToCenter >= combinedRadius) return

    // 计算实际碰撞点在射线上的距离
    const offset = Math.sqrt(Math.max(0, combinedRadius * combinedRadius - distanceToCenter * distanceToCenter))
    const hitDistance = projection - offset
    if (hitDistance <= 0) return

    // 如果该碰撞点比之前的更近，则更新最优命中结果
    if (!bestHit || hitDistance < bestHit.distance) {
      const cueImpact = cueBall.pos.clone().add(rayDir.clone().mul(hitDistance))
      const contactPoint = cueImpact.clone().add(rayDir.clone().mul(BALL_RADIUS))
      const normal = ball.pos.clone().sub(cueImpact).normalize()
      bestHit = {
        type: 'ball',
        ball,
        distance: hitDistance,
        hitPoint: cueImpact,
        cueImpact,
        contactPoint,
        normal,
      }
    }
  })

  // 检查与库边的碰撞
  const wallDistance = getWallAimDistance(cueBall.pos, rayDir)
  if (!bestHit || wallDistance < bestHit.distance) {
    return {
      type: 'wall',
      distance: wallDistance,
      hitPoint: cueBall.pos.clone().add(rayDir.clone().mul(wallDistance)),
      normal: null,
    }
  }

  return bestHit
}

/**
 * 计算从起点出发到给定方向上最近库边的距离。
 * @param {Vec2} start - 起始位置。
 * @param {Vec2} direction - 归一化的方向向量。
 * @returns {number} 到库边的距离。
 */
export function getWallAimDistance(start, direction) {
  const halfWidth = TABLE_WIDTH / 2 - BALL_RADIUS
  const halfHeight = TABLE_HEIGHT / 2 - BALL_RADIUS
  const distances = []

  // 计算到四面库边的投影距离
  if (direction.x > 0) distances.push((halfWidth - start.x) / direction.x)
  if (direction.x < 0) distances.push((-halfWidth - start.x) / direction.x)
  if (direction.y > 0) distances.push((halfHeight - start.y) / direction.y)
  if (direction.y < 0) distances.push((-halfHeight - start.y) / direction.y)

  // 过滤出有效的正数距离并取最小值
  const positiveDistances = distances.filter(distance => Number.isFinite(distance) && distance > 0)
  return positiveDistances.length ? Math.min(...positiveDistances) : 0
}

/**
 * 预测球沿路径行进的直线距离，直到撞库或达到上限。
 * @param {Vec2} start - 起始位置。
 * @param {Vec2} direction - 行进方向。
 * @param {number} [limit=220] - 最大预测距离。
 * @returns {number} 计算出的行进距离。
 */
export function getProjectedTravel(start, direction, limit = 220) {
  const unitDirection = direction.clone().normalize()
  const halfWidth = TABLE_WIDTH / 2 - BALL_RADIUS
  const halfHeight = TABLE_HEIGHT / 2 - BALL_RADIUS
  const distances = [limit]

  if (unitDirection.x > 0) distances.push((halfWidth - start.x) / unitDirection.x)
  if (unitDirection.x < 0) distances.push((-halfWidth - start.x) / unitDirection.x)
  if (unitDirection.y > 0) distances.push((halfHeight - start.y) / unitDirection.y)
  if (unitDirection.y < 0) distances.push((-halfHeight - start.y) / unitDirection.y)

  const positiveDistances = distances.filter(distance => Number.isFinite(distance) && distance > 0)
  return Math.min(...positiveDistances)
}
