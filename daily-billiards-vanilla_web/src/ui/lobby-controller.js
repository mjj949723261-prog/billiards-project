function deriveLobbyStats(seedSource = '') {
  const seedText = String(seedSource || 'guest')
  let hash = 0
  for (const char of seedText) {
    hash = ((hash << 5) - hash) + char.charCodeAt(0)
    hash |= 0
  }

  const normalized = Math.abs(hash)
  return {
    score: 18000 + (normalized % 9000),
    winrate: `${52 + (normalized % 19)}%`,
    totalGames: 80 + (normalized % 220),
    heroValue: 68000 + (normalized % 18000),
  }
}

export function renderLobbyProfile(user) {
  const profile = user || { username: 'guest', nickname: '游客玩家' }
  const stats = deriveLobbyStats(profile.username || profile.nickname)

  document.getElementById('display-nickname').textContent = profile.nickname || '玩家'
  document.getElementById('display-username').textContent = `@${profile.username || 'guest'}`
  document.getElementById('display-rank').textContent = stats.heroValue
  document.getElementById('display-score').textContent = stats.score
  document.getElementById('display-winrate').textContent = stats.winrate
  document.getElementById('display-total-games').textContent = stats.totalGames
}

export function bindLobbyActions({ onPrimaryMatch, onJoinRoom, onLogout }) {
  document.getElementById('btn-match').addEventListener('click', () => {
    onPrimaryMatch()
  })

  document.getElementById('btn-room-join').addEventListener('click', () => {
    const roomId = document.getElementById('room-id-input').value.trim()
    onJoinRoom(roomId)
  })

  document.getElementById('btn-room-focus').addEventListener('click', async () => {
    const roomInput = document.getElementById('room-id-input')
    roomInput.focus()
    roomInput.select()

    if (!navigator.clipboard?.readText) return

    try {
      const clipboardText = (await navigator.clipboard.readText()).trim()
      if (clipboardText) {
        roomInput.value = clipboardText.slice(0, roomInput.maxLength || 8)
      }
    } catch (error) {
      console.warn('[Lobby] Unable to read clipboard room id:', error)
    }
  })

  document.getElementById('room-id-input').addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    document.getElementById('btn-room-join').click()
  })

  document.getElementById('btn-logout').addEventListener('click', onLogout)
}
