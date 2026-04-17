import { AuthService } from '../network/auth-service.js'

export function bindAuthActions({ onLoggedIn, onGuestMode, showError, clearError }) {
  document.getElementById('tab-login').addEventListener('click', () => {
    document.getElementById('tab-login').classList.add('active')
    document.getElementById('tab-register').classList.remove('active')
    document.getElementById('login-form').classList.remove('hidden')
    document.getElementById('register-form').classList.add('hidden')
    clearError()
  })

  document.getElementById('tab-register').addEventListener('click', () => {
    document.getElementById('tab-register').classList.add('active')
    document.getElementById('tab-login').classList.remove('active')
    document.getElementById('register-form').classList.remove('hidden')
    document.getElementById('login-form').classList.add('hidden')
    clearError()
  })

  document.getElementById('btn-login').addEventListener('click', async () => {
    const user = document.getElementById('login-username').value.trim()
    const pass = document.getElementById('login-password').value
    if (!user || !pass) return showError('请输入用户名和密码')

    try {
      await AuthService.login(user, pass)
      clearError()
      onLoggedIn(AuthService.getUser())
    } catch (err) {
      showError(err.message)
    }
  })

  document.getElementById('btn-register').addEventListener('click', async () => {
    const user = document.getElementById('reg-username').value.trim()
    const nick = document.getElementById('reg-nickname').value.trim()
    const email = document.getElementById('reg-email').value.trim()
    const pass = document.getElementById('reg-password').value

    if (!user || !nick || !email || !pass) return showError('请填写所有注册信息')

    try {
      await AuthService.register({ username: user, nickname: nick, email, password: pass })
      alert('注册成功，请登录')
      document.getElementById('tab-login').click()
    } catch (err) {
      showError(err.message)
    }
  })

  document.getElementById('btn-guest-play').addEventListener('click', () => {
    clearError()
    onGuestMode({ nickname: '游客玩家', username: 'guest' })
  })
}
