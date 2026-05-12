import {
  BALL_RADIUS,
  PLAYABLE_AREA_INSET_BOTTOM,
  PLAYABLE_AREA_INSET_LEFT,
  PLAYABLE_AREA_INSET_RIGHT,
  PLAYABLE_AREA_INSET_TOP,
  POCKET_CAPTURE_RADIUS,
  POCKET_RADIUS,
  TABLE_HEIGHT,
  TABLE_WIDTH,
} from '../constants.js?v=20260512_table_surface_restore'
import { Vec2 } from '../math.js'

const CORNER_POCKET_MOUTH_DEPTH = BALL_RADIUS * 0.18
const SIDE_POCKET_MOUTH_DEPTH = BALL_RADIUS * 0.55
const CORNER_MOUTH_HALF_WIDTH = POCKET_RADIUS * 0.98
const SIDE_MOUTH_HALF_WIDTH = POCKET_RADIUS * 1.08

export function getPocketMouthCenters() {
  const rollAreaX = -TABLE_WIDTH / 2 + PLAYABLE_AREA_INSET_LEFT
  const rollAreaY = -TABLE_HEIGHT / 2 + PLAYABLE_AREA_INSET_TOP
  const rollAreaWidth = TABLE_WIDTH - PLAYABLE_AREA_INSET_LEFT - PLAYABLE_AREA_INSET_RIGHT
  const rollAreaHeight = TABLE_HEIGHT - PLAYABLE_AREA_INSET_TOP - PLAYABLE_AREA_INSET_BOTTOM

  return [
    new Vec2(rollAreaX, rollAreaY),
    new Vec2(0, rollAreaY),
    new Vec2(rollAreaX + rollAreaWidth, rollAreaY),
    new Vec2(rollAreaX, rollAreaY + rollAreaHeight),
    new Vec2(0, rollAreaY + rollAreaHeight),
    new Vec2(rollAreaX + rollAreaWidth, rollAreaY + rollAreaHeight),
  ]
}

export function getPocketCaptureProfile(pocketCenter, pocketIndex) {
  const mouth = getPocketMouthCenters()[pocketIndex]
  if (!mouth) return null

  const centerDelta = pocketCenter.clone().sub(mouth)
  const centerDepth = centerDelta.length()
  const axis = centerDelta.clone().normalize()
  const tangent = new Vec2(-axis.y, axis.x)
  const isSidePocket = pocketIndex === 1 || pocketIndex === 4

  return {
    center: pocketCenter,
    mouth,
    axis,
    centerDepth,
    tangent,
    captureRadius: POCKET_CAPTURE_RADIUS,
    mouthDepth: isSidePocket ? SIDE_POCKET_MOUTH_DEPTH : CORNER_POCKET_MOUTH_DEPTH,
    mouthHalfWidth: isSidePocket ? SIDE_MOUTH_HALF_WIDTH : CORNER_MOUTH_HALF_WIDTH,
  }
}

export function isBallCapturedByPocket(ballPos, pocketCenter, pocketIndex) {
  const profile = getPocketCaptureProfile(pocketCenter, pocketIndex)
  if (!profile) return false

  const mouthDelta = ballPos.clone().sub(profile.mouth)
  const depth = mouthDelta.dot(profile.axis)
  if (depth < profile.mouthDepth) return false

  const lateral = Math.abs(mouthDelta.dot(profile.tangent))
  const insideJawCorridor = depth <= profile.centerDepth + BALL_RADIUS * 0.9
  if (insideJawCorridor) {
    return lateral <= profile.mouthHalfWidth
  }

  return Vec2.distance(ballPos, profile.center) < profile.captureRadius
}
