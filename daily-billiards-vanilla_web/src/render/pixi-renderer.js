import { AssetsBase64 } from './assets.js';
import {
  BALL_RADIUS, HEAD_STRING_X, MAX_PULL_DISTANCE, PLAYABLE_AREA_INSET, POCKET_RADIUS,
  RAIL_THICKNESS, RELEASE_FLASH_DURATION, TABLE_HEIGHT, TABLE_WIDTH
} from '../constants.js';
import { hasDebugOverlay, isPortraitLayout } from '../layout/mode.js';
import { Vec2 } from '../math.js';
import { GameClient } from '../network/game-client.js';
import { shouldRenderAimGuides, getRenderedCuePullDistance, getRenderedCuePowerRatio, getPocketVisualCenters, resolveTableSurfaceSourceRect } from './table-renderer.js';

const ballFragShader = `
precision mediump float;
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform vec3 uColor;
uniform float uIsStripe;
uniform mat3 uRotation;
uniform vec3 uLightDir;

void main(void) {
    vec2 uv = vTextureCoord * 2.0 - 1.0;
    float r2 = dot(uv, uv);
    if (r2 > 1.0) discard;
    
    float z = sqrt(1.0 - r2);
    vec3 normal = vec3(uv.x, uv.y, z);
    
    vec3 localPos = normal * uRotation;
    vec3 finalColor = vec3(0.98, 0.98, 0.96); // 更加纯净的树脂白
    
    if (uIsStripe > 0.5) {
        // 修改为绕 Y 轴方向的色带 (localPos.y)，这样色带会环绕球体中间
        if (abs(localPos.y) < 0.45) { 
            finalColor = uColor;
        }
    } else {
        finalColor = uColor;
    }
    
    float isLabel = 0.0;
    vec2 labelUV = vec2(0.0);
    
    // 模拟照片中巨大的白色数字托盘 (扩大到 0.7)
    if (localPos.x > 0.4) {
        labelUV = vec2(-localPos.z, localPos.y) / 0.7 * 0.5 + 0.5; // U映射到-Z(世界X), V映射到Y(世界Y)
        if (length(labelUV - 0.5) <= 0.48) isLabel = 1.0;
    } else if (localPos.x < -0.4) {
        labelUV = vec2(localPos.z, localPos.y) / 0.7 * 0.5 + 0.5; // U映射到Z(世界X), V映射到Y(世界Y)
        if (length(labelUV - 0.5) <= 0.48) isLabel = 1.0;
    }
    
    if (isLabel > 0.0) {
        finalColor = vec3(1.0, 1.0, 1.0);
        vec4 texColor = texture2D(uSampler, labelUV);
        finalColor = mix(finalColor, texColor.rgb, texColor.a);
    }
    
    float diffuse = max(dot(normal, uLightDir), 0.0);
    float ambient = 0.4; 
    
    vec3 viewDir = vec3(0.0, 0.0, 1.0);
    vec3 halfDir = normalize(uLightDir + viewDir);
    
    // 增强聚光效果
    float specAngle = max(dot(halfDir, normal), 0.0);
    float specular = pow(specAngle, 150.0) * 1.2; 
    
    float rim = pow(1.0 - z, 3.0) * 0.4;
    
    vec3 litColor = finalColor * (ambient + diffuse * 0.8) + vec3(specular) - vec3(rim);
    gl_FragColor = vec4(litColor, 1.0);
}
`;

const ballVertShader = `
precision mediump float;
attribute vec2 aVertexPosition;
attribute vec2 aTextureCoord;
uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
varying vec2 vTextureCoord;
void main() {
    vTextureCoord = aTextureCoord;
    gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
}
`;

let ballGeometry = null;


export class PixiRenderer {
    constructor(game) {
        this.game = game;
        this.visualRailThickness = RAIL_THICKNESS;
        this.app = new PIXI.Application({
            width: window.innerWidth,
            height: window.innerHeight,
            backgroundColor: 0x000000,
            backgroundAlpha: 0,
            resolution: window.devicePixelRatio || 1,
            autoDensity: true,
            antialias: true
        });

        const container = document.getElementById('game-container');
        const oldCanvas = document.getElementById('game-canvas');
        if (oldCanvas) {
            container.removeChild(oldCanvas);
        }
        this.app.view.id = 'game-canvas';
        container.insertBefore(this.app.view, container.firstChild);
        
        this.app.ticker.stop();

        this.mainContainer = new PIXI.Container();
        this.app.stage.addChild(this.mainContainer);

        // Layers
        this.staticLayer = new PIXI.Container();
        this.mainContainer.addChild(this.staticLayer);
        
        this.shadowLayer = new PIXI.Container();
        this.mainContainer.addChild(this.shadowLayer);

        this.ballLayer = new PIXI.Container();
        this.mainContainer.addChild(this.ballLayer);

        this.effectLayer = new PIXI.Container();
        this.mainContainer.addChild(this.effectLayer);

        this.uiLayer = new PIXI.Container();
        this.mainContainer.addChild(this.uiLayer);

        // Textures
        this.textures = this.generateTextures();
        
        this.ballSprites = new Map();
        this.shadowSprites = new Map();
        this.scoreEffects = [];
        this.collisionEffects = [];
        
        this.drawStaticTable();
    }

