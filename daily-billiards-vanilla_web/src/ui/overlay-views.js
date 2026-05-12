function byId(id) {
  return document.getElementById(id)
}

export function getOverlayViews() {
  return {
    authPanel: byId('auth-panel'),
    lobbyPanel: byId('lobby-panel'),
    matchmakingPanel: byId('matchmaking-panel'),
    authTabs: byId('auth-tabs'),
    loginForm: byId('login-form'),
    registerForm: byId('register-form'),
    authError: byId('error-msg'),
    lobbyError: byId('lobby-error-msg'),
    matchStatus: byId('match-status'),
    matchmakingTitle: byId('matchmaking-title'),
    matchmakingBadge: byId('matchmaking-badge'),
    matchmakingFootnote: byId('matchmaking-footnote'),
    currentRoomDisplay: byId('current-room-display'),
    roomIdVal: byId('room-id-val'),
    btnCancel: byId('btn-cancel'),
  }
}

export function showAuthView() {
  const { authPanel, lobbyPanel, matchmakingPanel } = getOverlayViews()
  authPanel?.classList.remove('hidden')
  lobbyPanel?.classList.add('hidden')
  matchmakingPanel?.classList.add('hidden')
}

export function showLobbyView() {
  const { authPanel, lobbyPanel, matchmakingPanel } = getOverlayViews()
  authPanel?.classList.add('hidden')
  lobbyPanel?.classList.remove('hidden')
  matchmakingPanel?.classList.add('hidden')
}

export function showMatchmakingView(message = '正在寻找对手...', options = {}) {
  const {
    authPanel,
    lobbyPanel,
    matchmakingPanel,
    matchStatus,
    matchmakingTitle,
    matchmakingBadge,
    matchmakingFootnote,
    currentRoomDisplay,
    roomIdVal,
    btnCancel,
  } = getOverlayViews()
  const {
    title = '正在寻找对手...',
    badge = '匹配中',
    footnote = '匹配成功后将自动进入对局。',
    roomId = '',
    state = 'matching',
    cancelLabel = '取消',
  } = options

  authPanel?.classList.add('hidden')
  // 匹配浮层是叠加在大厅壳层之上的，不切走 lobby，可以保留房间输入和个人信息上下文。
  lobbyPanel?.classList.remove('hidden')
  matchmakingPanel?.classList.remove('hidden')
  matchmakingPanel?.setAttribute('data-state', state)
  if (matchStatus) {
    matchStatus.innerText = message
  }
  if (matchmakingTitle) {
    matchmakingTitle.innerText = title
  }
  if (matchmakingBadge) {
    matchmakingBadge.innerText = badge
  }
  if (matchmakingFootnote) {
    matchmakingFootnote.innerText = footnote
  }
  if (btnCancel) {
    btnCancel.innerText = cancelLabel
  }
  if (currentRoomDisplay && roomIdVal) {
    if (roomId) {
      currentRoomDisplay.classList.remove('hidden')
      roomIdVal.innerText = roomId
    } else {
      currentRoomDisplay.classList.add('hidden')
      roomIdVal.innerText = ''
    }
  }
}

export function showGameView() {
  byId('ui-layer')?.classList.add('hidden')
}

export function showOverlay() {
  byId('ui-layer')?.classList.remove('hidden')
}

export function showOverlayError(message) {
  const { authPanel, authError, lobbyError } = getOverlayViews()
  // 错误落到当前正在看的面板，避免用户在大厅操作时消息却悄悄出现在登录区。
  const target = authPanel?.classList.contains('hidden') ? lobbyError : authError
  if (!target) return
  target.textContent = message
  target.classList.remove('hidden')
}

export function clearOverlayError() {
  const { authError, lobbyError } = getOverlayViews()
  for (const node of [authError, lobbyError]) {
    if (!node) continue
    node.textContent = ''
    node.classList.add('hidden')
  }
}
