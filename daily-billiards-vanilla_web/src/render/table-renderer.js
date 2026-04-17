import {
  BALL_RADIUS,
  HEAD_STRING_X,
  MAX_PULL_DISTANCE,
  POCKET_RADIUS,
  RAIL_THICKNESS,
  RELEASE_FLASH_DURATION,
  TABLE_HEIGHT,
  TABLE_WIDTH,
} from '../constants.js'
import { isPortraitLayout, shouldRotateGameplayStage } from '../layout/mode.js'
import { Vec2 } from '../math.js'
import { GameClient } from '../network/game-client.js'

const tableSurfaceImage = typeof Image !== 'undefined' ? new Image() : null
if (tableSurfaceImage) {
  tableSurfaceImage.src = './assets/table-surface.png'
}

export function resolveTableSurfaceSourceRect(
  imageWidth,
  imageHeight,
  targetWidth = TABLE_WIDTH + RAIL_THICKNESS * 2,
  targetHeight = TABLE_HEIGHT + RAIL_THICKNESS * 2,
) {
  const imageRatio = imageWidth / imageHeight
  const targetRatio = targetWidth / targetHeight

  if (!Number.isFinite(imageRatio) || !Number.isFinite(targetRatio) || imageWidth <= 0 || imageHeight <= 0) {
    return { x: 0, y: 0, width: imageWidth, height: imageHeight }
  }

  if (Math.abs(imageRatio - targetRatio) < 0.0001) {
    return { x: 0, y: 0, width: imageWidth, height: imageHeight }
  }

  if (imageRatio > targetRatio) {
    const width = imageHeight * targetRatio
    return {
      x: (imageWidth - width) / 2,
      y: 0,
      width,
      height: imageHeight,
    }
  }

  const height = imageWidth / targetRatio
  return {
    x: 0,
    y: (imageHeight - height) / 2,
    width: imageWidth,
    height,
  }
}

export function shouldRenderAimGuides(game, isMyTurn = GameClient.isMyTurn) {
  return !game.showRemoteCue && isMyTurn
}

export function getRenderedCuePullDistance(game) {
  // 核心逻辑：只有轮到我时，才在本地显示拉杆距离（力度）。
  // 对手拉杆时，我的屏幕上球杆只旋转角度，不往后缩，从而隐藏力度。
  const isMyTurn = (game.currentPlayer === GameClient.playerIndex);
  if (isMyTurn) {
    return (game.isDragging || game.showRemoteCue) ? game.pullDistance : 0
  } else {
    // 如果是对手在拉杆，只显示球杆紧贴白球旋转，不显示拉伸
    return 0
  }
}

export function getRenderedCuePowerRatio(game) {
  return getRenderedCuePullDistance(game) / MAX_PULL_DISTANCE
}

