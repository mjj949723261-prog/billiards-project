/**
 * @file dom-ui.js
 * @description 负责管理游戏所有的 DOM 元素交互与 UI 显示。
 * 包含计分板更新、倒计时显示、球组状态展示以及击球力度条的实时渲染。
 */

import { GameClient } from '../network/game-client.js'
import { MAX_PULL_DISTANCE } from '../constants.js?v=20260429-room-entry-fix'

/**
 * 获取玩家的显示名称（包含“我”的标注）
 * @param {BilliardsGame} game 游戏实例
 * @param {number} playerNumber 玩家编号 (1 或 2)
 * @returns {string} 格式化后的玩家昵称
 */
function getPlayerDisplayName(game, playerNumber) {
  const playerId = playerNumber === 1 ? game.playerIdByNumber?.[1] : game.playerIdByNumber?.[2]
  const nickname = playerId ? GameClient.playerNames?.[playerId] : ''
  if (nickname) {
    return GameClient.playerIndex === playerNumber ? `${nickname}（我）` : nickname
  }
  return playerNumber === 1 ? '玩家一' : '玩家二'
}

/**
 * 获取头像徽标文字
 * @param {BilliardsGame} game 游戏实例
 * @param {number} playerNumber 玩家编号
 * @returns {string} 徽标文本
 */
function getPlayerAvatarText(game, playerNumber) {
  const displayName = getPlayerDisplayName(game, playerNumber).replace(/（我）$/, '')
  return displayName.trim().charAt(0) || String(playerNumber)
}

/**
 * 全量更新游戏 UI 状态
 * 包含计分板布局适配、分数同步、力度条填充、阴影反馈以及球列表渲染。
 * @param {BilliardsGame} game 游戏主实例
 */
export function updateGameUi(game) {
  const shouldUseSideBySideHud = true
  const p1 = document.getElementById('player1-score')
  const p2 = document.getElementById('player2-score')

  // --- 1. 布局适配 ---
  const isP1Me = (GameClient.playerIndex === 1);
  p1.style.order = ''
  p2.style.order = ''

  const activePlayerCard = game.currentPlayer === 1 ? p1 : p2
  const inactivePlayerCard = game.currentPlayer === 1 ? p2 : p1

  // --- 2. 身份与当前回合同步 ---
  p1.querySelector('.player-name').innerText = getPlayerDisplayName(game, 1)
  p2.querySelector('.player-name').innerText = getPlayerDisplayName(game, 2)
  const p1Avatar = document.getElementById('p1-avatar')
  const p2Avatar = document.getElementById('p2-avatar')
  if (p1Avatar) p1Avatar.innerText = getPlayerAvatarText(game, 1)
  if (p2Avatar) p2Avatar.innerText = getPlayerAvatarText(game, 2)
  
  p1.classList.toggle('is-me', isP1Me)
  p2.classList.toggle('is-me', !isP1Me)

  p1.classList.toggle('active', game.currentPlayer === 1)
  p2.classList.toggle('active', game.currentPlayer === 2)
  
  // --- 3. 打击力度条渲染 ---
  // 核心逻辑：只有当前轮到的玩家是我自己时，才显示力度条数值。对手拖动时我不应看到力度。
  const isMyTurn = (game.currentPlayer === GameClient.playerIndex);
  const powerPercent = isMyTurn ? Math.min(100, (game.pullDistance / MAX_PULL_DISTANCE) * 100) : 0;
  
  const powerStripFill = document.getElementById('power-strip-fill')
  const powerStrip = document.getElementById('power-strip')
  const aimWheel = document.getElementById('aim-wheel')
  const aimWheelIndicator = document.getElementById('aim-wheel-indicator')
  
  if (powerStripFill) {
    powerStripFill.style.height = `${powerPercent}%`
    powerStripFill.style.width = ''
    powerStripFill.style.opacity = isMyTurn ? '1' : '0.35'
  }

  if (powerStrip) {
    powerStrip.classList.toggle('has-power', powerPercent > 0)
  }

  if (aimWheel) {
    aimWheel.classList.toggle('is-disabled', !isMyTurn || game.ballInHand || game.isGameOver)
    aimWheel.style.setProperty('--aim-arc-rotation', `${game.aimAngle}rad`)
    const aimWheelTickPitch = 52
    const aimWheelOffset = ((((game.aimAngle * 180) / Math.PI) * 88) % aimWheelTickPitch + aimWheelTickPitch) % aimWheelTickPitch
    aimWheel.style.setProperty('--aim-wheel-offset', `${aimWheelOffset}px`)
  }

  if (aimWheelIndicator) {
    aimWheelIndicator.style.transform = 'translateY(-50%)'
  }

  // --- 4. 渲染列表与计时器 ---
  updateTimerUi(game)
  renderBallList(game, 1, game.playerGroups[1])
  renderBallList(game, 2, game.playerGroups[2])
}