    generateTextures() {
        const textures = {};
        for (let i = 0; i <= 15; i++) {
            textures[`label_${i}`] = PIXI.Texture.from(AssetsBase64[`label_${i}`]);
        }
        textures.ballShadow = PIXI.Texture.from(AssetsBase64.shadow);
        textures.tableSurface = PIXI.Texture.from('./assets/table-surface.png');
        if (!textures.tableSurface.baseTexture.valid) {
            textures.tableSurface.baseTexture.once('loaded', () => this.drawStaticTable());
        }

        const clothCanvas = document.createElement('canvas');
        clothCanvas.width = 512; clothCanvas.height = 512;
        const clothCtx = clothCanvas.getContext('2d');
        const clothGrad = clothCtx.createRadialGradient(256, 256, 0, 256, 256, 256);
        clothGrad.addColorStop(0, '#2c8b5a');
        clothGrad.addColorStop(0.45, '#1a7547');
        clothGrad.addColorStop(1, '#0b4126');
        clothCtx.fillStyle = clothGrad;
        clothCtx.fillRect(0, 0, 512, 512);
        const clothSheen = clothCtx.createLinearGradient(0, 0, 512, 512);
        clothSheen.addColorStop(0, 'rgba(255,255,255,0.08)');
        clothSheen.addColorStop(0.3, 'rgba(255,255,255,0.02)');
        clothSheen.addColorStop(0.62, 'rgba(0,0,0,0.05)');
        clothSheen.addColorStop(1, 'rgba(0,0,0,0.14)');
        clothCtx.fillStyle = clothSheen;
        clothCtx.fillRect(0, 0, 512, 512);
        clothCtx.globalAlpha = 0.08;
        clothCtx.strokeStyle = '#dcefdc';
        clothCtx.lineWidth = 1;
        for (let y = -512; y <= 512; y += 18) {
            clothCtx.beginPath();
            clothCtx.moveTo(0, y);
            clothCtx.lineTo(512, y + 90);
            clothCtx.stroke();
        }
        clothCtx.globalAlpha = 1;
        textures.cloth = PIXI.Texture.from(clothCanvas);

        const pocketCanvas = document.createElement('canvas');
        pocketCanvas.width = 128; pocketCanvas.height = 128;
        const pocketCtx = pocketCanvas.getContext('2d');
        const pocketGrad = pocketCtx.createRadialGradient(64, 64, POCKET_RADIUS * 0.4 * (64/POCKET_RADIUS), 64, 64, 64);
        pocketGrad.addColorStop(0, '#000000');
        pocketGrad.addColorStop(1, '#111111');
        pocketCtx.fillStyle = pocketGrad;
        pocketCtx.beginPath();
        pocketCtx.arc(64, 64, 64, 0, Math.PI * 2);
        pocketCtx.fill();
        textures.pocket = PIXI.Texture.from(pocketCanvas);

        return textures;
    }

    resize(availableWidth, availableHeight, dpr, fittedScale, isPortrait, railVisualPx) {
        this.app.renderer.resize(availableWidth, availableHeight);
        
        this.mainContainer.x = availableWidth / 2;
        this.mainContainer.y = availableHeight / 2;
        this.mainContainer.scale.set(fittedScale);
        this.visualRailThickness = fittedScale > 0 ? railVisualPx / fittedScale : RAIL_THICKNESS;
        this.drawStaticTable();
        
        if (isPortrait) {
            this.mainContainer.rotation = Math.PI / 2;
        } else {
            this.mainContainer.rotation = 0;
        }
    }

    resetUiOverlayLayers() {
        if (this.dynamicGraphics) {
            this.dynamicGraphics.destroy();
            this.dynamicGraphics = null;
        }
        if (this.cueStickContainer) {
            this.cueStickContainer.destroy({ children: true });
            this.cueStickContainer = null;
            this.cueStick = null;
        }
        if (this.powerLabel) {
            this.powerLabel.destroy();
            this.powerLabel = null;
        }
    }

