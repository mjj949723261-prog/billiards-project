import re

with open('/Users/majunjie/Desktop/codex/游戏/台球_副本7/daily-billiards-vanilla_web/src/render/pixi-renderer.js', 'r') as f:
    content = f.read()

# 把错位的 ballFragShader 定义移到文件的 import 之后、类定义之前
shader_code = r"""const ballFragShader = `
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
`;"""

# 先移除错误的定义位置
content = re.sub(r'const ballFragShader = `.*?`;', '', content, flags=re.DOTALL)

# 插入到 import 之后
if "export class PixiRenderer" in content:
    content = content.replace("export class PixiRenderer", shader_code + "\n\nexport class PixiRenderer")

with open('/Users/majunjie/Desktop/codex/游戏/台球_副本7/daily-billiards-vanilla_web/src/render/pixi-renderer.js', 'w') as f:
    f.write(content)
print("Syntax error fixed.")
