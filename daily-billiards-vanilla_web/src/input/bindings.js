/**
 * @file bindings.js
 * @description 将用户输入事件（鼠标和触摸）绑定到游戏动作。
 * 处理瞄准、击球以及带网络同步的白球位置摆放。
 */

import {
  BALL_RADIUS,
  HEAD_STRING_X,
  MAX_PULL_DISTANCE,
} from '../constants.js?v=20260429-room-entry-fix'
import { Vec2 } from '../math.js'
import { GameClient } from '../network/game-client.js'
import { hasDebugAlwaysDrag } from '../layout/mode.js'
import { buildSettledSnapshotPayload } from '../network/shot-state.js'

/**
 * 将当前的母球摆放位置同步给远程对手。
 * @param {BilliardsGame} game - 游戏实例。
 */
function syncCuePlacement(game) {
  GameClient.sendSync(game.createLivePlacementSnapshot())
}

function clearDragInteraction(game) {
  game.isDragging = false
  game.pullDistance = 0
}

/**
 * 将所有必要的输入监听器绑定到游戏画布和窗口。
 * 处理开始拖拽（瞄准）、移动（拖拽/悬停）以及结束拖拽（击球）的逻辑。
 * 
 * @param {BilliardsGame} game - 要绑定输入的游戏实例。
 */