    createUiOverlayLayers() {
        this.dynamicGraphics = new PIXI.Graphics();
        this.uiLayer.addChild(this.dynamicGraphics);

        this.cueStickContainer = new PIXI.Container();
        this.uiLayer.addChild(this.cueStickContainer);
        this.drawCueStickGraphics();
    }

    drawPocketDebugRings() {
        const pocketVisuals = getPocketVisualCenters();

        const pocketRing = new PIXI.Graphics();
        pocketVisuals.forEach((pocket) => {
            pocketRing.beginFill(0xef4444, 0.45);
            pocketRing.drawCircle(pocket.x, pocket.y, POCKET_RADIUS);
            pocketRing.endFill();
            pocketRing.lineStyle(2, 0xb91c1c, 0.95);
            pocketRing.drawCircle(pocket.x, pocket.y, POCKET_RADIUS);
        });
        this.staticLayer.addChild(pocketRing);
    }

    drawStaticTable() {
        this.staticLayer.removeChildren();
        this.resetUiOverlayLayers();
        const railThickness = this.visualRailThickness;
        const borderW = TABLE_WIDTH + this.visualRailThickness * 2;
        const borderH = TABLE_HEIGHT + this.visualRailThickness * 2;
        const rollAreaX = -TABLE_WIDTH / 2 + PLAYABLE_AREA_INSET;
        const rollAreaY = -TABLE_HEIGHT / 2 + PLAYABLE_AREA_INSET;
        const rollAreaWidth = TABLE_WIDTH - PLAYABLE_AREA_INSET * 2;
        const rollAreaHeight = TABLE_HEIGHT - PLAYABLE_AREA_INSET * 2;
        const showDebugOverlay = hasDebugOverlay(window);

        if (this.textures.tableSurface?.baseTexture?.valid) {
            const tableShadow = new PIXI.Graphics();
            tableShadow.beginFill(0x000000, 0.24);
            tableShadow.drawRoundedRect(-borderW / 2 - 10, -borderH / 2 - 4, borderW + 20, borderH + 18, 28);
            tableShadow.endFill();
            tableShadow.y = 12;
            tableShadow.filters = [new PIXI.BlurFilter(10)];
            this.staticLayer.addChild(tableShadow);

            const tableSurface = new PIXI.Sprite(this.textures.tableSurface);
            tableSurface.anchor.set(0.5);
            tableSurface.width = borderW;
            tableSurface.height = borderH;
            this.staticLayer.addChild(tableSurface);

            if (showDebugOverlay) {
                const rollArea = new PIXI.Graphics();
                rollArea.beginFill(0x3b82f6, 0.16);
                rollArea.drawRect(rollAreaX, rollAreaY, rollAreaWidth, rollAreaHeight);
                rollArea.endFill();
                rollArea.lineStyle(2, 0x3b82f6, 0.85);
                rollArea.drawRect(rollAreaX, rollAreaY, rollAreaWidth, rollAreaHeight);
                this.staticLayer.addChild(rollArea);
                this.drawPocketDebugRings();
            }

            this.createUiOverlayLayers();
            return;
        }

        const tableShadow = new PIXI.Graphics();
        tableShadow.beginFill(0x000000, 0.24);
        tableShadow.drawRoundedRect(-borderW / 2 - 10, -borderH / 2 - 4, borderW + 20, borderH + 18, 28);
        tableShadow.endFill();
        tableShadow.y = 12;
        tableShadow.filters = [new PIXI.BlurFilter(10)];
        this.staticLayer.addChild(tableShadow);

        const g = new PIXI.Graphics();
        g.beginFill(0x4a2812);
        g.drawRoundedRect(-borderW / 2, -borderH / 2, borderW, borderH, 24);
        g.endFill();
        this.staticLayer.addChild(g);

        const woodBevel = new PIXI.Graphics();
        woodBevel.beginFill(0x6b4220, 0.95);
        woodBevel.drawRoundedRect(-borderW / 2 + 4, -borderH / 2 + 4, borderW - 8, borderH - 8, 22);
        woodBevel.endFill();
        woodBevel.beginFill(0x2b1408, 0.5);
        woodBevel.drawRoundedRect(-borderW / 2 + 10, -borderH / 2 + 10, borderW - 20, borderH - 20, 18);
        woodBevel.endFill();
        this.staticLayer.addChild(woodBevel);

        const woodHighlight = new PIXI.Graphics();
        woodHighlight.beginFill(0xf0c28a, 0.11);
        woodHighlight.drawRoundedRect(-borderW / 2 + 8, -borderH / 2 + 8, borderW - 16, 16, 10);
        woodHighlight.endFill();
        woodHighlight.beginFill(0x2a1207, 0.22);
        woodHighlight.drawRoundedRect(-borderW / 2 + 10, borderH / 2 - 20, borderW - 20, 12, 8);
        woodHighlight.endFill();
        this.staticLayer.addChild(woodHighlight);

        // Cloth with radial gradient sprite
        const cloth = new PIXI.Sprite(this.textures.cloth);
        cloth.anchor.set(0.5);
        cloth.width = TABLE_WIDTH;
        cloth.height = TABLE_HEIGHT;
        this.staticLayer.addChild(cloth);

        if (showDebugOverlay) {
            const rollArea = new PIXI.Graphics();
            rollArea.beginFill(0x3b82f6, 0.16);
            rollArea.drawRect(rollAreaX, rollAreaY, rollAreaWidth, rollAreaHeight);
            rollArea.endFill();
            rollArea.lineStyle(2, 0x3b82f6, 0.85);
            rollArea.drawRect(rollAreaX, rollAreaY, rollAreaWidth, rollAreaHeight);
            this.staticLayer.addChild(rollArea);
        }

        const cushions = new PIXI.Graphics();
        const cushionThickness = 12;
        cushions.beginFill(0x0e4d2f);
        
        // Draw cushions with small gaps for pockets
        const gap = POCKET_RADIUS * 0.8;
        // Top
        cushions.drawRect(-TABLE_WIDTH / 2 + gap, -TABLE_HEIGHT / 2, TABLE_WIDTH / 2 - gap - gap/2, cushionThickness);
        cushions.drawRect(gap/2, -TABLE_HEIGHT / 2, TABLE_WIDTH / 2 - gap, cushionThickness);
        // Bottom
        cushions.drawRect(-TABLE_WIDTH / 2 + gap, TABLE_HEIGHT / 2 - cushionThickness, TABLE_WIDTH / 2 - gap - gap/2, cushionThickness);
        cushions.drawRect(gap/2, TABLE_HEIGHT / 2 - cushionThickness, TABLE_WIDTH / 2 - gap, cushionThickness);
        // Left
        cushions.drawRect(-TABLE_WIDTH / 2, -TABLE_HEIGHT / 2 + gap, cushionThickness, TABLE_HEIGHT - gap * 2);
        // Right
        cushions.drawRect(TABLE_WIDTH / 2 - cushionThickness, -TABLE_HEIGHT / 2 + gap, cushionThickness, TABLE_HEIGHT - gap * 2);
        cushions.endFill();

        cushions.beginFill(0x2b7b4a, 0.42);
        cushions.drawRect(-TABLE_WIDTH / 2 + gap, -TABLE_HEIGHT / 2 + 1.5, TABLE_WIDTH / 2 - gap - gap / 2, 3);
        cushions.drawRect(gap / 2, -TABLE_HEIGHT / 2 + 1.5, TABLE_WIDTH / 2 - gap, 3);
        cushions.drawRect(-TABLE_WIDTH / 2 + gap, TABLE_HEIGHT / 2 - cushionThickness, TABLE_WIDTH / 2 - gap - gap / 2, 2.5);
        cushions.drawRect(gap / 2, TABLE_HEIGHT / 2 - cushionThickness, TABLE_WIDTH / 2 - gap, 2.5);
        cushions.drawRect(-TABLE_WIDTH / 2 + 1.5, -TABLE_HEIGHT / 2 + gap, 3, TABLE_HEIGHT - gap * 2);
        cushions.drawRect(TABLE_WIDTH / 2 - cushionThickness, -TABLE_HEIGHT / 2 + gap, 2.5, TABLE_HEIGHT - gap * 2);
        cushions.endFill();
        
        // Diamonds
        cushions.beginFill(0xf8e4c1, 0.72);
        const diamondDistX = TABLE_WIDTH / 4;
        const diamondDistY = TABLE_HEIGHT / 2;
        for (let i = 1; i <= 3; i++) {
            cushions.drawCircle(-TABLE_WIDTH / 2 + i * diamondDistX, -TABLE_HEIGHT / 2 - railThickness / 2, 3);
            cushions.drawCircle(-TABLE_WIDTH / 2 + i * diamondDistX, TABLE_HEIGHT / 2 + railThickness / 2, 3);
        }
        for (let i = 1; i <= 1; i++) {
            cushions.drawCircle(-TABLE_WIDTH / 2 - railThickness / 2, -TABLE_HEIGHT / 2 + i * diamondDistY, 3);
            cushions.drawCircle(TABLE_WIDTH / 2 + railThickness / 2, -TABLE_HEIGHT / 2 + i * diamondDistY, 3);
        }
        cushions.endFill();
        this.staticLayer.addChild(cushions);

        // Pockets
        this.game.pockets.forEach(pocket => {
            // Shadow / Hole under the pocket sprite
            const hole = new PIXI.Graphics();
            hole.beginFill(0x000000, 0.4);
            hole.drawCircle(pocket.x, pocket.y, POCKET_RADIUS + 2);
            hole.endFill();
            this.staticLayer.addChild(hole);

            const p = new PIXI.Sprite(this.textures.pocket);
            p.anchor.set(0.5);
            p.x = pocket.x;
            p.y = pocket.y;
            p.width = POCKET_RADIUS * 2;
            p.height = POCKET_RADIUS * 2;
            this.staticLayer.addChild(p);
            
            const border = new PIXI.Graphics();
            border.lineStyle(3, 0x111111, 0.8);
            border.drawCircle(pocket.x, pocket.y, POCKET_RADIUS - 1.5);
            this.staticLayer.addChild(border);

            const pocketLiner = new PIXI.Graphics();
            pocketLiner.lineStyle(4, 0x5a3315, 0.72);
            pocketLiner.drawCircle(pocket.x, pocket.y, POCKET_RADIUS + 2.5);
            pocketLiner.lineStyle(1.5, 0xe7c187, 0.28);
            pocketLiner.drawCircle(pocket.x, pocket.y, POCKET_RADIUS + 0.5);
            this.staticLayer.addChild(pocketLiner);
        });

        if (showDebugOverlay) {
            this.drawPocketDebugRings();
        }

        this.createUiOverlayLayers();
    }

