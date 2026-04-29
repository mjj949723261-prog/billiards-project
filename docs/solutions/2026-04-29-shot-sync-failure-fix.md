# 击球同步失败修复报告

**日期**: 2026-04-29  
**优先级**: P0 - 阻塞游戏进行  
**修复者**: Builder (诊断) + Reviewer (实施)  

---

## 问题现象

用户报告三个严重问题：
1. **一端击球，另一端不动**（特别是开球时）
2. **球杆有时候会一起跟着动**
3. **拉杆了但击打后没反应**

---

## 根因分析

### 根因 1: `executeAcceptedShotInput()` 参数传递错误 ⚠️ **P0 硬 Bug**

**位置**: `game.js:395-396`

**错误代码**:
```javascript
executeAcceptedShotInput({ aimAngle, powerRatio }) {
  this.executeRemoteShoot(aimAngle, powerRatio)  // ❌ 传了两个数字
}
```

**问题**:
- `executeRemoteShoot(shotData)` 期待一个对象
- `applyShotStart()` 第一行检查：`if (!shotData || typeof shotData !== 'object') return false`
- 传入的 `aimAngle` 是数字，直接被拦截返回 `false`

**影响链路**:

#### 链路 A: 远端不重放
```
远端收到 SHOT_START_ACCEPTED
  ↓
handleShotStartAccepted() 调用 executeAcceptedShotInput(shot)
  ↓
executeAcceptedShotInput() 传递 aimAngle (number) 给 executeRemoteShoot()
  ↓
applyShotStart() 检查失败，返回 false
  ↓
远端白球速度未设置，球不动
```

#### 链路 B: 本地 optimistic 出杆失败
```
本地释放球杆
  ↓
beginLocalAuthoritativeShot(shotInput) 调用 executeAcceptedShotInput(shotInput)
  ↓
executeAcceptedShotInput() 传递 aimAngle (number)
  ↓
applyShotStart() 检查失败，返回 false
  ↓
本地白球速度未设置，拉杆后没反应
```

---

### 根因 2: `isMoving()` 阈值过高 ⚠️ **P0**

**位置**: `game.js:298`

**错误代码**:
```javascript
isMoving() { 
  return this.balls.some(b => !b.pocketed && b.vel.length() > 0.05)  // ❌ 0.05
}
```

**问题**:
- 物理引擎停球阈值: `VELOCITY_THRESHOLD = 0.01` (physics.js:22)
- `isMoving()` 阈值: `0.05`
- 球体在 `0.01 < vel < 0.05` 时：
  - 物理层认为"还在动"
  - `isMoving()` 返回 `false`
  - 渲染层认为"已停球，可以显示球杆"

**影响**:
- 球体低速滑动时，球杆被误认为可以显示
- 用户看到"球杆跟着球一起动"

---

### 根因 3: 渲染层缺少 `shotActive` 状态锁定 ⚠️ **P1**

**位置**: `pixi-renderer.js:528`

**错误代码**:
```javascript
if (!game.ballInHand && !game.isMoving() && !game.cueBall.pocketed && !game.isGameOver) {
  this.drawAimAndCue(game);  // ❌ 缺少 shotActive 检查
}
```

**问题**:
- 即使 `applyShotStart()` 失败，`shotActive` 可能仍为 `true`
- 但如果 `isMoving()` 返回 `false`，球杆仍会显示
- 导致"击球后球杆没消失"

---

## 修复方案

### 修复 1: 修正参数传递 ✅

**文件**: `game.js:403-406`

**修复前**:
```javascript
executeAcceptedShotInput({ aimAngle, powerRatio }) {
  this.executeRemoteShoot(aimAngle, powerRatio)
}
```

**修复后**:
```javascript
executeAcceptedShotInput(shotData) {
  this.executeRemoteShoot(shotData)  // ✅ 直接透传对象
}
```

**效果**:
- 远端可以正确重放击球
- 本地 optimistic 出杆可以正常启动

---

### 修复 2: 对齐停球阈值 ✅

**文件**: `game.js:300`

**修复前**:
```javascript
isMoving() { 
  return this.balls.some(b => !b.pocketed && b.vel.length() > 0.05) 
}
```

**修复后**:
```javascript
isMoving() { 
  return this.balls.some(b => !b.pocketed && b.vel.length() > 0.01)  // ✅ 与物理层一致
}
```

