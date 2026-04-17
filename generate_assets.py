import base64
import os

colors = [
  '#ffffff', '#facc15', '#2563eb', '#dc2626', '#6d28d9', '#f97316', '#16a34a', '#7f1d1d', '#222222',
  '#facc15', '#2563eb', '#dc2626', '#6d28d9', '#f97316', '#16a34a', '#7f1d1d'
]

def generate_ball(num, color):
    is_stripe = num > 8
    base_color = '#fbfbf8' if is_stripe else color
    
    stripe = ''
    if is_stripe:
        stripe = f'<clipPath id="c{num}"><circle cx="50" cy="50" r="48"/></clipPath><rect x="0" y="22" width="100" height="56" fill="{color}" clip-path="url(#c{num})"/>'
    
    text = ''
    if num > 0:
        text = f'<circle cx="50" cy="50" r="24" fill="#ffffff" /><text x="50" y="58" font-family="Arial" font-weight="bold" font-size="26" text-anchor="middle" fill="#000000">{num}</text>'
    
    svg = f'''<svg width="100" height="100" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
<defs>
  <radialGradient id="grad{num}" cx="30%" cy="30%" r="70%">
    <stop offset="0%" stop-color="#ffffff" stop-opacity="0.5"/>
    <stop offset="40%" stop-color="#ffffff" stop-opacity="0.05"/>
    <stop offset="100%" stop-color="#000000" stop-opacity="0.45"/>
  </radialGradient>
</defs>
<circle cx="50" cy="50" r="48" fill="{base_color}" />
{stripe}
{text}
<circle cx="50" cy="50" r="48" fill="url(#grad{num})" />
</svg>'''
    return "data:image/svg+xml;base64," + base64.b64encode(svg.encode('utf-8')).decode('utf-8')

assets = {}
for i in range(16):
    assets[f'ball_{i}'] = generate_ball(i, colors[i])

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

os.makedirs('/Users/majunjie/Desktop/codex/游戏/台球_副本7/daily-billiards-vanilla_web/src/render', exist_ok=True)
with open('/Users/majunjie/Desktop/codex/游戏/台球_副本7/daily-billiards-vanilla_web/src/render/assets.js', 'w') as f:
    f.write(js_content)
print("Assets generated successfully.")