    drawCueStickGraphics() {
        this.cueStick = new PIXI.Graphics();
        this.cueStickContainer.addChild(this.cueStick);
    }



    updateBalls(game) {
        const activeBalls = new Set();
        
        if (!ballGeometry && window.PIXI) {
            ballGeometry = new PIXI.Geometry()
                .addAttribute('aVertexPosition', [-1, -1, 1, -1, 1, 1, -1, 1], 2)
                .addAttribute('aTextureCoord', [0, 0, 1, 0, 1, 1, 0, 1], 2)
                .addIndex([0, 1, 2, 0, 2, 3]);
        }

        game.balls.forEach(ball => {
            if (ball.pocketed) return;
            activeBalls.add(ball);
            
            let shadow = this.shadowSprites.get(ball);
            if (!shadow) {
                shadow = new PIXI.Sprite(this.textures.ballShadow);
                shadow.anchor.set(0.5);
                shadow.width = BALL_RADIUS * 2.2;
                shadow.height = BALL_RADIUS * 2.2;
                this.shadowLayer.addChild(shadow);
                this.shadowSprites.set(ball, shadow);
            }
            shadow.x = ball.renderPos.x + 2;
            shadow.y = ball.renderPos.y + 4;

            let sprite = this.ballSprites.get(ball);
            if (!sprite) {
                const num = ball.label ? parseInt(ball.label) : 0;
                
                const shader = PIXI.Shader.from(ballVertShader, ballFragShader, {
                    uSampler: this.textures[`label_${num}`],
                    uColor: ball.colorRgb,
                    uIsStripe: ball.type === 'stripe' ? 1.0 : 0.0,
                    uRotation: ball.renderRot,
                    uLightDir: [-0.42, -0.55, 0.72] // 调整光源至左上方
                });
                
                sprite = new PIXI.Mesh(ballGeometry, shader);
                sprite.scale.set(BALL_RADIUS);
                
                this.ballLayer.addChild(sprite);
                this.ballSprites.set(ball, sprite);
            }
            
            sprite.x = ball.renderPos.x;
            sprite.y = ball.renderPos.y;
            sprite.shader.uniforms.uRotation = ball.renderRot;
        });

        for (const [ball, sprite] of this.ballSprites.entries()) {
            if (!activeBalls.has(ball)) {
                this.ballLayer.removeChild(sprite);
                sprite.destroy();
                this.ballSprites.delete(ball);
                
                const shadow = this.shadowSprites.get(ball);
                if (shadow) {
                    this.shadowLayer.removeChild(shadow);
                    shadow.destroy();
                    this.shadowSprites.delete(ball);
                }
            }
        }
    }