export function drawGame(game) {
  const { canvas, ctx } = game
  const isPortrait = shouldRotateGameplayStage(document, window)
  const rollAreaX = -TABLE_WIDTH / 2 + BALL_RADIUS
  const rollAreaY = -TABLE_HEIGHT / 2 + BALL_RADIUS
  const rollAreaWidth = TABLE_WIDTH - BALL_RADIUS * 2
  const rollAreaHeight = TABLE_HEIGHT - BALL_RADIUS * 2

  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.save()
  ctx.translate(canvas.width / 2, canvas.height / 2)
  ctx.scale(game.renderScale, game.renderScale)
  if (isPortrait) {
    ctx.rotate(Math.PI / 2)
  }

  if (tableSurfaceImage && tableSurfaceImage.complete && tableSurfaceImage.naturalWidth > 0) {
    const sourceRect = resolveTableSurfaceSourceRect(
      tableSurfaceImage.naturalWidth,
      tableSurfaceImage.naturalHeight,
      TABLE_WIDTH + RAIL_THICKNESS * 2,
      TABLE_HEIGHT + RAIL_THICKNESS * 2,
    )
    ctx.shadowColor = 'rgba(0, 0, 0, 0.24)'
    ctx.shadowBlur = 12
    ctx.shadowOffsetX = 0
    ctx.shadowOffsetY = 12
    ctx.drawImage(
      tableSurfaceImage,
      sourceRect.x,
      sourceRect.y,
      sourceRect.width,
      sourceRect.height,
      -TABLE_WIDTH / 2 - RAIL_THICKNESS,
      -TABLE_HEIGHT / 2 - RAIL_THICKNESS,
      TABLE_WIDTH + RAIL_THICKNESS * 2,
      TABLE_HEIGHT + RAIL_THICKNESS * 2
    )
    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0
    ctx.shadowOffsetX = 0
    ctx.shadowOffsetY = 0
  } else {

  // Table shadow
  ctx.shadowColor = 'rgba(0, 0, 0, 0.8)'
  ctx.shadowBlur = 40
  ctx.shadowOffsetX = 10
  ctx.shadowOffsetY = 15
  const woodOuterGrad = ctx.createLinearGradient(-TABLE_WIDTH / 2, -TABLE_HEIGHT / 2, TABLE_WIDTH / 2, TABLE_HEIGHT / 2)
  woodOuterGrad.addColorStop(0, '#4a2812')
  woodOuterGrad.addColorStop(0.45, '#6b4220')
  woodOuterGrad.addColorStop(1, '#2b1408')
  ctx.fillStyle = woodOuterGrad
  ctx.fillRect(-TABLE_WIDTH / 2 - RAIL_THICKNESS, -TABLE_HEIGHT / 2 - RAIL_THICKNESS, TABLE_WIDTH + RAIL_THICKNESS * 2, TABLE_HEIGHT + RAIL_THICKNESS * 2)
  
  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 0

  ctx.fillStyle = 'rgba(240, 194, 138, 0.12)'
  ctx.fillRect(-TABLE_WIDTH / 2 - RAIL_THICKNESS + 8, -TABLE_HEIGHT / 2 - RAIL_THICKNESS + 8, TABLE_WIDTH + RAIL_THICKNESS * 2 - 16, 12)
  ctx.fillStyle = 'rgba(18, 8, 2, 0.22)'
  ctx.fillRect(-TABLE_WIDTH / 2 - RAIL_THICKNESS + 10, TABLE_HEIGHT / 2 + RAIL_THICKNESS - 18, TABLE_WIDTH + RAIL_THICKNESS * 2 - 20, 10)

  // Cloth (green) with radial gradient
  const clothGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, TABLE_WIDTH)
  clothGrad.addColorStop(0, '#2c8b5a')
  clothGrad.addColorStop(0.45, '#1a7547')
  clothGrad.addColorStop(1, '#0b4126')
  ctx.fillStyle = clothGrad
  ctx.fillRect(-TABLE_WIDTH / 2, -TABLE_HEIGHT / 2, TABLE_WIDTH, TABLE_HEIGHT)
  const clothSheen = ctx.createLinearGradient(-TABLE_WIDTH / 2, -TABLE_HEIGHT / 2, TABLE_WIDTH / 2, TABLE_HEIGHT / 2)
  clothSheen.addColorStop(0, 'rgba(255,255,255,0.08)')
  clothSheen.addColorStop(0.32, 'rgba(255,255,255,0.02)')
  clothSheen.addColorStop(0.65, 'rgba(0,0,0,0.06)')
  clothSheen.addColorStop(1, 'rgba(0,0,0,0.14)')
  ctx.fillStyle = clothSheen
  ctx.fillRect(-TABLE_WIDTH / 2, -TABLE_HEIGHT / 2, TABLE_WIDTH, TABLE_HEIGHT)
  ctx.save()
  ctx.globalAlpha = 0.08
  ctx.strokeStyle = '#dcefdc'
  ctx.lineWidth = 1
  for (let y = -TABLE_HEIGHT; y <= TABLE_HEIGHT; y += 18) {
    ctx.beginPath()
    ctx.moveTo(-TABLE_WIDTH / 2, y)
    ctx.lineTo(TABLE_WIDTH / 2, y + 90)
    ctx.stroke()
  }
  ctx.restore()

  // Cushions (inner border of the cloth)
  const cushionThickness = 12
  const railShadowGrad = ctx.createLinearGradient(-TABLE_WIDTH / 2, -TABLE_HEIGHT / 2, TABLE_WIDTH / 2, TABLE_HEIGHT / 2)
  railShadowGrad.addColorStop(0, '#103621')
  railShadowGrad.addColorStop(0.5, '#0e4d2f')
  railShadowGrad.addColorStop(1, '#0a321f')
  ctx.fillStyle = railShadowGrad
  // Top cushion
  ctx.fillRect(-TABLE_WIDTH / 2, -TABLE_HEIGHT / 2, TABLE_WIDTH, cushionThickness)
  // Bottom cushion
  ctx.fillRect(-TABLE_WIDTH / 2, TABLE_HEIGHT / 2 - cushionThickness, TABLE_WIDTH, cushionThickness)
  // Left cushion
  ctx.fillRect(-TABLE_WIDTH / 2, -TABLE_HEIGHT / 2, cushionThickness, TABLE_HEIGHT)
  // Right cushion
  ctx.fillRect(TABLE_WIDTH / 2 - cushionThickness, -TABLE_HEIGHT / 2, cushionThickness, TABLE_HEIGHT)
  ctx.fillStyle = 'rgba(84, 176, 113, 0.32)'
  ctx.fillRect(-TABLE_WIDTH / 2, -TABLE_HEIGHT / 2, TABLE_WIDTH, 2.5)
  ctx.fillRect(-TABLE_WIDTH / 2, TABLE_HEIGHT / 2 - cushionThickness, TABLE_WIDTH, 2)
  ctx.fillRect(-TABLE_WIDTH / 2, -TABLE_HEIGHT / 2, 2.5, TABLE_HEIGHT)
  ctx.fillRect(TABLE_WIDTH / 2 - cushionThickness, -TABLE_HEIGHT / 2, 2, TABLE_HEIGHT)

  // Diamonds (Sights)
  ctx.fillStyle = 'rgba(248, 228, 193, 0.72)'
  const diamondDistX = TABLE_WIDTH / 4
  const diamondDistY = TABLE_HEIGHT / 2
  for (let i = 1; i <= 3; i++) {
    // Top & Bottom rails
    ctx.beginPath(); ctx.arc(-TABLE_WIDTH / 2 + i * diamondDistX, -TABLE_HEIGHT / 2 - RAIL_THICKNESS / 2, 3, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.arc(-TABLE_WIDTH / 2 + i * diamondDistX, TABLE_HEIGHT / 2 + RAIL_THICKNESS / 2, 3, 0, Math.PI * 2); ctx.fill()
  }
  for (let i = 1; i <= 1; i++) {
    // Left & Right rails
    ctx.beginPath(); ctx.arc(-TABLE_WIDTH / 2 - RAIL_THICKNESS / 2, -TABLE_HEIGHT / 2 + i * diamondDistY, 3, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.arc(TABLE_WIDTH / 2 + RAIL_THICKNESS / 2, -TABLE_HEIGHT / 2 + i * diamondDistY, 3, 0, Math.PI * 2); ctx.fill()
  }

  if (game.ballInHand && game.ballInHandZone === 'kitchen') {
    ctx.fillStyle = 'rgba(255, 248, 196, 0.08)'
    ctx.fillRect(-TABLE_WIDTH / 2, -TABLE_HEIGHT / 2, HEAD_STRING_X + TABLE_WIDTH / 2, TABLE_HEIGHT)
    ctx.strokeStyle = 'rgba(255, 248, 196, 0.55)'
    ctx.lineWidth = 2
    ctx.setLineDash([10, 8])
    ctx.beginPath()
    ctx.moveTo(HEAD_STRING_X, -TABLE_HEIGHT / 2)
    ctx.lineTo(HEAD_STRING_X, TABLE_HEIGHT / 2)
    ctx.stroke()
    ctx.setLineDash([])
  }

  ctx.fillStyle = '#0a0a0a'
  game.pockets.forEach(pocket => {
    // Add pocket depth with radial gradient
    const pocketGrad = ctx.createRadialGradient(pocket.x, pocket.y, POCKET_RADIUS * 0.4, pocket.x, pocket.y, POCKET_RADIUS)
    pocketGrad.addColorStop(0, '#000000')
    pocketGrad.addColorStop(1, '#111111')
    ctx.fillStyle = pocketGrad
    
    ctx.beginPath()
    ctx.arc(pocket.x, pocket.y, POCKET_RADIUS, 0, Math.PI * 2)
    ctx.fill()
    
    // Inner shadow effect for pocket
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(pocket.x, pocket.y, POCKET_RADIUS - 1.5, 0, Math.PI * 2)
    ctx.stroke()

    const pocketLipGrad = ctx.createRadialGradient(pocket.x, pocket.y, POCKET_RADIUS * 0.7, pocket.x, pocket.y, POCKET_RADIUS + 4)
    pocketLipGrad.addColorStop(0, 'rgba(90, 51, 21, 0)')
    pocketLipGrad.addColorStop(0.72, 'rgba(90, 51, 21, 0.55)')
    pocketLipGrad.addColorStop(1, 'rgba(231, 193, 135, 0.22)')
    ctx.strokeStyle = pocketLipGrad
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.arc(pocket.x, pocket.y, POCKET_RADIUS + 2, 0, Math.PI * 2)
    ctx.stroke()
  })
  }

  ctx.fillStyle = 'rgba(255, 59, 48, 0.16)'
  ctx.fillRect(rollAreaX, rollAreaY, rollAreaWidth, rollAreaHeight)
  ctx.strokeStyle = 'rgba(255, 59, 48, 0.85)'
  ctx.lineWidth = 2
  ctx.strokeRect(rollAreaX, rollAreaY, rollAreaWidth, rollAreaHeight)

  // Draw ball shadows first to prevent overlapping issues
  game.balls.forEach(ball => {
    if (ball.pocketed) return;
    ctx.save()
    ctx.translate(ball.pos.x, ball.pos.y)
    ctx.beginPath()
    ctx.arc(2, 4, BALL_RADIUS, 0, Math.PI * 2) // Offset shadow slightly down-right
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)'
    ctx.filter = 'blur(4px)'
    ctx.fill()
    ctx.restore()
  })

  game.scorePocketEffects.forEach((effect) => {
    const progress = Math.min(1, effect.age / effect.duration)
    const fade = 1 - progress
    const ringRadius = POCKET_RADIUS * (0.38 + progress * 0.92)
    ctx.fillStyle = `rgba(255, 236, 150, ${fade * 0.42})`
    ctx.beginPath()
    ctx.arc(effect.pos.x, effect.pos.y, ringRadius, 0, Math.PI * 2)
    ctx.fill()

    ctx.strokeStyle = `rgba(255, 210, 72, ${fade * 0.95})`
    ctx.lineWidth = 3.8 - progress * 2
    ctx.beginPath()
    ctx.arc(effect.pos.x, effect.pos.y, ringRadius, 0, Math.PI * 2)
    ctx.stroke()

    ctx.fillStyle = `rgba(255, 249, 210, ${fade})`
    ctx.beginPath()
    ctx.arc(effect.pos.x, effect.pos.y, 4.5 + progress * 1.8, 0, Math.PI * 2)
    ctx.fill()

    effect.sparks.forEach((spark, index) => {
      const travel = spark.speed * progress
      const px = effect.pos.x + Math.cos(spark.angle) * travel
      const py = effect.pos.y + Math.sin(spark.angle) * travel
      const color = index % 3 === 0 ? '255,245,188' : index % 3 === 1 ? '255,207,84' : '255,154,72'
      ctx.fillStyle = `rgba(${color}, ${fade * 0.96})`
      ctx.beginPath()
      ctx.arc(px, py, Math.max(0.4, spark.radius * (1 - progress * 0.72)), 0, Math.PI * 2)
      ctx.fill()
    })
  })

  // Draw Collision Effects
  game.collisionEffects.forEach(effect => {
    const ratio = effect.age / 15
    const opacity = 1 - ratio
    ctx.save()
    ctx.translate(effect.pos.x, effect.pos.y)
    if (effect.type === 'rail') {
      ctx.strokeStyle = `rgba(255, 255, 255, ${opacity * 0.5})`
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(0, 0, 5 + ratio * 20, 0, Math.PI * 2)
      ctx.stroke()
    } else {
      ctx.fillStyle = `rgba(255, 255, 255, ${opacity * 0.4})`
      ctx.beginPath()
      ctx.arc(0, 0, 2 + ratio * 15, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
    })

    game.balls.forEach(ball => ball.draw(ctx))
  if (game.releaseFlash > 0 && !game.cueBall.pocketed) {
    const flashRatio = game.releaseFlash / RELEASE_FLASH_DURATION
    ctx.strokeStyle = `rgba(255, 236, 179, ${flashRatio * 0.8})`
    ctx.lineWidth = 4 * flashRatio
    ctx.beginPath()
    ctx.arc(game.cueBall.pos.x, game.cueBall.pos.y, BALL_RADIUS + 10 + (1 - flashRatio) * 18, 0, Math.PI * 2)
    ctx.stroke()
  }

  if (game.ballInHand && !game.isGameOver) {
    const isMyTurn = (game.currentPlayer === game.playerIndex);
    ctx.strokeStyle = game.cuePlacementValid ? (isMyTurn ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.4)') : 'rgba(239,68,68,0.9)'
    ctx.lineWidth = 3
    ctx.setLineDash([10, 6])
    ctx.beginPath()
    ctx.arc(game.cueBall.pos.x, game.cueBall.pos.y, BALL_RADIUS + 8, 0, Math.PI * 2)
    ctx.stroke()
    ctx.setLineDash([])
  }

  if (!game.ballInHand && !game.isMoving() && !game.cueBall.pocketed && !game.isGameOver) {
    drawAimAndCue(game, ctx)
  }

  ctx.restore()
}
function drawAimAndCue(game, ctx) {
  const isMyTurn = shouldRenderAimGuides(game)

  // 只有轮到我时，才根据我的鼠标位置更新本地瞄准角度
  if (isMyTurn && game.hasPointerInput && !game.isDragging) {
    const hoverAim = game.cueBall.pos.clone().sub(game.mousePos)
    if (hoverAim.length() > 4) game.aimAngle = Math.atan2(hoverAim.y, hoverAim.x)
  }

  const ang = game.aimAngle
  const direction = new Vec2(Math.cos(ang), Math.sin(ang))
  const powerRatio = getRenderedCuePowerRatio(game)
  if (shouldRenderAimGuides(game)) {
    const guide = game.getAimGuide(direction)
    const guideAlpha = 0.28 + powerRatio * 0.45
    const guideWidth = 1.5 + powerRatio * 2.5

    ctx.strokeStyle = `rgba(255,255,255,${guideAlpha})`
    ctx.lineWidth = guideWidth
    ctx.setLineDash([8, 6])
    ctx.beginPath()
    ctx.moveTo(game.cueBall.pos.x, game.cueBall.pos.y)
    ctx.lineTo(guide.hitPoint.x, guide.hitPoint.y)
    ctx.stroke()
    ctx.setLineDash([])

    ctx.fillStyle = 'rgba(255,255,255,0.28)'
    ctx.beginPath()
    ctx.arc(guide.hitPoint.x, guide.hitPoint.y, 4 + powerRatio * 3, 0, Math.PI * 2)
    ctx.fill()

    if (guide.type === 'ball') {
      drawBallGuide(game, ctx, guide, direction)
      
      ctx.save()
      ctx.globalAlpha = 0.3
      ctx.beginPath()
      ctx.arc(guide.hitPoint.x, guide.hitPoint.y, BALL_RADIUS, 0, Math.PI * 2)
      ctx.fillStyle = 'white'
      ctx.fill()
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.restore()
    }
  }

  drawCueStick(game, ctx, ang, powerRatio)
  
  // Draw Power Bar
  if (isMyTurn && (game.isDragging || game.showRemoteCue)) {
      drawPowerBar(game, ctx, powerRatio)
  }
}

function drawPowerBar(game, ctx, powerRatio) {
    const barWidth = 12
    const barHeight = 120
    const x = TABLE_WIDTH / 2 + RAIL_THICKNESS + 25
    const y = -barHeight / 2
    
    ctx.save()
    // Bar Background
    ctx.fillStyle = 'rgba(0,0,0,0.5)'
    ctx.fillRect(x, y, barWidth, barHeight)
    
    // Gradient fill based on power
    const grad = ctx.createLinearGradient(x, y + barHeight, x, y)
    grad.addColorStop(0, '#16a34a') // Green
    grad.addColorStop(0.5, '#fbbf24') // Yellow
    grad.addColorStop(1, '#dc2626') // Red
    
    ctx.fillStyle = grad
    const currentBarHeight = barHeight * powerRatio
    ctx.fillRect(x, y + barHeight - currentBarHeight, barWidth, currentBarHeight)
    
    // Border
    ctx.strokeStyle = 'white'
    ctx.lineWidth = 1
    ctx.strokeRect(x, y, barWidth, barHeight)
    
    // Label
    ctx.fillStyle = 'white'
    ctx.font = 'bold 10px sans-serif'
    ctx.textAlign = 'center'
    ctx.rotate(Math.PI / 2)
    ctx.fillText('POWER', 0, -x - 15)
    ctx.restore()
}

function drawBallGuide(game, ctx, guide, direction) {
  const targetBall = guide.ball
  const targetDirection = guide.normal.clone().normalize()
  const targetTravel = game.getProjectedTravel(targetBall.pos, targetDirection, 240)
  const targetEnd = targetBall.pos.clone().add(targetDirection.clone().mul(targetTravel))
  const incoming = direction.clone().normalize()
  const cueDot = incoming.dot(guide.normal)
  const cueDeflect = incoming.clone().sub(guide.normal.clone().mul(cueDot))
  const cueDeflectLength = cueDeflect.length()

  ctx.strokeStyle = 'rgba(255, 223, 128, 0.72)'
  ctx.lineWidth = 2.5
  ctx.setLineDash([10, 5])
  ctx.beginPath()
  ctx.moveTo(targetBall.pos.x, targetBall.pos.y)
  ctx.lineTo(targetEnd.x, targetEnd.y)
  ctx.stroke()
  ctx.setLineDash([])

  if (cueDeflectLength > 0.05) {
    const cueDirection = cueDeflect.clone().normalize()
    const cueTravel = game.getProjectedTravel(guide.cueImpact, cueDirection, 140)
    const cueEnd = guide.cueImpact.clone().add(cueDirection.clone().mul(cueTravel))
    ctx.strokeStyle = 'rgba(196, 230, 255, 0.65)'
    ctx.lineWidth = 2
    ctx.setLineDash([6, 6])
    ctx.beginPath()
    ctx.moveTo(guide.cueImpact.x, guide.cueImpact.y)
    ctx.lineTo(cueEnd.x, cueEnd.y)
    ctx.stroke()
    ctx.setLineDash([])
  }

  ctx.fillStyle = 'rgba(255, 223, 128, 0.34)'
  ctx.beginPath()
  ctx.arc(guide.contactPoint.x, guide.contactPoint.y, 3.5, 0, Math.PI * 2)
  ctx.fill()

  ctx.strokeStyle = 'rgba(255,255,255,0.85)'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.arc(targetBall.pos.x, targetBall.pos.y, BALL_RADIUS + 5, 0, Math.PI * 2)
  ctx.stroke()

  ctx.fillStyle = 'rgba(255, 223, 128, 0.18)'
  ctx.beginPath()
  ctx.arc(targetBall.pos.x, targetBall.pos.y, BALL_RADIUS + 8, 0, Math.PI * 2)
  ctx.fill()
}

function drawCueStick(game, ctx, angle, powerRatio) {
  ctx.save()
  ctx.translate(game.cueBall.pos.x, game.cueBall.pos.y)
  ctx.rotate(angle + Math.PI)
  const pull = getRenderedCuePullDistance(game)
  const cueBase = BALL_RADIUS + 2 + pull
  const tipLength = 6
  const ferruleLength = 8
  const shaftLength = 224
  const wrapLength = 68
  const buttLength = 74
  const totalLength = tipLength + ferruleLength + shaftLength + wrapLength + buttLength

  const shaftGradient = ctx.createLinearGradient(cueBase, 0, cueBase + tipLength + ferruleLength + shaftLength, 0)
  shaftGradient.addColorStop(0, '#d8eef7')
  shaftGradient.addColorStop(0.08, '#f8f1dc')
  shaftGradient.addColorStop(0.55, '#e8c98d')
  shaftGradient.addColorStop(1, '#be8b4c')

  const buttGradient = ctx.createLinearGradient(cueBase + tipLength + ferruleLength + shaftLength, 0, cueBase + totalLength, 0)
  buttGradient.addColorStop(0, '#7c4f25')
  buttGradient.addColorStop(0.55, '#4b2f18')
  buttGradient.addColorStop(1, '#24150d')

  ctx.fillStyle = '#1d90bf'
  ctx.fillRect(cueBase, -1.1, tipLength, 2.2)

  ctx.fillStyle = '#f1e7cf'
  ctx.fillRect(cueBase + tipLength, -1.8, ferruleLength, 3.6)

  ctx.beginPath()
  ctx.moveTo(cueBase + tipLength + ferruleLength, -2.4)
  ctx.lineTo(cueBase + tipLength + ferruleLength + shaftLength, -5.4)
  ctx.lineTo(cueBase + tipLength + ferruleLength + shaftLength, 5.4)
  ctx.lineTo(cueBase + tipLength + ferruleLength, 2.4)
  ctx.closePath()
  ctx.fillStyle = shaftGradient
  ctx.fill()

  ctx.beginPath()
  ctx.moveTo(cueBase + tipLength + ferruleLength + shaftLength, -5.4)
  ctx.lineTo(cueBase + tipLength + ferruleLength + shaftLength + wrapLength, -7)
  ctx.lineTo(cueBase + tipLength + ferruleLength + shaftLength + wrapLength + buttLength, -8.2)
  ctx.lineTo(cueBase + tipLength + ferruleLength + shaftLength + wrapLength + buttLength, 8.2)
  ctx.lineTo(cueBase + tipLength + ferruleLength + shaftLength + wrapLength, 7)
  ctx.lineTo(cueBase + tipLength + ferruleLength + shaftLength, 5.4)
  ctx.closePath()
  ctx.fillStyle = buttGradient
  ctx.fill()

  ctx.fillStyle = '#101010'
  ctx.fillRect(cueBase + tipLength + ferruleLength + shaftLength - 1, -6.4, wrapLength + 2, 12.8)

  ctx.fillStyle = 'rgba(255, 255, 255, 0.22)'
  ctx.beginPath()
  ctx.moveTo(cueBase + tipLength + ferruleLength + 14, -1.3)
  ctx.lineTo(cueBase + tipLength + ferruleLength + shaftLength + 6, -3.2)
  ctx.lineTo(cueBase + tipLength + ferruleLength + shaftLength + wrapLength + buttLength - 18, -2.2)
  ctx.lineWidth = 1.1
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'
  ctx.stroke()

  ctx.fillStyle = `rgba(255, 236, 179, ${0.32 + powerRatio * 0.5})`
  ctx.beginPath()
  ctx.ellipse(cueBase + 7, 0, 8, 4.2, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}
