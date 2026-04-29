# 击球拉扯问题修复 - 最终裁决方案

**日期**：2026-04-29  
**状态**：待确认  
**裁决者**：lead  
**参与方**：builder (Codex), reviewer (Codex)

---

## 一、裁决背景

经过 builder 和 reviewer 的独立分析和可行性评估，对 reviewer 提出的原始方案进行了调整和优化，形成本最终裁决方案。

---

## 二、核心调整说明

| 项目 | Reviewer 原方案 | Builder 评估 | 最终裁决 |
|------|----------------|-------------|---------|
| **累加器截断** | 截到 1 个步长 | ⚠️ 仍会丢 90ms | **截到 50ms，保留 backlog** |
| **MAX_SUBSTEPS** | 5 -> 10 | ⚠️ 先试 8 | **采纳 8** |
| **COLLISION_ITERATIONS** | 4 -> 8 | ⚠️ 先试 6 | **采纳 6** |
| **POSITION_CORRECTION** | 0.82 -> 0.6 | ⚠️ 可能偏软 | **采纳 0.68** |
| **冲量迭代** | 所有轮次参与 | ⚠️ 需验证 | **暂缓，独立验证** |
| **纠偏阈值** | 28px -> 7px | ⚠️ 过严 | **采纳 14px** |
| **Gram-Schmidt** | P0 | ⚠️ 优先级过高 | **降级为 P1** |
| **Snapshot Interpolation** | P1 | ❌ 性价比低 | **不实施** |

---

## 三、最终执行方案

### Phase 1：物理层修复（P0）

#### 1.1 累加器修复
**文件**：`daily-billiards-vanilla_web/src/core/physics.js`

**修改点 1**（L41）：
```javascript
// 修改前
game.physicsAccumulatorMs += Math.min(frameMs, FIXED_TIMESTEP_MS * MAX_SUBSTEPS)

// 修改后
const MAX_FRAME_MS = 50;
game.physicsAccumulatorMs += Math.min(frameMs, MAX_FRAME_MS);
```

**修改点 2**（L67-69）：
```javascript
// 修改前
if (substeps === MAX_SUBSTEPS && game.physicsAccumulatorMs > FIXED_TIMESTEP_MS) {
  game.physicsAccumulatorMs = 0
}

// 修改后
const MAX_ACCUMULATION = 50;
if (game.physicsAccumulatorMs > MAX_ACCUMULATION) {
  console.warn(`[Physics] High lag: ${game.physicsAccumulatorMs.toFixed(2)}ms. Capping to ${MAX_ACCUMULATION}ms.`);
  game.physicsAccumulatorMs = MAX_ACCUMULATION;
}
```

#### 1.2 参数调优（温和版本）
**文件**：`daily-billiards-vanilla_web/src/core/physics.js`

```javascript
// 修改前
const MAX_SUBSTEPS = 5
const COLLISION_ITERATIONS = 4
const POSITION_CORRECTION = 0.82
const POSITION_SLOP = 0.01

// 修改后（首轮实验）
const MAX_SUBSTEPS = 8              // 5 -> 8
const COLLISION_ITERATIONS = 6      // 4 -> 6
const POSITION_CORRECTION = 0.68    // 0.82 -> 0.68
const POSITION_SLOP = 0.02          // 0.01 -> 0.02
```

---

### Phase 2：渲染层修复（P0）

#### 2.1 指数衰减插值
**文件**：`daily-billiards-vanilla_web/src/entities/ball.js`

**修改前**（L191）：
```javascript
updateRender(smoothFactor = 0.25) {
```

**修改后**：
```javascript
/**
 * 让渲染层状态平滑追赶物理层状态。
 * @param {number} dt - 帧间隔时间（秒）。
 */
updateRender(dt) {
  const k = 18.0;
  const smoothFactor = 1.0 - Math.exp(-k * dt);
  
  if (this.pocketed) {
    this.renderPos.x = this.physicsPos.x;
    this.renderPos.y = this.physicsPos.y;
    this.renderRot.set(this.physicsRot);
    return;
  }

  this.renderPos.x += (this.physicsPos.x - this.renderPos.x) * smoothFactor;
  this.renderPos.y += (this.physicsPos.y - this.renderPos.y) * smoothFactor;

  for (let i = 0; i < 9; i++) {
    this.renderRot[i] += (this.physicsRot[i] - this.renderRot[i]) * smoothFactor;
  }
}
```

**同步修改调用处**：`game.js` 中所有 `ball.updateRender(0.25)` 改为 `ball.updateRender(deltaSeconds)`

---

### Phase 3：同步层修复（P1）

#### 3.1 纠偏阈值收紧（保守版本）
**文件**：`daily-billiards-vanilla_web/src/game.js`