    render(game) {
        this.updateBalls(game);
        this.updateEffects(game);
        
        const g = this.dynamicGraphics;
        g.clear();

        // Kitchen Zone
        if (game.ballInHand && game.ballInHandZone === 'kitchen') {
            g.beginFill(0xfff8c4, 0.08);
            g.drawRect(-TABLE_WIDTH / 2, -TABLE_HEIGHT / 2, HEAD_STRING_X + TABLE_WIDTH / 2, TABLE_HEIGHT);
            g.endFill();
            this.drawDashedLine(g, HEAD_STRING_X, -TABLE_HEIGHT / 2, HEAD_STRING_X, TABLE_HEIGHT / 2, 0xfff8c4, 0.5, 2, [10, 8]);
        }

        // Release Flash
        if (game.releaseFlash > 0 && !game.cueBall.pocketed) {
            const flashRatio = game.releaseFlash / RELEASE_FLASH_DURATION;
            g.lineStyle(4 * flashRatio, 0xffecb3, flashRatio * 0.8);
            const radius = BALL_RADIUS + 10 + (1 - flashRatio) * 18;
            g.drawCircle(game.cueBall.renderPos.x, game.cueBall.renderPos.y, radius);
        }

        // Ball placement guide
        if (game.ballInHand && !game.isGameOver) {
            const isMyTurn = (game.currentPlayer === game.playerIndex);
            const color = game.cuePlacementValid ? (isMyTurn ? 0xffffff : 0x888888) : 0xef4444;
            const alpha = game.cuePlacementValid ? (isMyTurn ? 0.8 : 0.4) : 0.9;
            this.drawDashedLineCircle(g, game.cueBall.renderPos.x, game.cueBall.renderPos.y, BALL_RADIUS + 8, color, alpha, 3, [10, 6]);
        }

        if (!game.ballInHand && !game.isMoving() && !game.cueBall.pocketed && !game.isGameOver) {
            this.drawAimAndCue(game);
        } else {
            this.cueStick.clear();
        }

        this.app.renderer.render(this.app.stage);
    }