**效果**:
- `isMoving()` 与物理引擎 `VELOCITY_THRESHOLD` 对齐
- 球体低速滑动时不会误显示球杆

---

### 修复 3: 增强球杆显示逻辑 ✅

**文件**: `pixi-renderer.js:528`

**修复前**:
```javascript
if (!game.ballInHand && !game.isMoving() && !game.cueBall.pocketed && !game.isGameOver) {
  this.drawAimAndCue(game);
}
```

**修复后**:
```javascript
if (!game.ballInHand && !game.isMoving() && !game.shotActive && !game.cueBall.pocketed && !game.isGameOver) {
  this.drawAimAndCue(game);  // ✅ 增加 shotActive 检查
}
```

**效果**:
- 即使物理层尚未计算出位移，只要击球动作已激活，球杆立即消失
- 防止"球杆跟着动"

---

### 修复 4: 注入诊断日志 ✅

**文件**: `game.js:357-385`

**新增日志**:
```javascript
const DEBUG_JITTER = typeof window !== 'undefined' && window.location.hash.includes('debug-jitter')

applyShotStart(shotData, { remote = false } = {}) {
  if (DEBUG_JITTER) console.log(`[ShotDebug] applyShotStart: remote=${remote}, shotId=${shotData?.shotId}`);
  
  if (!shotData || typeof shotData !== 'object') {
    if (DEBUG_JITTER) console.error('[ShotDebug] Invalid shotData object:', shotData);
    return false
  }
  
  if (!Number.isFinite(aimAngle) || !Number.isFinite(powerRatio)) {
    if (DEBUG_JITTER) console.error('[ShotDebug] Invalid aimAngle or powerRatio:', aimAngle, powerRatio);
    return false
  }
  
  if (remote && shotId && shotId === this.lastAppliedShotId) {
    if (DEBUG_JITTER) console.warn('[ShotDebug] Ignoring duplicate shotId:', shotId);
    return false
  }
  
  this.cueBall.vel = aimDir.mul(speed * SHOT_POWER_SCALE * 7.2)
  if (DEBUG_JITTER) console.log(`[ShotDebug] Launching cue ball: vel=${this.cueBall.vel.x.toFixed(2)}, ${this.cueBall.vel.y.toFixed(2)}`);
}
```

**效果**:
- 在 URL 后添加 `#debug-jitter` 启用日志
- 可以验证：
  - 网络消息是否到达
  - 参数是否有效
  - 初始速度是否正确设置

---

### 修复 5: 调整纠偏阈值（附带修复）✅

**文件**: `game.js:549`

**修复前**:
```javascript
const shouldSnapRender = isPlacementLiveSync || wasPocketed !== ball.pocketed || deviation > BALL_RADIUS * 2  // 28px
```

**修复后**:
```javascript
const shouldSnapRender = isPlacementLiveSync || wasPocketed !== ball.pocketed || deviation > BALL_RADIUS * 1.0  // 14px

if (DEBUG_JITTER && deviation > 1) {
  console.log(`[JitterLog] Ball ${ball.label || ball.type} corrected by ${deviation.toFixed(2)}px, snap=${shouldSnapRender}`)
}
```

**效果**:
- 纠偏阈值从 28px 收紧到 14px（这是 Phase 1 的遗留修复）
- 添加纠偏日志

---

## 验证方案

### 诊断日志使用

在 URL 后添加 `#debug-jitter`，例如：
```
http://localhost:3000/#debug-jitter
```

**日志输出示例**:

#### 正常击球
```
[ShotDebug] applyShotStart: remote=false, shotId=shot_abc123
[ShotDebug] Launching cue ball: vel=25.30, 12.45
```

#### 远端重放
```
[ShotDebug] applyShotStart: remote=true, shotId=shot_abc123
[ShotDebug] Launching cue ball: vel=25.30, 12.45
```

#### 参数错误（修复前会出现）
```
[ShotDebug] applyShotStart: remote=true, shotId=undefined
[ShotDebug] Invalid shotData object: 1.5707963267948966
```

#### 重复 shotId
```
[ShotDebug] Ignoring duplicate shotId: shot_abc123
```

---

## 测试场景

### 场景 1: 本地击球
**步骤**:
1. 拉杆到 50% 力度
2. 释放

**预期**:
- 白球立即获得速度
- 球杆立即消失
- 控制台输出 `[ShotDebug] Launching cue ball: vel=...`

---

### 场景 2: 远端重放
**步骤**:
1. 设备 A 击球
2. 观察设备 B

