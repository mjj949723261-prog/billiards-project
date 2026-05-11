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
import { GameClient } from '../network/game-client.js?v=20260509_room_join_snapshot_fix'
import { hasDebugAlwaysDrag, isPortraitHeldLandscapeSemanticMobile } from '../layout/mode.js'
import { buildSettledSnapshotPayload } from '../network/shot-state.js'

export function computePowerStripRatio(point, rect, { portraitHeldLandscapeSemanticMobile = false } = {}) {
  const width = Math.max(rect?.width ?? 0, 1)
  const height = Math.max(rect?.height ?? 0, 1)
  const clientX = point?.clientX ?? 0
  const clientY = point?.clientY ?? 0

  // In portrait-held landscape mode the whole app shell is rotated 90deg.
  // The visual strip axis is horizontal, so physical clientY is the wrong axis.
  if (portraitHeldLandscapeSemanticMobile || width > height) {
    return Math.max(0, Math.min(1, (clientX - rect.left) / width))
  }

  return Math.max(0, Math.min(1, (rect.bottom - clientY) / height))
}

export function computeAimWheelDelta(previousPoint, currentPoint, { portraitHeldLandscapeSemanticMobile = false } = {}) {
  if (!previousPoint || !currentPoint) return 0

  // Match the semantic vertical wheel axis after the landscape shell is rotated.
  if (portraitHeldLandscapeSemanticMobile) {
    return (previousPoint.clientX ?? 0) - (currentPoint.clientX ?? 0)
  }

  return (currentPoint.clientY ?? 0) - (previousPoint.clientY ?? 0)
}