    updateEffects(game) {
        this.effectLayer.removeChildren();
        const g = new PIXI.Graphics();
        this.effectLayer.addChild(g);

        // Score effects
        game.scorePocketEffects.forEach(effect => {
            const progress = Math.min(1, effect.age / effect.duration);
            const fade = 1 - progress;
            const ringRadius = POCKET_RADIUS * (0.38 + progress * 0.92);
            
            g.beginFill(0xffec96, fade * 0.42);
            g.drawCircle(effect.pos.x, effect.pos.y, ringRadius);
            g.endFill();

            g.lineStyle(3.8 - progress * 2, 0xffd248, fade * 0.95);
            g.drawCircle(effect.pos.x, effect.pos.y, ringRadius);
            
            g.lineStyle(0);
            g.beginFill(0xfff9d2, fade);
            g.drawCircle(effect.pos.x, effect.pos.y, 4.5 + progress * 1.8);
            g.endFill();

            effect.sparks.forEach((spark, index) => {
                const travel = spark.speed * progress;
                const px = effect.pos.x + Math.cos(spark.angle) * travel;
                const py = effect.pos.y + Math.sin(spark.angle) * travel;
                const colors = [0xfff5bc, 0xffcf54, 0xff9a48];
                const color = colors[index % 3];
                g.beginFill(color, fade * 0.96);
                g.drawCircle(px, py, Math.max(0.4, spark.radius * (1 - progress * 0.72)));
                g.endFill();
            });
        });

        // Collision effects
        game.collisionEffects.forEach(effect => {
            const ratio = effect.age / 15;
            const opacity = 1 - ratio;
            if (effect.type === 'rail') {
                g.lineStyle(2, 0xffffff, opacity * 0.5);
                g.drawCircle(effect.pos.x, effect.pos.y, 5 + ratio * 20);
            } else {
                g.lineStyle(0);
                g.beginFill(0xffffff, opacity * 0.4);
                g.drawCircle(effect.pos.x, effect.pos.y, 2 + ratio * 15);
                g.endFill();
            }
        });
    }

