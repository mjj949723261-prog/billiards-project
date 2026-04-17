import base64
import os
import re

# 1. Update assets.js
colors = [
  '#ffffff', '#facc15', '#2563eb', '#dc2626', '#6d28d9', '#f97316', '#16a34a', '#7f1d1d', '#222222',
  '#facc15', '#2563eb', '#dc2626', '#6d28d9', '#f97316', '#16a34a', '#7f1d1d'
]

def generate_label(num):
    if num == 0:
        svg = '<svg width="100" height="100" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"></svg>'
    else:
        svg = f'''<svg width="100" height="100" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
<circle cx="50" cy="50" r="46" fill="#ffffff" />
<text x="50" y="58" font-family="Arial" font-weight="bold" font-size="34" text-anchor="middle" fill="#000000">{num}</text>
</svg>'''
    return "data:image/svg+xml;base64," + base64.b64encode(svg.encode('utf-8')).decode('utf-8')

assets = {}
for i in range(16):
    assets[f'label_{i}'] = generate_label(i)

shadow = '''<svg width="100" height="100" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
<defs>
  <radialGradient id="shadowGrad" cx="50%" cy="50%" r="50%">
    <stop offset="0%" stop-color="#000000" stop-opacity="0.65"/>
    <stop offset="60%" stop-color="#000000" stop-opacity="0.25"/>
    <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
  </radialGradient>
</defs>
<circle cx="50" cy="50" r="50" fill="url(#shadowGrad)" />
</svg>'''
assets['shadow'] = "data:image/svg+xml;base64," + base64.b64encode(shadow.encode('utf-8')).decode('utf-8')

js_content = "export const AssetsBase64 = {\n"
for k, v in assets.items():
    js_content += f"  {k}: '{v}',\n"
js_content += "};\n"

with open('/Users/majunjie/Desktop/codex/游戏/台球_副本7/daily-billiards-vanilla_web/src/render/assets.js', 'w') as f:
    f.write(js_content)

# 2. Update ball.js
ball_js_code = """import { BALL_RADIUS, FRICTION, VELOCITY_THRESHOLD } from '../constants.js';
import { Vec2 } from '../math.js';

function mat3Identity() {
    return new Float32Array([1,0,0, 0,1,0, 0,0,1]);
}
function mat3Multiply(a, b) {
    const out = new Float32Array(9);
    for (let i=0; i<3; i++) {
        for (let j=0; j<3; j++) {
            let sum = 0;
            for (let k=0; k<3; k++) sum += a[k*3+i] * b[j*3+k];
            out[j*3+i] = sum;
        }
    }
    return out;
}
function mat3Rotate(axisX, axisY, axisZ, angle) {
    const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
    return new Float32Array([
        t*axisX*axisX + c,         t*axisX*axisY + s*axisZ,   t*axisX*axisZ - s*axisY,
        t*axisX*axisY - s*axisZ,   t*axisY*axisY + c,         t*axisY*axisZ + s*axisX,
        t*axisX*axisZ + s*axisY,   t*axisY*axisZ - s*axisX,   t*axisZ*axisZ + c
    ]);
}

export class Ball {
  constructor(x, y, color, type = 'solid', label = '') {
    this.pos = new Vec2(x, y);
    this.vel = new Vec2(0, 0);
    this.color = color;
    this.type = type;
    this.label = label;
    this.pocketed = false;
    this.rotMat = mat3Identity();
    
    let hex = color;
    if (hex.startsWith('#')) hex = hex.slice(1);
    let intVal = parseInt(hex, 16);
    this.colorRgb = new Float32Array([
        ((intVal >> 16) & 0xFF) / 255.0,
        ((intVal >> 8) & 0xFF) / 255.0,
        (intVal & 0xFF) / 255.0
    ]);
    if (this.type === 'cue') this.colorRgb = new Float32Array([1,1,1]);
  }

  update() {
    if (this.pocketed) return;
    const speed = this.vel.length();
    this.pos.add(this.vel);

    if (speed > 0.01) {
      const angle = speed / BALL_RADIUS;
      const axisX = -this.vel.y / speed;
      const axisY = this.vel.x / speed;
      // Reverse angle to match correct rolling direction mapping
      const rot = mat3Rotate(axisX, axisY, 0, -angle);
      this.rotMat = mat3Multiply(rot, this.rotMat);
    }

    this.vel.mul(FRICTION);
    const rollingDecel = 0.018; 
    if (speed > 0) {
        const drop = speed < rollingDecel ? speed : rollingDecel;
        const ratio = (speed - drop) / speed;
        this.vel.mul(ratio);
    }
    if (this.vel.length() < VELOCITY_THRESHOLD) {
        this.vel = new Vec2(0, 0);
    }
  }
}
"""
with open('/Users/majunjie/Desktop/codex/游戏/台球_副本7/daily-billiards-vanilla_web/src/entities/ball.js', 'w') as f:
    f.write(ball_js_code)

