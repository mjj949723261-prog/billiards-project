/**
 * @file rules.js
 * @description 实现中式八球规则。
 * 包括回合切换、自由球（白球在手）规则、球组分配以及击球合法性评估。
 */

import { TURN_TIME_LIMIT } from '../constants.js?v=20260512_table_surface_restore'

/**
 * 在产生第一个合法进球后，为玩家分配球组（全色或花色）。
 */
export function applyGroups(game, group) {
  if (!group) return
  game.playerGroups[game.currentPlayer] = group
  game.playerGroups[game.currentPlayer === 1 ? 2 : 1] = group === 'solid' ? 'stripe' : 'solid'
  game.setStatusMessage(`开放球局结束：玩家${game.currentPlayer}${group === 'solid' ? '打全色球' : '打花色球'}`, 2200)
}

/**
 * 将当前回合切换给另一名玩家。
 */
export function switchTurn(game, withBallInHand = false, ballInHandZone = 'table') {
  game.currentPlayer = game.currentPlayer === 1 ? 2 : 1
  game.ballInHand = withBallInHand
  game.ballInHandZone = withBallInHand ? ballInHandZone : 'table'
  game.requiresKitchenBreakDirection = false
  game.placingCue = false
  game.timeLeft = TURN_TIME_LIMIT
  game.lastTick = Date.now()
  game.displayedSecond = null
  game.isBreakShot = false
  if (withBallInHand) {
    game.ensureCueBallVisibleForBallInHand?.(true)
    const isMyTurn = (game.currentPlayer === game.playerIndex);
    if (isMyTurn) {
      game.setStatusMessage('自由球：请拖动母球放置', 3500)
    }
  }
  game.resetShotState()
  game.updateUI()
}

/**
 * 在所有球停止移动后，评估击球结果（中式八球规则）。
 */
export function evaluateShot(game) {
  if (!game.shotActive || game.isGameOver) return

  const currentPlayer = game.currentPlayer
  const currentGroup = game.shotState.playerGroupBefore
  const legalFirstTarget = game.getLegalFirstTargetType()
  const firstContact = game.shotState.firstContact
  const coloredPocketed = game.shotState.pocketedBalls.filter(ball => ball.type === 'solid' || ball.type === 'stripe')
  let foulMessage = ''

  // === 开球阶段特殊处理 ===
  if (game.isBreakShot) {
    // 开球打进8号球：不判负，重新开球
    if (game.shotState.eightPocketed) {
      game.setStatusMessage('开球打进黑八，重新开球', 2200)
      game.shotActive = false
      game.init()
      return
    }

    // 开球白球落袋：犯规，对手获得开球线后自由球
    if (game.shotState.cuePocketed) {
      game.setStatusMessage('开球犯规：白球落袋', 2200)
      game.audio.playFoul()
      game.shotActive = false
      switchTurn(game, true, 'kitchen')
      return
    }

    // 非法开球检查：至少4颗球碰库或有球入袋
    const legalBreak = coloredPocketed.length > 0 || game.shotState.railContacts >= 4
    if (!legalBreak) {
      game.setStatusMessage('非法开球（需进球或至少4颗球碰库）', 2200)
      game.audio.playFoul()
      game.shotActive = false
      switchTurn(game, true, 'kitchen')
      return
    }

    // 合法开球且有进球，分配球组
    if (!currentGroup && coloredPocketed.length > 0) {
      applyGroups(game, coloredPocketed[0].type)
    }

    // 合法开球有进球则继续，否则换人
    game.shotActive = false
    const resolvedGroup = game.playerGroups[currentPlayer]
    const ownPocketed = resolvedGroup
      ? game.shotState.pocketedBalls.filter(ball => ball.type === resolvedGroup).length
      : coloredPocketed.length

    if (ownPocketed > 0) {
      game.setStatusMessage(`玩家${currentPlayer}继续击球`, 1400)
      game.timeLeft = TURN_TIME_LIMIT
      game.lastTick = Date.now()
      game.isBreakShot = false
      game.resetShotState()
      game.updateUI()
      return
    }

    game.setStatusMessage(`轮到玩家${currentPlayer === 1 ? 2 : 1}`, 1600)
    switchTurn(game, false)
    return
  }

  // === 非开球阶段 ===

  // 黑八入袋判定
  if (game.shotState.eightPocketed) {
    const clearedGroup = currentGroup && game.shotState.remainingGroupBefore === 0
    if (game.shotState.cuePocketed || !clearedGroup) {
      game.setStatusMessage(game.shotState.cuePocketed ? '黑八阶段白球落袋，直接负局' : '黑八提前入袋，直接负局', 2400)
      game.endGame(currentPlayer === 1 ? 2 : 1)
      game.shotActive = false
      return
    }
    game.setStatusMessage(`玩家${currentPlayer}打进黑八，赢下本局`, 2200)
    game.endGame(currentPlayer)
    game.shotActive = false
    return
  }

  // 犯规检查
  if (game.shotState.cuePocketed) {
    foulMessage = '犯规：白球落袋'
  } else if (!firstContact) {
    foulMessage = '犯规：未碰到任何球'
  } else if (legalFirstTarget && firstContact.type !== legalFirstTarget) {
    foulMessage = legalFirstTarget === 'eight' ? '犯规：必须先碰黑八' : '犯规：未先碰到目标球'
  } else if (!currentGroup && firstContact.type === 'eight') {
    foulMessage = '犯规：开放球局不能先碰黑八'
  } else if (firstContact && coloredPocketed.length === 0 && game.shotState.railContactsAfterHit === 0) {
    // 中式八球规则：碰到目标球后，必须有至少一颗球碰库或有球入袋
    foulMessage = '犯规：碰球后无球碰库或入袋'
  }

  // 开放球局分配球组
  if (!foulMessage && !currentGroup && coloredPocketed.length > 0) {
    applyGroups(game, coloredPocketed[0].type)
  }

  // 处理犯规结果
  if (foulMessage) {
    game.setStatusMessage(foulMessage, 2200)
    game.audio.playFoul()
    game.shotActive = false
    switchTurn(game, true, 'table')
    return
  }

  // 评估是否继续击球或换人
  const resolvedGroup = game.playerGroups[currentPlayer]
  const resolvedOwnPocketed = resolvedGroup
    ? game.shotState.pocketedBalls.filter(ball => ball.type === resolvedGroup).length
    : 0
  game.shotActive = false
  if (resolvedOwnPocketed > 0) {
    game.setStatusMessage(`玩家${currentPlayer}继续击球`, 1400)
    game.timeLeft = TURN_TIME_LIMIT
    game.lastTick = Date.now()
    game.isBreakShot = false
    game.resetShotState()
    game.updateUI()
    return
  }

  game.setStatusMessage(`轮到玩家${currentPlayer === 1 ? 2 : 1}`, 1600)
  switchTurn(game, false)
}