    drawAimAndCue(game) {
        const isMyTurn = (game.currentPlayer === game.playerIndex);
        const cueRenderPos = game.cueBall.renderPos || game.cueBall.pos;
        if (isMyTurn && game.hasPointerInput && !game.isDragging) {
            const hoverAim = cueRenderPos.clone().sub(game.mousePos);
            if (hoverAim.length() > 4) game.aimAngle = Math.atan2(hoverAim.y, hoverAim.x);
        }

        const g = this.dynamicGraphics;
        const ang = game.aimAngle;
        const direction = new Vec2(Math.cos(ang), Math.sin(ang));
        const powerRatio = getRenderedCuePowerRatio(game);

        if (shouldRenderAimGuides(game)) {
            const guide = game.getAimGuide(direction);
            const guideAlpha = 0.28 + powerRatio * 0.45;
            const guideWidth = 1.5 + powerRatio * 2.5;

            this.drawDashedLine(g, cueRenderPos.x, cueRenderPos.y, guide.hitPoint.x, guide.hitPoint.y, 0xffffff, guideAlpha, guideWidth, [8, 6]);

            g.lineStyle(0);
            g.beginFill(0xffffff, 0.28);
            g.drawCircle(guide.hitPoint.x, guide.hitPoint.y, 4 + powerRatio * 3);
            g.endFill();

            if (guide.type === 'ball') {
                this.drawBallGuide(game, g, guide, direction);
                g.lineStyle(1, 0xffffff, 0.3 * 0.8);
                g.beginFill(0xffffff, 0.3);
                g.drawCircle(guide.hitPoint.x, guide.hitPoint.y, BALL_RADIUS);
                g.endFill();
            }
        }

        this.drawCueStick(game, ang, powerRatio);
        
        if (isMyTurn && (game.isDragging || game.showRemoteCue)) {
            this.drawPowerBar(game, powerRatio);
        } else {
            if (this.powerLabel) this.powerLabel.visible = false;
        }
    }

    drawBallGuide(game, g, guide, direction) {
        const targetBall = guide.ball;
        const targetPhysicsPos = targetBall.physicsPos || targetBall.pos;
        const targetRenderPos = targetBall.renderPos || targetPhysicsPos;
        const targetDirection = guide.normal.clone().normalize();
        const targetTravel = game.getProjectedTravel(targetPhysicsPos, targetDirection, 240);
        const targetEnd = targetRenderPos.clone().add(targetDirection.clone().mul(targetTravel));
        const incoming = direction.clone().normalize();
        const cueDot = incoming.dot(guide.normal);
        const cueDeflect = incoming.clone().sub(guide.normal.clone().mul(cueDot));
        const cueDeflectLength = cueDeflect.length();

        this.drawDashedLine(g, targetRenderPos.x, targetRenderPos.y, targetEnd.x, targetEnd.y, 0xffdf80, 0.72, 2.5, [10, 5]);

        if (cueDeflectLength > 0.05) {
            const cueDirection = cueDeflect.clone().normalize();
            const cueTravel = game.getProjectedTravel(guide.cueImpact, cueDirection, 140);
            const cueEnd = guide.cueImpact.clone().add(cueDirection.clone().mul(cueTravel));
            this.drawDashedLine(g, guide.cueImpact.x, guide.cueImpact.y, cueEnd.x, cueEnd.y, 0xc4e6ff, 0.65, 2, [6, 6]);
        }

        g.lineStyle(0);
        g.beginFill(0xffdf80, 0.34);
        g.drawCircle(guide.contactPoint.x, guide.contactPoint.y, 3.5);
        g.endFill();

        g.lineStyle(3, 0xffffff, 0.85);
        g.drawCircle(targetRenderPos.x, targetRenderPos.y, BALL_RADIUS + 5);
        
        g.lineStyle(0);
        g.beginFill(0xffdf80, 0.18);
        g.drawCircle(targetRenderPos.x, targetRenderPos.y, BALL_RADIUS + 8);
        g.endFill();
    }

    drawCueStick(game, angle, powerRatio) {
        const cue = this.cueStick;
        cue.clear();
        
        const pull = getRenderedCuePullDistance(game);
        const cueBase = BALL_RADIUS + 2 + pull;
        const tipLength = 6;
        const ferruleLength = 8;
        const shaftLength = 224;
        const wrapLength = 68;
        const buttLength = 74;
        const totalLength = tipLength + ferruleLength + shaftLength + wrapLength + buttLength;

        cue.x = game.cueBall.renderPos.x;
        cue.y = game.cueBall.renderPos.y;
        cue.rotation = angle + Math.PI;

        cue.beginFill(0x1d90bf);
        cue.drawRect(cueBase, -1.1, tipLength, 2.2);
        cue.endFill();

        cue.beginFill(0xf1e7cf);
        cue.drawRect(cueBase + tipLength, -1.8, ferruleLength, 3.6);
        cue.endFill();

        cue.beginFill(0xf8f1dc);
        cue.moveTo(cueBase + tipLength + ferruleLength, -2.4);
        cue.lineTo(cueBase + tipLength + ferruleLength + shaftLength, -5.4);
        cue.lineTo(cueBase + tipLength + ferruleLength + shaftLength, 5.4);
        cue.lineTo(cueBase + tipLength + ferruleLength, 2.4);
        cue.endFill();

        cue.beginFill(0x101010);
        cue.drawRect(cueBase + tipLength + ferruleLength + shaftLength - 1, -6.4, wrapLength + 2, 12.8);
        cue.endFill();

        cue.beginFill(0x4b2f18);
        cue.moveTo(cueBase + tipLength + ferruleLength + shaftLength + wrapLength, -7);
        cue.lineTo(cueBase + tipLength + ferruleLength + shaftLength + wrapLength + buttLength, -8.2);
        cue.lineTo(cueBase + tipLength + ferruleLength + shaftLength + wrapLength + buttLength, 8.2);
        cue.lineTo(cueBase + tipLength + ferruleLength + shaftLength + wrapLength, 7);
        cue.endFill();

        cue.lineStyle(1.1, 0xffffff, 0.18);
        cue.moveTo(cueBase + tipLength + ferruleLength + 14, -1.3);
        cue.lineTo(cueBase + tipLength + ferruleLength + shaftLength + 6, -3.2);
        cue.lineTo(cueBase + tipLength + ferruleLength + shaftLength + wrapLength + buttLength - 18, -2.2);

        cue.lineStyle(0);
        cue.beginFill(0xffecb3, 0.32 + powerRatio * 0.5);
        cue.drawEllipse(cueBase + 7, 0, 8, 4.2);
        cue.endFill();
    }

