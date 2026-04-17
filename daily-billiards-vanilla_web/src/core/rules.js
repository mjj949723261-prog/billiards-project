/**
 * @file rules.js
 * @description 实现标准的 8 号球台球规则。
 * 包括回合切换、自由球（白球在手）规则、球组分配以及击球合法性评估。
 */

import { HEAD_STRING_X, TURN_TIME_LIMIT, TABLE_WIDTH } from '../constants.js'
import { Vec2 } from '../math.js'

/**
 * 在产生第一个合法进球后，为玩家分配球组（全色或花色）。
 * @param {BilliardsGame} game - 游戏实例。
 * @param {string} group - 要分配给当前玩家的球组类型（'solid' 全色 或 'stripe' 花色）。
 */
export function applyGroups(game, group) {
  if (!group) return
  game.playerGroups[game.currentPlayer] = group
  game.playerGroups[game.currentPlayer === 1 ? 2 : 1] = group === 'solid' ? 'stripe' : 'solid'
  game.setStatusMessage(`开放球局结束：玩家${game.currentPlayer}${group === 'solid' ? '打全色球' : '打花色球'}`, 2200)
}

/**
 * 将当前回合切换给另一名玩家。
 * @param {BilliardsGame} game - 游戏实例。
 * @param {boolean} [withBallInHand=false] - 下一名玩家是否获得“白球在手”（自由球）机会。
 * @param {string} [ballInHandZone='table'] - 允许放置白球的区域（'table' 全场 或 'kitchen' 开球区/开球线后）。
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
    game.cueBall.pocketed = false
    game.cueBall.pos = new Vec2(game.ballInHandZone === 'kitchen' ? HEAD_STRING_X : -TABLE_WIDTH / 4, 0)
    game.cueBall.vel = new Vec2(0, 0)
    game.lastValidCuePosition = game.cueBall.pos.clone()
    game.cuePlacementValid = game.isCuePlacementLegal(game.cueBall.pos)
    
    // 加强自由球提示
    const isMyTurn = (game.currentPlayer === game.playerIndex);
    if (isMyTurn) {
        game.setStatusMessage('自由球：请拖动母球放置', 3500)
    }
  }
  game.resetShotState()
  game.updateUI()
}

/**
 * 在所有球停止移动后，评估击球结果。
 * 检查是否犯规、是否有进球，并决定是否需要切换回合。
 * 
 * @param {BilliardsGame} game - 游戏实例。
 */
export function evaluateShot(game) {
  if (!game.shotActive || game.isGameOver) return

  const currentPlayer = game.currentPlayer
  const currentGroup = game.shotState.playerGroupBefore
  const legalFirstTarget = game.getLegalFirstTargetType()
  const firstContact = game.shotState.firstContact
  const coloredPocketed = game.shotState.pocketedBalls.filter(ball => ball.type === 'solid' || ball.type === 'stripe')
  let foulMessage = ''

  // 检查黑八入袋情况
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

  // 检查开球合法性
  if (game.isBreakShot) {
    const legalBreak = game.shotState.cuePocketed || coloredPocketed.length > 0 || game.shotState.railContacts >= 4
    if (!legalBreak) {
      foulMessage = '非法开球（需进球或至少4颗球碰库）'
    }
  }

  // 检查常规犯规
  if (!foulMessage && game.shotState.cuePocketed) {
    foulMessage = '犯规：白球落袋'
  } else if (!firstContact) {
    foulMessage = '犯规：未碰到任何球'
  } else if (legalFirstTarget && firstContact.type !== legalFirstTarget) {
    foulMessage = legalFirstTarget === 'eight' ? '犯规：必须先碰黑八' : '犯规：未先碰到目标球'
  } else if (!currentGroup && firstContact.type === 'eight') {
    foulMessage = '犯规：开放球局不能先碰黑八'
  }

  // 开放球局下的进球分配球组
  if (!foulMessage && !currentGroup && coloredPocketed.length > 0) {
    applyGroups(game, coloredPocketed[0].type)
  }

  // 处理犯规结果
  if (foulMessage) {
    game.setStatusMessage(foulMessage, 2200)
    game.audio.playFoul()
    game.shotActive = false
    switchTurn(game, true, game.isBreakShot ? 'kitchen' : 'table')
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