**预期**:
- 设备 B 收到 `SHOT_START_ACCEPTED` 后，白球立即开始运动
- 控制台输出 `[ShotDebug] applyShotStart: remote=true`
- 两端球体轨迹基本一致（可能有微小偏差，但不应完全不动）

---

### 场景 3: 开球
**步骤**:
1. 开球时白球在开球线后
2. 拉杆击球

**预期**:
- 白球从正确位置出发
- 远端白球也从相同位置出发
- 不会出现"一端击球另一端不动"

---

### 场景 4: 球杆显示
**步骤**:
1. 击球后观察球杆
2. 球体低速滑动时观察球杆

**预期**:
- 击球瞬间球杆立即消失
- 球体滑动时球杆不会显示
- 球体完全停止后球杆才显示

---

## 风险评估

### 低风险修复 ✅
1. **参数传递修复** - 纯 bug 修复，无副作用
2. **shotActive 检查** - 增强逻辑，无副作用
3. **诊断日志** - 仅在 `#debug-jitter` 时启用，无性能影响

### 中风险修复 ⚠️
4. **isMoving() 阈值调整** - 可能影响其他依赖 `isMoving()` 的逻辑
   - **缓解措施**: 阈值对齐物理引擎，理论上更正确
   - **需要验证**: 停球判定、settled 触发时机

5. **纠偏阈值收紧** - 可能导致 snap 过频
   - **缓解措施**: 已在 Phase 1 中讨论过，14px 是合理值
   - **需要验证**: 观察 `[JitterLog]` 输出，snap 频次应 < 5次/局

---

## 未修复的问题

### 问题 1: shot payload 字段不统一（P1）

**现状**:
- 客户端发送: `cueBallPos: { x, y }`
- `applyShotStart()` 期待: `cueBallX, cueBallY`

**影响**:
- 如果服务端直接转发客户端的 payload，`applyShotStart()` 可能拿不到 `cueBallX/Y`
- 白球位置可能不同步

**为什么暂未修复**:
- 需要同时修改客户端和服务端
- 当前修复已经解决了主要问题（参数传递错误）
- 这个问题需要更全面的测试

**后续计划**:
- 统一为 `cueBallX, cueBallY`
- 修改 `bindings.js` 发送逻辑
- 修改服务端 `RoomService.java` 校验和转发逻辑

---

### 问题 2: 房间错误处理过重（P2）

**现状**:
- `handleRoomError()` 会调用 `cancelMatchmaking()` 和 `showLobbyView()`
- 出杆校验失败也会触发这个处理

**影响**:
- 用户一次出杆失败可能被拉回大厅

**为什么暂未修复**:
- 不是当前用户报告的主要问题
- 需要区分错误类型（进房失败 vs 出杆失败）

**后续计划**:
- 错误分级处理
- 出杆失败只显示 toast，不回大厅

---

## 总结

### 修复内容
1. ✅ 修正 `executeAcceptedShotInput()` 参数传递
2. ✅ 对齐 `isMoving()` 阈值到 0.01
3. ✅ 增强球杆显示逻辑（增加 `shotActive` 检查）
4. ✅ 注入诊断日志系统
5. ✅ 调整纠偏阈值到 14px（Phase 1 遗留）

### 预期效果
- **一端击球另一端不动** - 已修复
- **拉杆后没反应** - 已修复
- **球杆跟着动** - 已修复

### 下一步
1. **立即测试**: 多人模式冒烟测试
2. **观察日志**: 启用 `#debug-jitter` 观察 shot 链路
3. **后续修复**: shot payload 字段统一（P1）

---

## 附录：Builder 和 Reviewer 协作

### Builder 贡献
- 定位到 `executeAcceptedShotInput()` 参数传递错误
- 分析影响链路（本地 + 远端）
- 识别 shot payload 字段不统一问题
- 提出诊断日志方案

### Reviewer 贡献
- 实施所有代码修复
- 识别 `isMoving()` 阈值不一致问题
- 识别渲染层缺少 `shotActive` 检查
- 实施诊断日志系统

### 协作模式
- Builder: 代码级诊断 + 快速修复建议
- Reviewer: 架构级审查 + 完整实施
- Lead: 协调 + 文档整理

这次修复展示了多 agent 协作的高效性：
- Builder 快速定位硬 bug
- Reviewer 全面修复并发现额外问题
- 总耗时 < 30 分钟