    drawPowerBar(game, powerRatio) {
        const g = this.dynamicGraphics;
        const barWidth = 12;
        const barHeight = 120;
        const x = TABLE_WIDTH / 2 + RAIL_THICKNESS + 25;
        const y = -barHeight / 2;
        
        g.beginFill(0x000000, 0.5);
        g.drawRect(x, y, barWidth, barHeight);
        g.endFill();
        
        let powerColor = 0x16a34a; 
        if (powerRatio > 0.5) powerColor = 0xfbbf24; 
        if (powerRatio > 0.8) powerColor = 0xdc2626; 
        
        g.beginFill(powerColor);
        const currentBarHeight = barHeight * powerRatio;
        g.drawRect(x, y + barHeight - currentBarHeight, barWidth, currentBarHeight);
        g.endFill();
        
        g.lineStyle(1, 0xffffff, 1);
        g.drawRect(x, y, barWidth, barHeight);

        // Power Label
        if (!this.powerLabel) {
            this.powerLabel = new PIXI.Text('POWER', {
                fontFamily: 'Arial',
                fontSize: 10,
                fontWeight: 'bold',
                fill: 0xffffff
            });
            this.powerLabel.anchor.set(0.5);
            this.uiLayer.addChild(this.powerLabel);
        }
        this.powerLabel.x = x + barWidth + 15;
        this.powerLabel.y = 0;
        this.powerLabel.rotation = Math.PI / 2;
        this.powerLabel.visible = true;
    }

    drawDashedLine(g, x1, y1, x2, y2, color, alpha, width, dash) {
        g.lineStyle(width, color, alpha);
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.sqrt(dx * dx + dy * dy);
        const dirX = dx / len;
        const dirY = dy / len;
        
        let currentLen = 0;
        let draw = true;
        let dashIdx = 0;
        
        while (currentLen < len) {
            const dashLen = dash[dashIdx % dash.length];
            const nextLen = Math.min(len, currentLen + dashLen);
            if (draw) {
                g.moveTo(x1 + dirX * currentLen, y1 + dirY * currentLen);
                g.lineTo(x1 + dirX * nextLen, y1 + dirY * nextLen);
            }
            currentLen = nextLen;
            draw = !draw;
            dashIdx++;
        }
    }

    drawDashedLineCircle(g, x, y, radius, color, alpha, width, dash) {
        const circumference = 2 * Math.PI * radius;
        const steps = 64;
        const stepLen = circumference / steps;
        
        let currentLen = 0;
        let draw = true;
        let dashIdx = 0;
        let dashRemaining = dash[0];
        
        g.lineStyle(width, color, alpha);
        
        for (let i = 0; i < steps; i++) {
            const angle1 = (i / steps) * Math.PI * 2;
            const angle2 = ((i + 1) / steps) * Math.PI * 2;
            
            if (draw) {
                g.moveTo(x + Math.cos(angle1) * radius, y + Math.sin(angle1) * radius);
                g.lineTo(x + Math.cos(angle2) * radius, y + Math.sin(angle2) * radius);
            }
            
            dashRemaining -= stepLen;
            if (dashRemaining <= 0) {
                draw = !draw;
                dashIdx = (dashIdx + 1) % dash.length;
                dashRemaining = dash[dashIdx];
            }
        }
    }
}
