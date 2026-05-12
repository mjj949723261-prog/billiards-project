/**
 * @file state-sync.js
 * @description 处理游戏状态中非物理部分的同步逻辑。
 * 目前主要负责同步状态提示消息（Toast）及其显示时长。
 */

/**
 * 创建当前游戏状态提示消息的同步快照。
 * @param {BilliardsGame} game - 游戏实例。
 * @param {number} [now=Date.now()] - 当前时间戳。
 * @returns {Object} 包含提示消息和剩余显示时长的快照对象。
 */
export function createStatusSyncSnapshot(game, now = Date.now()) {
  return {
    // Sync the remaining lifetime instead of an absolute timestamp so peers can
    // recreate the toast consistently even when their clocks differ a little.
    statusMessage: game.statusMessage || '',
    statusRemainingMs: Math.max(0, (game.statusUntil || 0) - now),
  }
}

/**
 * 将接收到的状态同步快照应用到游戏实例。
 * @param {BilliardsGame} game - 游戏实例。
 * @param {Object} snapshot - 状态快照数据。
 * @param {number} [now=Date.now()] - 当前时间戳。
 * @returns {boolean} 是否成功应用了状态更新。
 */
export function applyStatusSync(game, snapshot, now = Date.now()) {
  if (!snapshot || !snapshot.statusMessage || !snapshot.statusRemainingMs) {
    return false
  }

  game.statusMessage = snapshot.statusMessage
  game.statusUntil = now + snapshot.statusRemainingMs
  return true
}