# 3. Update pixi-renderer.js
with open('/Users/majunjie/Desktop/codex/游戏/台球_副本7/daily-billiards-vanilla_web/src/render/pixi-renderer.js', 'r') as f:
    content = f.read()

new_generate_textures = """    generateTextures() {
        const textures = {};
        for (let i = 0; i <= 15; i++) {
            textures[`label_${i}`] = PIXI.Texture.from(AssetsBase64[`label_${i}`]);
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

new_update_balls = """const ballFragShader = `
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
    vec3 finalColor = vec3(0.96, 0.96, 0.92);
    
    if (uIsStripe > 0.5) {
        if (abs(localPos.x) < 0.52) {
            finalColor = uColor;
        }
    } else {
        finalColor = uColor;
    }
    
    float isLabel = 0.0;
    vec2 labelUV = vec2(0.0);
    
    if (localPos.x > 0.6) {
        labelUV = vec2(-localPos.y, localPos.z) / 0.45 * 0.5 + 0.5;
        if (length(labelUV - 0.5) <= 0.48) isLabel = 1.0;
    } else if (localPos.x < -0.6) {
        labelUV = vec2(localPos.y, localPos.z) / 0.45 * 0.5 + 0.5;
        if (length(labelUV - 0.5) <= 0.48) isLabel = 1.0;
    }
    
    if (isLabel > 0.0) {
        vec4 texColor = texture2D(uSampler, labelUV);
        finalColor = mix(finalColor, texColor.rgb, texColor.a);
    }
    
    float diffuse = max(dot(normal, uLightDir), 0.0);
    float ambient = 0.45;
    
    vec3 viewDir = vec3(0.0, 0.0, 1.0);
    vec3 halfDir = normalize(uLightDir + viewDir);
    float specAngle = max(dot(halfDir, normal), 0.0);
    float specular = pow(specAngle, 45.0) * 0.45;
    
    float edge = pow(1.0 - z, 3.0) * 0.35;
    
    vec3 litColor = finalColor * (ambient + diffuse * 0.6) + vec3(specular) - vec3(edge);
    gl_FragColor = vec4(litColor, 1.0);
}
`;

    updateBalls(game) {
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
                sprite = new PIXI.Sprite(this.textures[`label_${num}`]);
                sprite.anchor.set(0.5);
                sprite.width = BALL_RADIUS * 2;
                sprite.height = BALL_RADIUS * 2;
                
                const filter = new PIXI.Filter(null, ballFragShader, {
                    uColor: ball.colorRgb,
                    uIsStripe: ball.type === 'stripe' ? 1.0 : 0.0,
                    uRotation: ball.rotMat,
                    uLightDir: [0.31, -0.42, 0.84]
                });
                filter.padding = 1;
                sprite.filters = [filter];
                
                this.ballLayer.addChild(sprite);
                this.ballSprites.set(ball, sprite);
            }
            
            sprite.x = ball.pos.x;
            sprite.y = ball.pos.y;
            sprite.filters[0].uniforms.uRotation = ball.rotMat;
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