export function bindGameInput(game) {
  const debugAlwaysDrag = hasDebugAlwaysDrag(window)
  const powerStrip = document.getElementById('power-strip')
  const aimWheel = document.getElementById('aim-wheel')
  const leftControlColumn = document.querySelector('.control-column-left')
  const rightControlColumn = document.querySelector('.control-column-right')
  let activeAimPointerId = null
  let activePowerPointerId = null
  let lastAimPointerY = 0
  let pendingAimDegrees = 0
  const AIM_STEP_RADIANS = Math.PI / 180
  const AIM_STEP_DEGREES = 1
  // 右侧直立拨轮按竖向位移累加步进，保持细腻但仍有滚动反馈。
  const AIM_PIXELS_PER_STEP = 4
  const AIM_ACCEL_START_PIXELS = 14
  const AIM_ACCEL_MAX_MULTIPLIER = 2.2
  const AIM_WHEEL_SCROLL_STEP_DEGREES = 0.125
  const AIM_WHEEL_TICK_PITCH = 52
  const AIM_WHEEL_PIXELS_PER_DEGREE = 88
  let aimWheelStepPulseTimer = null
  let aimWheelActiveTimer = null

  const isSideControlGestureActive = () => activePowerPointerId !== null || activeAimPointerId !== null

  const getPrimaryClientPoint = (e) => {
    const touch = e.touches?.[0] || e.changedTouches?.[0]
    return touch || e
  }

  const isPointInsideElement = (el, point) => {
    if (!el || point?.clientX === undefined || point?.clientY === undefined) return false
    const rect = el.getBoundingClientRect()
    return (
      point.clientX >= rect.left &&
      point.clientX <= rect.right &&
      point.clientY >= rect.top &&
      point.clientY <= rect.bottom
    )
  }

  const isInsideSideControlColumn = (e) => {
    const point = getPrimaryClientPoint(e)
    return isPointInsideElement(leftControlColumn, point) || isPointInsideElement(rightControlColumn, point)
  }

  const releasePointerCaptureSafely = (el, pointerId) => {
    try {
      el?.releasePointerCapture?.(pointerId)
    } catch (_) {
      // Pointer capture may already be lost after synthetic events or browser cancellation.
    }
  }

  const canControlTurn = () => {
    if ((!GameClient.isMyTurn || game.isTurnLocked || game.roomPhase !== 'PLAYING') && !debugAlwaysDrag) return false
    if (game.awaitingSettledSync && !debugAlwaysDrag) return false
    return true
  }

  const canControlShot = () => {
    if (!canControlTurn()) return false
    if ((game.isMoving() || game.isGameOver || game.cueBall.pocketed) && !debugAlwaysDrag) return false
    return true
  }

  const updatePowerFromClientY = (clientY) => {
    if (!powerStrip) return
    const rect = powerStrip.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (rect.bottom - clientY) / Math.max(rect.height, 1)))
    const nextPullDistance = ratio * MAX_PULL_DISTANCE
    if (Math.abs(nextPullDistance - game.pullDistance) > 0.5) {
      game.pullDistance = nextPullDistance
      GameClient.sendAim({ aimAngle: game.aimAngle, pullDistance: game.pullDistance })
    }
  }

  const releaseShotIfNeeded = () => {
    if (!game.isDragging) return

    const powerRatio = Math.max(0, Math.min(1, game.pullDistance / MAX_PULL_DISTANCE))
    if (powerRatio > 0.08) {
      game.showRemoteCue = false

      const breakAimDir = game.requiresKitchenBreakDirection ? new Vec2(Math.cos(game.aimAngle), Math.sin(game.aimAngle)) : null
      const breakGuide = breakAimDir ? game.getAimGuide(breakAimDir) : null
      const crossesHeadString = !breakGuide || breakGuide.hitPoint.x > HEAD_STRING_X + BALL_RADIUS
      if (game.requiresKitchenBreakDirection && (!crossesHeadString || breakAimDir.x <= 0.08)) {
        clearDragInteraction(game)
        game.setStatusMessage('开球方向无效', 1800)
        return
      }

      const baseSnapshot = buildSettledSnapshotPayload(game)
      const shotInput = {
        turnId: game.turnId,
        stateVersion: game.stateVersion,
        shotToken: game.shotToken,
        preStateHash: game.stateHash || baseSnapshot.stateHash,
        cueBallPos: { x: game.cueBall.pos.x, y: game.cueBall.pos.y },
        aimAngle: game.aimAngle,
        powerRatio,
      }

      if (!debugAlwaysDrag) {
        GameClient.sendShotStartRequest(shotInput)
        GameClient.sendAim({ aimAngle: game.aimAngle, pullDistance: 0 })
      }

      game.beginLocalAuthoritativeShot(shotInput)
    }
  }

  const pulseAimWheelFeedback = () => {
    aimWheel?.classList.add('is-stepping')
    if (aimWheelStepPulseTimer) {
      window.clearTimeout(aimWheelStepPulseTimer)
    }
    aimWheelStepPulseTimer = window.setTimeout(() => {
      aimWheel?.classList.remove('is-stepping')
      aimWheelStepPulseTimer = null
    }, 70)
  }

  const syncAimWheelVisual = () => {
    if (!aimWheel) return
    const aimDegrees = (game.aimAngle * 180) / Math.PI
    const aimWheelOffset = ((aimDegrees * AIM_WHEEL_PIXELS_PER_DEGREE) % AIM_WHEEL_TICK_PITCH + AIM_WHEEL_TICK_PITCH) % AIM_WHEEL_TICK_PITCH
    aimWheel.style.setProperty('--aim-arc-rotation', `${game.aimAngle}rad`)
    aimWheel.style.setProperty('--aim-wheel-offset', `${aimWheelOffset}px`)
  }

  const applyAimWheelStepCount = (stepCount) => {
    if (stepCount === 0) return false
    game.aimAngle += stepCount * AIM_STEP_RADIANS
    game.showRemoteCue = false
    syncAimWheelVisual()
    pulseAimWheelFeedback()
    GameClient.sendAim({ aimAngle: game.aimAngle, pullDistance: game.pullDistance })
    return true
  }

  const stepAimWheelByDeltaY = (deltaY) => {
    if (Math.abs(deltaY) <= 0.001) return false

    const absTangentialDelta = Math.abs(deltaY)
    let accelMultiplier = 1
    if (absTangentialDelta > AIM_ACCEL_START_PIXELS) {
      const extraRatio = Math.min(
        1,
        (absTangentialDelta - AIM_ACCEL_START_PIXELS) / 26
      )
      accelMultiplier = 1 + extraRatio * (AIM_ACCEL_MAX_MULTIPLIER - 1)
    }

    pendingAimDegrees += (deltaY * accelMultiplier) / AIM_PIXELS_PER_STEP
    const stepCount = pendingAimDegrees > 0
      ? Math.floor(pendingAimDegrees / AIM_STEP_DEGREES)
      : Math.ceil(pendingAimDegrees / AIM_STEP_DEGREES)

    if (stepCount === 0) return false
    pendingAimDegrees -= stepCount * AIM_STEP_DEGREES
    return applyAimWheelStepCount(stepCount)
  }

  const isInsideAimWheel = (clientX, clientY) => {
    if (!aimWheel) return null
    const rect = aimWheel.getBoundingClientRect()
    return (
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom
    )
  }

  const beginAimWheelControl = (e) => {
    if (!aimWheel || game.ballInHand || !canControlShot()) return
    if (!isInsideAimWheel(e.clientX, e.clientY)) return
    game.audio.unlock()
    // 暂停“鼠标悬停即瞄准”，避免右侧拨轮刚改完角度就被旧鼠标位置抢回去。
    game.hasPointerInput = false
    activeAimPointerId = e.pointerId
    lastAimPointerY = e.clientY
    pendingAimDegrees = 0
    game.adjustingAimWheel = true
    game.showRemoteCue = false
    aimWheel.classList.add('is-active')
    aimWheel.setPointerCapture?.(e.pointerId)
    e.stopPropagation()
    e.preventDefault()
  }

  const moveAimWheelControl = (e) => {
    if (activeAimPointerId === null || e.pointerId !== activeAimPointerId || game.ballInHand) return
    const deltaY = e.clientY - lastAimPointerY
    lastAimPointerY = e.clientY
    stepAimWheelByDeltaY(deltaY)
    e.stopPropagation()
    e.preventDefault()
  }

  const handleAimWheelScroll = (e) => {
    if (!aimWheel || !canControlShot()) return
    // wheel 事件本身只会在命中元素时触发，这里允许用户在可见拨轮区域内直接滚动，
    // 不再额外要求命中极窄的弧带采样区，避免“看得见但滚不动”的挫败感。
    const rect = aimWheel.getBoundingClientRect()
    const insideVisibleWheelBounds =
      e.clientX >= rect.left &&
      e.clientX <= rect.right &&
      e.clientY >= rect.top &&
      e.clientY <= rect.bottom
    if (!insideVisibleWheelBounds) return

    game.audio.unlock()
    pendingAimDegrees = 0
    game.adjustingAimWheel = true
    game.hasPointerInput = false
    aimWheel.classList.add('is-active')

    const normalizedNotches = Math.max(1, Math.round(Math.abs(e.deltaY) / 100))
    const direction = e.deltaY >= 0 ? 1 : -1
    const stepCount = direction * normalizedNotches * AIM_WHEEL_SCROLL_STEP_DEGREES
    const didStep = applyAimWheelStepCount(stepCount)
    if (didStep) {
      if (aimWheelActiveTimer) {
        window.clearTimeout(aimWheelActiveTimer)
      }
      aimWheelActiveTimer = window.setTimeout(() => {
        aimWheel.classList.remove('is-active')
        aimWheel.classList.remove('is-stepping')
        game.adjustingAimWheel = false
        aimWheelActiveTimer = null
      }, 90)
    } else {
      aimWheel.classList.remove('is-active')
      game.adjustingAimWheel = false
    }

    e.stopPropagation()
    e.preventDefault()
  }

  const clearAimWheelControl = (e) => {
    if (activeAimPointerId === null || e.pointerId !== activeAimPointerId) return
    releasePointerCaptureSafely(aimWheel, e.pointerId)
    activeAimPointerId = null
    pendingAimDegrees = 0
    game.adjustingAimWheel = false
    aimWheel.classList.remove('is-active')
    aimWheel.classList.remove('is-stepping')
    if (aimWheelStepPulseTimer) {
      window.clearTimeout(aimWheelStepPulseTimer)
      aimWheelStepPulseTimer = null
    }
    if (aimWheelActiveTimer) {
      window.clearTimeout(aimWheelActiveTimer)
      aimWheelActiveTimer = null
    }
  }

  const endAimWheelControl = (e) => {
    if (activeAimPointerId === null || e.pointerId !== activeAimPointerId) return
    clearAimWheelControl(e)
  }

  const cancelAimWheelControl = (e) => {
    if (activeAimPointerId === null || e.pointerId !== activeAimPointerId) return
    clearAimWheelControl(e)
  }

  const beginPowerStripControl = (e) => {
    if (!powerStrip || game.ballInHand || !canControlShot()) return
    game.audio.unlock()
    activePowerPointerId = e.pointerId
    game.hasPointerInput = false
    game.isDragging = true
    game.showRemoteCue = false
    powerStrip.classList.add('is-active')
    powerStrip.setPointerCapture?.(e.pointerId)
    updatePowerFromClientY(e.clientY)
    e.stopPropagation()
    e.preventDefault()
  }

  const movePowerStripControl = (e) => {
    if (activePowerPointerId === null || e.pointerId !== activePowerPointerId) return
    updatePowerFromClientY(e.clientY)
    e.stopPropagation()
    e.preventDefault()
  }

  const endPowerStripControl = (e) => {
    if (activePowerPointerId === null || e.pointerId !== activePowerPointerId) return
    releasePointerCaptureSafely(powerStrip, e.pointerId)
    activePowerPointerId = null
    powerStrip.classList.remove('is-active')
    releaseShotIfNeeded()
    if (!game.ballInHand && !debugAlwaysDrag) {
      GameClient.sendAim({ aimAngle: game.aimAngle, pullDistance: 0 })
    }
    clearDragInteraction(game)
    e.stopPropagation()
  }

  /**
   * 鼠标/触摸开始的内部处理函数。
   * @param {MouseEvent|TouchEvent} e - 输入事件。
   */
  const start = (e) => {
    if (isSideControlGestureActive()) return
    if (isInsideSideControlColumn(e)) {
      game.hasPointerInput = false
      return
    }
    // 联机拦截：如果不是我的回合或回合已锁定，则不处理输入
    if ((!GameClient.isMyTurn || game.isTurnLocked || game.roomPhase !== 'PLAYING') && !debugAlwaysDrag) return;
    if (game.awaitingSettledSync && !debugAlwaysDrag) return;

    game.audio.unlock()
    game.updatePos(e.touches ? e.touches[0] : e, game.ballInHand ? 'placement' : 'aim')
    
    // 处理“白球在手”状态下的摆球
    if (game.ballInHand) {
      game.placingCue = true
      game.tryPlaceCueBall()
      syncCuePlacement(game)
      return
    }

    const aimVector = game.mousePos.clone().sub(game.cueBall.pos)
    if (aimVector.length() < 8) return

    // 无论是不是调试拖拽模式，点击台呢都应该先把球杆朝向切过去。
    game.showRemoteCue = false
    game.aimAngle = Math.atan2(aimVector.y, aimVector.x)
    game.pullDistance = 0

    if (!debugAlwaysDrag) {
      GameClient.sendAim({ aimAngle: game.aimAngle, pullDistance: 0 })
      return
    }

    if (game.isMoving() || game.isGameOver || game.cueBall.pocketed) return
    game.isDragging = true
    game.cueBall.pocketed = false
    game.cueBall.clearPocketAnimation?.()
  }

  /**
   * 鼠标/触摸移动的内部处理函数。
   * @param {MouseEvent|TouchEvent} e - 输入事件。
   */
  const move = (e) => {
    if (isSideControlGestureActive()) return
    if (isInsideSideControlColumn(e)) {
      game.hasPointerInput = false
      return
    }
    if ((!GameClient.isMyTurn || game.isTurnLocked || game.roomPhase !== 'PLAYING') && !debugAlwaysDrag) return;
    if (game.awaitingSettledSync && !debugAlwaysDrag) return;

    game.updatePos(e.touches ? e.touches[0] : e, game.ballInHand && game.placingCue ? 'placement' : 'aim')
    
    // 如果正在摆放白球
    if (game.ballInHand && game.placingCue) {
      game.tryPlaceCueBall()
      syncCuePlacement(game)
      e.preventDefault()
      return
    }

    if (!debugAlwaysDrag) return

    // 悬停瞄准同步（仅保留给调试模式）
    if (debugAlwaysDrag && game.hasPointerInput && !game.isDragging && !game.isMoving() && !game.isGameOver && (!game.cueBall.pocketed || debugAlwaysDrag)) {
      const hoverAim = game.mousePos.clone().sub(game.cueBall.pos)
      if (hoverAim.length() > 4) {
        const newAngle = Math.atan2(hoverAim.y, hoverAim.x);
        if (Math.abs(newAngle - game.aimAngle) > 0.01) {
            game.showRemoteCue = false
            game.aimAngle = newAngle;
            GameClient.sendAim({ aimAngle: game.aimAngle, pullDistance: 0 });
        }
      }
    }

    // 处理调试模式下的画布拖拽拉杆逻辑
    if (game.isDragging) {
      const relative = game.mousePos.clone().sub(game.cueBall.pos)
      const liveAngle = Math.atan2(relative.y, relative.x)
      const liveDistance = relative.length()
      const newPullDistance = Math.max(0, Math.min(MAX_PULL_DISTANCE, liveDistance - 10));
      
      if (Math.abs(liveAngle - game.aimAngle) > 0.01 || Math.abs(newPullDistance - game.pullDistance) > 1) {
          game.showRemoteCue = false
          game.aimAngle = liveAngle
          game.pullDistance = newPullDistance
          GameClient.sendAim({ aimAngle: game.aimAngle, pullDistance: game.pullDistance });
      }
      e.preventDefault()
    }
  }

  /**
   * 鼠标/触摸结束的内部处理函数。
   */
  const end = () => {
    if (isSideControlGestureActive()) return
    if ((!GameClient.isMyTurn || (game.roomPhase !== 'PLAYING' && !game.ballInHand)) && !debugAlwaysDrag) {
      clearDragInteraction(game)
      return
    }
    if (game.awaitingSettledSync && !debugAlwaysDrag) {
      clearDragInteraction(game)
      return
    }

    // 结束白球摆放
    if (game.ballInHand && game.placingCue) {
      game.placingCue = false
      if (game.cuePlacementValid) {
        const kitchenPlacement = game.ballInHandZone === 'kitchen'
        game.ballInHand = false
        game.ballInHandZone = 'table'
        game.awaitingSettledSync = false
        game.isTurnLocked = false
        game.requiresKitchenBreakDirection = kitchenPlacement
        game.setStatusMessage(`玩家${game.currentPlayer}已摆好白球`, 1200)
        game.updateUI()
        GameClient.sendSync(game.createPlacementCommitSnapshot())
      } else {
        game.setStatusMessage('白球摆放位置无效', 1600)
      }
      return
    }

    releaseShotIfNeeded()

    if (!game.ballInHand && !debugAlwaysDrag) {
      GameClient.sendAim({ aimAngle: game.aimAngle, pullDistance: 0 });
    }
    clearDragInteraction(game)
  }

  // 注册事件监听器
  game.canvas.addEventListener('mousedown', start)
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', end)
  game.canvas.addEventListener('touchstart', start, { passive: false })
  window.addEventListener('touchmove', move, { passive: false })
  window.addEventListener('touchend', end)

  aimWheel?.addEventListener('pointerdown', beginAimWheelControl)
  aimWheel?.addEventListener('wheel', handleAimWheelScroll, { passive: false })
  powerStrip?.addEventListener('pointerdown', beginPowerStripControl)
  window.addEventListener('pointermove', moveAimWheelControl, { passive: false })
  window.addEventListener('pointermove', movePowerStripControl, { passive: false })
  window.addEventListener('pointerup', endAimWheelControl)
  window.addEventListener('pointercancel', cancelAimWheelControl)
  window.addEventListener('pointerup', endPowerStripControl)
  window.addEventListener('pointercancel', endPowerStripControl)
}
