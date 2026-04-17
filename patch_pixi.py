import re

with open('/Users/majunjie/Desktop/codex/游戏/台球_副本7/daily-billiards-vanilla_web/src/render/pixi-renderer.js', 'r') as f:
    content = f.read()

# Import Assets
if "import { AssetsBase64 }" not in content:
    content = "import { AssetsBase64 } from './assets.js';\n" + content

# Replace generateTextures
new_generate_textures = """    generateTextures() {
        const textures = {};
        for (let i = 0; i <= 15; i++) {
            textures[`ball_${i}`] = PIXI.Texture.from(AssetsBase64[`ball_${i}`]);
        }
        textures.ballShadow = PIXI.Texture.from(AssetsBase64.shadow);

        const clothCanvas = document.createElement('canvas');
        clothCanvas.width = 512; clothCanvas.height = 512;
        const clothCtx = clothCanvas.getContext('2d');
        const clothGrad = clothCtx.createRadialGradient(256, 256, 0, 256, 256, 256);
        clothGrad.addColorStop(0, '#1a7547');
        clothGrad.addColorStop(1, '#0d4a2b');
        clothCtx.fillStyle = clothGrad;
        clothCtx.fillRect(0, 0, 512, 512);
        textures.cloth = PIXI.Texture.from(clothCanvas);

        const pocketCanvas = document.createElement('canvas');
        pocketCanvas.width = 128; pocketCanvas.height = 128;
        const pocketCtx = pocketCanvas.getContext('2d');
        const pocketGrad = pocketCtx.createRadialGradient(64, 64, POCKET_RADIUS * 0.4 * (64/POCKET_RADIUS), 64, 64, 64);
        pocketGrad.addColorStop(0, '#000000');
        pocketGrad.addColorStop(1, '#111111');
        pocketCtx.fillStyle = pocketGrad;
        pocketCtx.fillRect(0, 0, 128, 128);
        textures.pocket = PIXI.Texture.from(pocketCanvas);

        return textures;
    }"""

content = re.sub(r'    generateTextures\(\) \{.*?(?=    resize\()', new_generate_textures + '\n\n', content, flags=re.DOTALL)

# Replace updateBalls, createBallContainer, updateBallVisuals
new_update_balls = """    updateBalls(game) {
        const activeBalls = new Set();
        
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
            shadow.x = ball.pos.x + 2;
            shadow.y = ball.pos.y + 4;

            let sprite = this.ballSprites.get(ball);
            if (!sprite) {
                const num = ball.label ? parseInt(ball.label) : 0;
                sprite = new PIXI.Sprite(this.textures[`ball_${num}`]);
                sprite.anchor.set(0.5);
                sprite.width = BALL_RADIUS * 2;
                sprite.height = BALL_RADIUS * 2;
                this.ballLayer.addChild(sprite);
                this.ballSprites.set(ball, sprite);
            }
            
            sprite.x = ball.pos.x;
            sprite.y = ball.pos.y;
            sprite.rotation = ball.rollAngle * Math.sign(ball.vel.x || 1);
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
    }"""

content = re.sub(r'    updateBalls\(game\) \{.*?(?=    render\(game\))', new_update_balls + '\n\n', content, flags=re.DOTALL)

with open('/Users/majunjie/Desktop/codex/游戏/台球_副本7/daily-billiards-vanilla_web/src/render/pixi-renderer.js', 'w') as f:
    f.write(content)
print("Pixi Renderer patched successfully.")
