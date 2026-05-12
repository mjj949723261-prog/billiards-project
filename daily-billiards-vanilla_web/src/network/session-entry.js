/**
 * @file session-entry.js
 * @description 基于 URL 参数和本地历史存储解析房间加入逻辑。
 * 确定用户在页面加载时是否应自动加入某个房间。
 */

/**
 * 为当前会话解析初始房间状态。
 * @param {string|null} roomFromUrl - 从 URL 参数 'room' 中提取出的房间 ID。
 * @param {string|null} lastRoomId - 从 localStorage 中检索到的上一次加入的房间 ID。
 * @returns {Object} 包含 'autoJoinRoomId'（自动加入的 ID）和 'suggestedRoomId'（建议填写的 ID）的对象。
 */
export function resolveRoomEntry(roomFromUrl, lastRoomId) {
  return {
    // 显式分享链接优先级最高，只要 URL 带 room 就直接按该房间处理。
    autoJoinRoomId: roomFromUrl || null,
    // 历史房间只用于输入框提示，不能反过来覆盖外部分享链接的目标房间。
    suggestedRoomId: roomFromUrl || lastRoomId || '',
  }
}