export function computeAimWheelTextureOffset(currentOffset, deltaY) {
  return currentOffset - deltaY
}

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
  const gameInputTarget = game.canvas
  const powerStrip = document.getElementById('power-strip')
  const aimWheel = document.getElementById('aim-wheel')
  const leftControlColumn = document.querySelector('.control-column-left')
  const rightControlColumn = document.querySelector('.control-column-right')
  let activeAimPointerId = null
  let activePowerPointerId = null
  let lastAimPointerPoint = null
  let pendingAimDegrees = 0
  let aimWheelTextureOffsetPx = 0
  const AIM_STEP_RADIANS = Math.PI / 180
  const AIM_STEP_DEGREES = 1
  // 简化滚轮参数，提高跟手性
  const AIM_PIXELS_PER_STEP = 2.5  // 降低阈值，更灵敏
  const AIM_ACCEL_START_PIXELS = 20  // 提高加速起始点
  const AIM_ACCEL_MAX_MULTIPLIER = 1.8  // 降低最大加速倍数
  const AIM_WHEEL_SCROLL_STEP_DEGREES = 0.2  // 增加滚轮步进
  const AIM_WHEEL_TICK_PITCH = 52
  const AIM_WHEEL_PIXELS_PER_DEGREE = 88
  let aimWheelStepPulseTimer = null
  let aimWheelActiveTimer = null

  const isSideControlGestureActive = () => activePowerPointerId !== null || activeAimPointerId !== null

  const suppressNativeLongPressBehavior = (e) => {
    if (e.pointerType === 'mouse') return
    if (e.cancelable) e.preventDefault()
  }

  let nativeLongPressBlockTimer = null

  const keepSuppressingDuringLongPressWindow = () => {
    if (nativeLongPressBlockTimer) window.clearTimeout(nativeLongPressBlockTimer)
    const startedAt = Date.now()
    const suppressSelectionFrame = () => {
      try {
        const selection = window.getSelection?.()
        if (selection) {
          selection.removeAllRanges()
          // 额外清理 iOS WebView 的选择状态
          if (selection.empty) selection.empty()
        }
        // 清理 document 级别的选择
        if (document.selection) {
          document.selection.empty()
        }
      } catch (e) {
        // 忽略选择清理错误
      }
      if (Date.now() - startedAt < 1200) {
        nativeLongPressBlockTimer = window.setTimeout(suppressSelectionFrame, 40)
      } else {
        nativeLongPressBlockTimer = null
      }
    }
    suppressSelectionFrame()
  }

  const stopLongPressSelectionBlock = () => {
    if (!nativeLongPressBlockTimer) return
    window.clearTimeout(nativeLongPressBlockTimer)
    nativeLongPressBlockTimer = null
  }

  const registerNativeGestureSuppressors = (el, { blockPointer = false, blockTouch = false } = {}) => {
    if (!el) return
    const eventOptions = { capture: true, passive: false }
    if (blockPointer) {
      el.addEventListener('pointerdown', suppressNativeLongPressBehavior, eventOptions)
      el.addEventListener('pointermove', suppressNativeLongPressBehavior, eventOptions)
    }
    if (blockTouch) {
      el.addEventListener('touchstart', suppressNativeLongPressBehavior, eventOptions)
      el.addEventListener('touchmove', suppressNativeLongPressBehavior, eventOptions)
      el.addEventListener('touchstart', keepSuppressingDuringLongPressWindow, eventOptions)
      el.addEventListener('touchend', stopLongPressSelectionBlock, eventOptions)
      el.addEventListener('touchcancel', stopLongPressSelectionBlock, eventOptions)
    }
    el.addEventListener('contextmenu', suppressNativeLongPressBehavior, eventOptions)
    el.addEventListener('dragstart', suppressNativeLongPressBehavior, eventOptions)
    el.addEventListener('selectstart', suppressNativeLongPressBehavior, eventOptions)
    el.addEventListener('gesturestart', suppressNativeLongPressBehavior, eventOptions)
  }

  game.canvas.draggable = false
  game.canvas.setAttribute('draggable', 'false')
  game.canvas.style.webkitUserDrag = 'none'
  game.canvas.style.webkitTouchCallout = 'none'
  game.canvas.style.webkitUserSelect = 'none'
  game.canvas.style.userSelect = 'none'

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

  const updatePowerFromPoint = (point) => {
    if (!powerStrip) return
    const rect = powerStrip.getBoundingClientRect()
    const ratio = computePowerStripRatio(point, rect, {
      portraitHeldLandscapeSemanticMobile: isPortraitHeldLandscapeSemanticMobile(document),
    })
    const nextPullDistance = ratio * MAX_PULL_DISTANCE

    // 始终更新本地状态，保持完全跟手
    game.pullDistance = nextPullDistance

    // 网络同步使用较小的阈值，避免过度发送但保持流畅
    if (!debugAlwaysDrag && Math.abs(nextPullDistance - (game.lastSyncedPullDistance || 0)) > 1.5) {
      game.lastSyncedPullDistance = nextPullDistance
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
    }, 50)  // 缩短反馈时间，更快速
  }

  const syncAimWheelVisual = () => {
    if (!aimWheel) return
    const aimDegrees = (game.aimAngle * 180) / Math.PI
    const aimWheelOffset = ((aimDegrees * AIM_WHEEL_PIXELS_PER_DEGREE) % AIM_WHEEL_TICK_PITCH + AIM_WHEEL_TICK_PITCH) % AIM_WHEEL_TICK_PITCH
    aimWheel.style.setProperty('--aim-arc-rotation', `${game.aimAngle}rad`)
    aimWheel.style.setProperty('--aim-wheel-offset', `${aimWheelOffset}px`)
  }

  const scrollAimWheelTexture = (deltaY) => {
    if (!aimWheel || Math.abs(deltaY) <= 0.001) return
    aimWheelTextureOffsetPx = computeAimWheelTextureOffset(aimWheelTextureOffsetPx, deltaY)
    aimWheel.style.setProperty('--aim-wheel-texture-offset', `${aimWheelTextureOffsetPx}px`)
  }

  const applyAimWheelStepCount = (stepCount) => {
    if (stepCount === 0) return false
    game.aimAngle += stepCount * AIM_STEP_RADIANS
    game.showRemoteCue = false
    syncAimWheelVisual()
    pulseAimWheelFeedback()

    // 使用节流减少网络同步频率
    if (!game.lastAimSyncTime || Date.now() - game.lastAimSyncTime > 50) {
      game.lastAimSyncTime = Date.now()
      GameClient.sendAim({ aimAngle: game.aimAngle, pullDistance: game.pullDistance })
    }
    return true
  }

  const stepAimWheelByDeltaY = (deltaY) => {
    if (Math.abs(deltaY) <= 0.001) return false

    // 简化逻辑：使用更线性的响应，减少加速度影响
    const absTangentialDelta = Math.abs(deltaY)
    let accelMultiplier = 1

    // 只在快速滑动时轻微加速
    if (absTangentialDelta > AIM_ACCEL_START_PIXELS) {
      const extraRatio = Math.min(
        1,
        (absTangentialDelta - AIM_ACCEL_START_PIXELS) / 40
      )
      accelMultiplier = 1 + extraRatio * (AIM_ACCEL_MAX_MULTIPLIER - 1)
    }

    // 直接转换为角度变化，更跟手
    const degreesChange = (deltaY * accelMultiplier) / AIM_PIXELS_PER_STEP
    pendingAimDegrees += degreesChange

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
    lastAimPointerPoint = { clientX: e.clientX, clientY: e.clientY }
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
    const currentPoint = { clientX: e.clientX, clientY: e.clientY }
    const deltaY = computeAimWheelDelta(lastAimPointerPoint, currentPoint, {
      portraitHeldLandscapeSemanticMobile: isPortraitHeldLandscapeSemanticMobile(document),
    })
    lastAimPointerPoint = currentPoint
    scrollAimWheelTexture(deltaY)
    stepAimWheelByDeltaY(deltaY)
    e.stopPropagation()
    e.preventDefault()
  }

  const handleAimWheelScroll = (e) => {
    if (!aimWheel || !canControlShot()) return
    // wheel 事件本身只会在命中元素时触发，这里允许用户在可见拨轮区域内直接滚动，
    // 不再额外要求命中极窄的弧带采样区，避免”看得见但滚不动”的挫败感。
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

    // 简化滚轮步进计算
    const direction = e.deltaY >= 0 ? 1 : -1
    scrollAimWheelTexture(direction * AIM_PIXELS_PER_STEP)
    const stepCount = direction * AIM_WHEEL_SCROLL_STEP_DEGREES
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
      }, 60)  // 缩短激活状态持续时间
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
    lastAimPointerPoint = null
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
    // 确保点击在力度条内部
    const rect = powerStrip.getBoundingClientRect()
    if (e.clientX < rect.left || e.clientX > rect.right ||
        e.clientY < rect.top || e.clientY > rect.bottom) return

    game.audio.unlock()
    activePowerPointerId = e.pointerId
    game.hasPointerInput = false
    game.isDragging = true
    game.showRemoteCue = false
    powerStrip.classList.add('is-active')
    powerStrip.setPointerCapture?.(e.pointerId)
    updatePowerFromPoint(e)
    e.stopPropagation()
    e.preventDefault()
  }

  const movePowerStripControl = (e) => {
    if (activePowerPointerId === null || e.pointerId !== activePowerPointerId) return
    updatePowerFromPoint(e)
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

  const cancelPowerStripControl = (e) => {
    if (activePowerPointerId === null || e.pointerId !== activePowerPointerId) return
    releasePointerCaptureSafely(powerStrip, e.pointerId)
    activePowerPointerId = null
    powerStrip.classList.remove('is-active')
    // 取消时不发射球，直接清理状态
    clearDragInteraction(game)
    if (!game.ballInHand && !debugAlwaysDrag) {
      GameClient.sendAim({ aimAngle: game.aimAngle, pullDistance: 0 })
    }
  }

  /**
   * 鼠标/触摸开始的内部处理函数。
   * @param {MouseEvent|TouchEvent} e - 输入事件。
   */
  const start = (e) => {
    e.preventDefault()
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
    e.preventDefault()
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
  registerNativeGestureSuppressors(gameInputTarget, { blockPointer: true, blockTouch: true })
  registerNativeGestureSuppressors(leftControlColumn, { blockTouch: true })
  registerNativeGestureSuppressors(rightControlColumn, { blockTouch: true })
  registerNativeGestureSuppressors(aimWheel, { blockPointer: true, blockTouch: true })
  registerNativeGestureSuppressors(powerStrip, { blockPointer: true, blockTouch: true })

  // 画布的鼠标和触摸事件
  gameInputTarget.addEventListener('mousedown', start)
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', end)
  gameInputTarget.addEventListener('touchstart', start, { passive: false })
  window.addEventListener('touchmove', move, { passive: false })
  window.addEventListener('touchend', end)

  // 方向滚轮的 pointer 事件
  aimWheel?.addEventListener('pointerdown', beginAimWheelControl)
  aimWheel?.addEventListener('wheel', handleAimWheelScroll, { passive: false })

  // 力度条的 pointer 事件
  powerStrip?.addEventListener('pointerdown', beginPowerStripControl)

  // 全局 pointer 移动和结束事件（统一处理两个控制器）
  const handlePointerMove = (e) => {
    moveAimWheelControl(e)
    movePowerStripControl(e)
  }

  const handlePointerUp = (e) => {
    endAimWheelControl(e)
    endPowerStripControl(e)
  }

  const handlePointerCancel = (e) => {
    cancelAimWheelControl(e)
    cancelPowerStripControl(e)
  }

  window.addEventListener('pointermove', handlePointerMove, { passive: false })
  window.addEventListener('pointerup', handlePointerUp)
  window.addEventListener('pointercancel', handlePointerCancel)
}
