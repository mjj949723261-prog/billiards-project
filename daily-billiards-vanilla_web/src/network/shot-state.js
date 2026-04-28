import { Vec2 } from '../math.js'

const BALL_STATE_PRECISION = 100

function ballIdOf(ballLike) {
  const type = ballLike.type || 'unknown'
  const label = ballLike.label || type
  return `${type}:${label}`
}

function quantize(value) {
  return Math.round(Number(value || 0) * BALL_STATE_PRECISION)
}

function sortBallStates(states) {
  return [...states].sort((a, b) => a.id.localeCompare(b.id))
}

export function normalizeBallStateFromBalls(balls) {
  return sortBallStates(
    balls.map(ball => {
      const pos = ball.physicsPos || ball.pos || new Vec2(0, 0)
      const vel = ball.physicsVel || ball.vel || new Vec2(0, 0)
      return {
        id: ballIdOf(ball),
        type: ball.type,
        label: ball.label,
        x: quantize(pos.x),
        y: quantize(pos.y),
        vx: quantize(vel.x),
        vy: quantize(vel.y),
        pocketed: !!ball.pocketed,
      }
    }),
  )
}

export function normalizeBallStateFromSnapshot(ballStates) {
  if (!Array.isArray(ballStates)) return []
  return sortBallStates(
    ballStates.map(ball => ({
      id: ball.id || ballIdOf(ball),
      type: ball.type,
      label: ball.label,
      x: quantize(ball.x),
      y: quantize(ball.y),
      vx: quantize(ball.vx),
      vy: quantize(ball.vy),
      pocketed: !!ball.pocketed,
    })),
  )
}

export function denormalizeBallState(normalizedStates) {
  return (normalizedStates || []).map(ball => ({
    id: ball.id,
    type: ball.type,
    label: ball.label,
    x: ball.x / BALL_STATE_PRECISION,
    y: ball.y / BALL_STATE_PRECISION,
    vx: ball.vx / BALL_STATE_PRECISION,
    vy: ball.vy / BALL_STATE_PRECISION,
    pocketed: !!ball.pocketed,
  }))
}

export function buildBallStateHash(normalizedStates) {
  return (normalizedStates || [])
    .map(ball => [
      ball.id,
      ball.x,
      ball.y,
      ball.vx,
      ball.vy,
      ball.pocketed ? 1 : 0,
    ].join(':'))
    .join('|')
}

export function buildSettledSnapshotPayload(game) {
  const normalized = normalizeBallStateFromBalls(game.balls)
  return {
    balls: denormalizeBallState(normalized),
    stateHash: buildBallStateHash(normalized),
  }
}

export function createShotEndReport(game, senderRole = 'shooter') {
  const settledSnapshot = buildSettledSnapshotPayload(game)
  const pocketedBallIds = game.shotState.pocketedBalls
    .map(ball => `${ball.type}:${ball.label || ball.type}`)
    .sort()

  return {
    turnId: game.turnId,
    stateVersion: game.stateVersion,
    shotToken: game.shotToken,
    senderRole,
    firstContactBallId: game.shotState.firstContact
      ? `${game.shotState.firstContact.type}:${game.shotState.firstContact.label || game.shotState.firstContact.type}`
      : null,
    pocketedBallIds,
    cuePocketed: !!game.shotState.cuePocketed,
    eightPocketed: !!game.shotState.eightPocketed,
    railContacts: Number(game.shotState.railContacts || 0),
    finalBallState: settledSnapshot.balls,
    finalStateHash: settledSnapshot.stateHash,
    isBreakShot: !!game.isBreakShot,
  }
}

export function snapshotStateFromRoomPayload(roomLike = {}) {
  return {
    turnId: roomLike.turnId ?? 1,
    stateVersion: roomLike.stateVersion ?? 1,
    shotToken: roomLike.shotToken ?? null,
    roomPhase: roomLike.status || roomLike.roomPhase || 'WAITING',
    stateHash: roomLike.stateHash || '',
  }
}

