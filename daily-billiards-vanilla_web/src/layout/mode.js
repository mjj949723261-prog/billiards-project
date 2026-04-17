/**
 * @file mode.js
 * @description 处理响应式布局模式的检测与应用。
 * 支持基于窗口尺寸或显式覆盖（Override）在竖屏和横屏模式之间切换。
 */

/** @type {Set<string>} 有效布局模式字符串的集合。 */
const VALID_LAYOUT_MODES = new Set(['portrait', 'landscape', 'embedded-portrait'])

/**
 * 从全局配置或 URL 参数中解析请求的布局模式。
 * @param {Window} [win=globalThis.window] - 要检查的窗口对象。
 * @returns {string|null} 解析出的布局模式，如果未指定则返回 null。
 */
export function resolveRequestedLayoutMode(win = globalThis.window) {
  const explicitMode = win?.BILLIARDS_LAYOUT_MODE
  if (VALID_LAYOUT_MODES.has(explicitMode)) {
    return explicitMode
  }

  const search = win?.location?.search
  if (!search) return null

  const params = new URLSearchParams(search)
  const paramMode = params.get('layout')
  return VALID_LAYOUT_MODES.has(paramMode) ? paramMode : null
}

export function hasDebugAlwaysDrag(win = globalThis.window) {
  const search = win?.location?.search
  if (!search) return false

  const params = new URLSearchParams(search)
  return params.get('debugAlwaysDrag') === '1'
}

export function isLandscapeSemanticMobile(doc = globalThis.document) {
  const body = doc?.body
  return !!(body?.classList.contains('layout-landscape')
    && body?.classList.contains('pointer-coarse'))
}

export function isPortraitHeldLandscapeSemanticMobile(doc = globalThis.document) {
  const body = doc?.body
  return isLandscapeSemanticMobile(doc) && !!body?.classList.contains('viewport-portrait')
}

/**
 * 确定当前布局是否应为竖屏（Portrait）。
 * @param {Window} [win=globalThis.window] - 要检查的窗口对象。
 * @returns {boolean} 如果布局为竖屏，则返回 true。
 */
export function isPortraitLayout(win = globalThis.window) {
  const explicitMode = resolveRequestedLayoutMode(win)
  if (explicitMode === 'portrait') {
    return true
  }
  if (explicitMode === 'landscape') {
    return false
  }

  const width = win?.innerWidth ?? 0
  const height = win?.innerHeight ?? 0
  return height >= width
}

export function shouldRotateGameplayStage(doc = globalThis.document, win = globalThis.window) {
  return isLandscapeSemanticMobile(doc) ? false : isPortraitLayout(win)
}

export function shouldRemapGameplayInput(doc = globalThis.document, win = globalThis.window) {
  return isLandscapeSemanticMobile(doc) ? false : isPortraitLayout(win)
}

/**
 * 通过 CSS 类将计算出的布局模式应用到文档主体（body）。
 * @param {Document} [doc=globalThis.document] - 要修改的文档对象。
 * @param {Window} [win=globalThis.window] - 要检查的窗口对象。
 * @returns {Object} 包含应用状态（portrait, explicitMode, coarsePointer）的对象。
 */
export function applyLayoutMode(doc = globalThis.document, win = globalThis.window) {
  const body = doc?.body
  const root = doc?.documentElement
  const explicitMode = resolveRequestedLayoutMode(win)
  const viewportWidth = Number(root?.clientWidth) > 0
    ? root.clientWidth
    : (win?.innerWidth ?? 0)
  const viewportHeight = Number(root?.clientHeight) > 0
    ? root.clientHeight
    : (win?.innerHeight ?? 0)
  const viewportPortrait = explicitMode === 'embedded-portrait'
    ? true
    : viewportHeight >= viewportWidth
  
  // 检查是否为粗略指针设备（如触摸屏）
  const coarsePointer = explicitMode === 'embedded-portrait'
    ? true
    : !!win?.matchMedia?.('(pointer: coarse)')?.matches

  const requestedPortrait = isPortraitLayout(win)
  // Handheld devices should keep the gameplay canvas in landscape even
  // before the player rotates the phone, unless portrait was explicitly requested.
  const portrait = explicitMode === 'portrait'
    ? true
    : coarsePointer
      ? false
      : requestedPortrait
  const semanticLandscapeScale = coarsePointer && viewportPortrait && Math.max(viewportWidth, viewportHeight) > 0
    ? Math.min(viewportWidth, viewportHeight) / Math.max(viewportWidth, viewportHeight)
    : 1

  if (body?.classList) {
    body.classList.remove(
      'layout-portrait',
      'layout-landscape',
      'layout-mode-portrait',
      'layout-mode-landscape',
      'layout-mode-embedded-portrait',
      'pointer-coarse',
      'viewport-portrait',
      'viewport-landscape',
    )
    body.classList.add(portrait ? 'layout-portrait' : 'layout-landscape')
    body.classList.toggle('pointer-coarse', coarsePointer)
    body.classList.add(viewportPortrait ? 'viewport-portrait' : 'viewport-landscape')

    if (explicitMode) {
      body.classList.add(`layout-mode-${explicitMode}`)
    }
  }

  if (body?.style?.setProperty) {
    body.style.setProperty('--viewport-semantic-landscape-scale', String(semanticLandscapeScale))
  }

  return { portrait, explicitMode, coarsePointer }
}