```javascript
// 修改前
const snapThreshold = BALL_RADIUS * 2; // 28px

// 修改后
const snapThreshold = BALL_RADIUS * 1.0; // 14px
```

---

## 四、调试日志方案

**文件**：`daily-billiards-vanilla_web/src/game.js` 和 `physics.js`

```javascript
// 在 game.js 的 update 循环顶部增加 debug 开关
const DEBUG_JITTER = window.location.hash.includes('debug-jitter');

// 在 physics.js 累加器修复处
if (DEBUG_JITTER && game.physicsAccumulatorMs > MAX_ACCUMULATION) {
  console.log(`[JitterLog] Accumulator capped: ${game.physicsAccumulatorMs.toFixed(2)}ms -> ${MAX_ACCUMULATION}ms`);
}

// 在碰撞处理后
if (DEBUG_JITTER) {
  // 统计每轮最大 overlap
  let maxOverlap = 0;
  // ... 计算逻辑
  console.log(`[JitterLog] Collision iteration ${iteration}: maxOverlap=${maxOverlap.toFixed(3)}px`);
}

// 在纠偏发生时
if (DEBUG_JITTER && deviation > 1.0) {
  console.log(`[JitterLog] Ball ${ball.label} corrected by ${deviation.toFixed(2)}px, snap=${shouldSnapRender}`);
}
```

---

## 五、实施顺序

### 第一批（立即实施，1.5-2 天）
1. ✅ 累加器修复（调整版）
2. ✅ 参数调优（温和版）
3. ✅ 指数衰减插值
4. ✅ 调试日志系统

### 第二批（观察效果后，0.5-1 天）
1. ⚠️ 纠偏阈值收紧（保守版）
2. ⚠️ 根据日志数据决定是否继续调整参数

### 第三批（原型验证，1-2 天）
1. 🔬 冲量迭代修复（独立分支验证）

### 第四批（可选优化）
1. 🔧 Gram-Schmidt 正交化
2. 🔧 动态参数调整（开球 vs 普通阶段）

---

## 六、暂缓/不实施项

### 暂缓项（需原型验证）
- **冲量迭代修复**（Phase 1.2）
  - 原因：算法行为变化，风险较高
  - 处理：独立分支验证，不阻塞主线

### 降级项（P0 -> P1）
- **Gram-Schmidt 正交化**（Phase 2.1）
  - 原因：优先级不如位置修复，性能开销持续
  - 处理：等主线完成后再评估

### 不实施项
- **Snapshot Interpolation**（Phase 3.2）
  - 原因：与现有同步架构耦合重，性价比低
  - 处理：不纳入当前修复计划

---

## 七、验证方案

### 测试场景
1. **三球一线对冲**：验证冲量传播
2. **开球球堆散开**：验证密集碰撞收敛
3. **低帧率同步**（CPU 6x Slowdown）：验证累加器修复
4. **网络抖动**（150ms + 50ms Jitter）：验证纠偏阈值

### 成功标准
- 多体碰撞后，主从端球体最终停止位置偏差 < 1.0 像素
- 视觉上球体无明显抖动或拉扯感
- 低帧率下物理模拟时间连续，无跳变
- 调试日志显示累加器不再被错误清零

### 性能基准
- 桌面正常帧：`updateGamePhysics < 1ms`
- 中端移动设备开球高负载：峰值 `< 2-3ms`

---

## 八、风险评估

| 风险项 | 影响 | 缓解措施 |
|--------|------|----------|
| 参数调整导致手感变化 | 中 | 温和调整，逐步验证 |
| 性能开销增加 | 低-中 | 仅在高负载时触发，常态不打满 |
| 回归风险 | 低 | 保留现有测试用例，增加新场景 |

---

## 九、预计工作量

- **第一批**：1.5-2 人天
- **第二批**：0.5-1 人天
- **第三批**（原型验证）：1-2 人天
- **总计**：3-5 人天

---

## 十、待确认事项

### 需 builder 确认：
1. 是否同意最终执行方案？
2. 是否可以立即开始第一批实施？
3. 预计完成时间？

### 需 reviewer 确认：
1. 是否同意对原方案的调整？
2. 是否可以在第一批完成后进行回归测试？
3. 回归测试范围和标准？

---

## 十一、后续流程

### 确认后流程：
1. **builder**：实施第一批修改
2. **reviewer**：准备回归测试用例
3. **lead**：监控进度，协调资源

### 完成标准：
- 所有代码修改完成并通过 code review
- 调试日志验证根因已修复
- 回归测试通过
- 用户验收通过

---

**裁决结论**：本方案在保持技术可行性的同时，充分考虑了风险控制和渐进式实施策略。建议立即启动第一批实施。