/**
 * 更新倒计时显示逻辑
 * @param {BilliardsGame} game 游戏实例
 */
export function updateTimerUi(game) {
  const p1SideTimer = document.getElementById('p1-side-timer')
  const p2SideTimer = document.getElementById('p2-side-timer')
  const hudTurnTimer = document.getElementById('hud-turn-timer')

  if (p1SideTimer) {
    p1SideTimer.classList.add('hidden')
    p1SideTimer.classList.remove('urgent')
    p1SideTimer.innerText = ''
  }

  if (p2SideTimer) {
    p2SideTimer.classList.add('hidden')
    p2SideTimer.classList.remove('urgent')
    p2SideTimer.innerText = ''
  }
  
  // 直接使用已经在 game.js 中处理好的 displayedSecond
  // 如果是 -1（正在运动）或者 0（时间到），就隐藏
  const displayVal = game.displayedSecond

  if (displayVal <= 0) {
    if (hudTurnTimer) {
      hudTurnTimer.classList.add('hidden')
      hudTurnTimer.classList.remove('urgent')
      hudTurnTimer.innerText = ''
    }
  } else {
    if (hudTurnTimer) {
      hudTurnTimer.innerText = displayVal
      hudTurnTimer.classList.remove('hidden')
      hudTurnTimer.classList.toggle('urgent', displayVal <= 10)
    }
  }
}

/**
 * 渲染玩家剩余目标球摘要
 * @param {BilliardsGame} game 游戏实例
 * @param {number} num 玩家编号
 * @param {string|null} group 球组类型
 */
export function renderBallList(game, num, group) {
  const container = document.getElementById(`p${num}-balls`)
  if (!container) return
  container.innerHTML = ''

  // 若尚未分配球组，显示 8 个空占位，避免提前暗示花色分组
  if (!group) {
    for (let index = 0; index < 8; index++) {
      container.appendChild(createPlaceholderMiniBall())
    }
    return
  }
  
  const remainingTargets = game.balls
    .filter(ball => ball.type === group)
    .filter(ball => !ball.pocketed)
    .sort((a, b) => parseInt(a.label) - parseInt(b.label))

  remainingTargets.forEach(ball => container.appendChild(createMiniBall(ball)))

  if (remainingTargets.length === 0) {
    const eightBall = game.balls.find(ball => ball.type === 'eight')
    if (eightBall) {
      const eightEl = createMiniBall(eightBall)
      eightEl.classList.add('eight-target')
      container.appendChild(eightEl)
    }
  }
}

/**
 * 创建一个小球 DOM 节点
 * @param {Ball} ball 球实体对象
 * @returns {HTMLElement} 包含球样式的 div 元素
 */
export function createMiniBall(ball) {
  const el = document.createElement('div')
  el.className = 'mini-ball' +
    (ball.type === 'stripe' ? ' stripe' : '') +
    (ball.pocketed ? ' pocketed' : '') +
    (ball.type === 'eight' ? ' eight' : '')
  el.style.setProperty('--ball-color', ball.color)

  const label = document.createElement('span')
  label.className = 'mini-ball-label'
  label.textContent = ball.label
  el.appendChild(label)

  return el
}

/**
 * 创建占位小球 DOM 节点 (未确定球组时使用)
 * @returns {HTMLElement} 占位 div 元素
 */
export function createPlaceholderMiniBall() {
  const el = document.createElement('div')
  el.className = 'mini-ball placeholder'
  el.setAttribute?.('aria-hidden', 'true')
  return el
}
