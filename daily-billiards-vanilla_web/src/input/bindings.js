/**
 * @file bindings.js
 * @description 将用户输入事件（鼠标和触摸）绑定到游戏动作。
 * 处理瞄准、击球以及带网络同步的白球位置摆放。
 */

import {
  BALL_RADIUS,
  HEAD_STRING_X,
  MAX_PULL_DISTANCE,
  RELEASE_FLASH_DURATION,
  SHOT_POWER_SCALE,
} from '../constants.js'
import { Vec2 } from '../math.js'
import { GameClient } from '../network/game-client.js'
import { hasDebugAlwaysDrag } from '../layout/mode.js'

/**
 * 将当前的母球摆放位置同步给远程对手。
 * @param {BilliardsGame} game - 游戏实例。
 */
function syncCuePlacement(game) {
  GameClient.sendSync(game.getGameStateSnapshot())
}

/**
 * 将所有必要的输入监听器绑定到游戏画布和窗口。
 * 处理开始拖拽（瞄准）、移动（拖拽/悬停）以及结束拖拽（击球）的逻辑。
 * 
 * @param {BilliardsGame} game - 要绑定输入的游戏实例。
 */
export function bindGameInput(game) {
  const debugAlwaysDrag = hasDebugAlwaysDrag(window)
  /**
   * 鼠标/触摸开始的内部处理函数。
   * @param {MouseEvent|TouchEvent} e - 输入事件。
   */
  const start = (e) => {
    // 联机拦截：如果不是我的回合或回合已锁定，则不处理输入
    if ((!GameClient.isMyTurn || game.isTurnLocked) && !debugAlwaysDrag) return;

    game.audio.unlock()
    game.updatePos(e.touches ? e.touches[0] : e, game.ballInHand ? 'placement' : 'aim')
    
    // 处理“白球在手”状态下的摆球
    if (game.ballInHand) {
      game.placingCue = true
      game.tryPlaceCueBall()
      syncCuePlacement(game)
      return
    }

    if ((game.isMoving() || game.isGameOver || game.cueBall.pocketed) && !debugAlwaysDrag) return
    const aimVector = game.cueBall.pos.clone().sub(game.mousePos)
    if (aimVector.length() < 8) return
    game.isDragging = true
    if (debugAlwaysDrag) {
      game.cueBall.pocketed = false
      game.showRemoteCue = false
    }
    game.aimAngle = Math.atan2(aimVector.y, aimVector.x)
    game.pullDistance = 0
  }

  /**
   * 鼠标/触摸移动的内部处理函数。
   * @param {MouseEvent|TouchEvent} e - 输入事件。
   */
  const move = (e) => {
    if (!GameClient.isMyTurn && !debugAlwaysDrag) return;

    game.updatePos(e.touches ? e.touches[0] : e, game.ballInHand && game.placingCue ? 'placement' : 'aim')
    
    // 如果正在摆放白球
    if (game.ballInHand && game.placingCue) {
      game.tryPlaceCueBall()
      syncCuePlacement(game)
      e.preventDefault()
      return
    }

    // 悬停瞄准同步（非拖拽状态下）
    if (game.hasPointerInput && !game.isDragging && !game.isMoving() && !game.isGameOver && (!game.cueBall.pocketed || debugAlwaysDrag)) {
      const hoverAim = game.cueBall.pos.clone().sub(game.mousePos)
      if (hoverAim.length() > 4) {
        const newAngle = Math.atan2(hoverAim.y, hoverAim.x);
        if (Math.abs(newAngle - game.aimAngle) > 0.01) {
            game.showRemoteCue = false
            game.aimAngle = newAngle;
            GameClient.sendAim({ aimAngle: game.aimAngle, pullDistance: 0 });
        }
      }
    }

    // 处理拖拽拉杆（蓄力）逻辑
    if (game.isDragging) {
      const relative = game.cueBall.pos.clone().sub(game.mousePos)
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
    if (!GameClient.isMyTurn && !debugAlwaysDrag) return;

    // 结束白球摆放
    if (game.ballInHand && game.placingCue) {
      game.placingCue = false
      if (game.cuePlacementValid) {
        const kitchenPlacement = game.ballInHandZone === 'kitchen'
        game.ballInHand = false
        game.ballInHandZone = 'table'
        game.requiresKitchenBreakDirection = kitchenPlacement
        game.setStatusMessage(`玩家${game.currentPlayer}已摆好白球`, 1200)
        game.updateUI()
        syncCuePlacement(game)
      } else {
        game.setStatusMessage('白球摆放位置无效', 1600)
      }
      return
    }

    // 释放球杆执行击球
    if (game.isDragging) {
      const powerRatio = Math.max(0, Math.min(1, game.pullDistance / MAX_PULL_DISTANCE))
      if (powerRatio > 0.08) {
        game.showRemoteCue = false
        const aimDir = new Vec2(Math.cos(game.aimAngle), Math.sin(game.aimAngle))
        
        // 特殊规则：检查开球方向是否合法（如果需要限制在开球区内向前方击球）
        const breakGuide = game.requiresKitchenBreakDirection ? game.getAimGuide(aimDir) : null
        const crossesHeadString = !breakGuide || breakGuide.hitPoint.x > HEAD_STRING_X + BALL_RADIUS
        if (game.requiresKitchenBreakDirection && (!crossesHeadString || aimDir.x <= 0.08)) {
          game.isDragging = false
          game.pullDistance = 0
          game.setStatusMessage('开球方向无效', 1800)
          return
        }

        // --- 联机同步：发送击球消息 ---
        if (!debugAlwaysDrag) {
          GameClient.sendShoot({ aimAngle: game.aimAngle, powerRatio: powerRatio });
          GameClient.sendAim({ aimAngle: game.aimAngle, pullDistance: 0 });
        }

        const speed = 4 + Math.pow(powerRatio, 1.35) * 34
        game.cueBall.vel = aimDir.mul(speed * SHOT_POWER_SCALE * 7.2)
        game.ballPocketedThisTurn = false
        game.releaseFlash = RELEASE_FLASH_DURATION
        game.requiresKitchenBreakDirection = false
        game.audio.playShot(powerRatio)
        game.beginShot()
      }
    }

    if (!game.ballInHand && !debugAlwaysDrag) {
      GameClient.sendAim({ aimAngle: game.aimAngle, pullDistance: 0 });
    }
    game.pullDistance = 0
    game.isDragging = false
  }

  // 注册事件监听器
  game.canvas.addEventListener('mousedown', start)
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', end)
  game.canvas.addEventListener('touchstart', start, { passive: false })
  window.addEventListener('touchmove', move, { passive: false })
  window.addEventListener('touchend', end)
}
