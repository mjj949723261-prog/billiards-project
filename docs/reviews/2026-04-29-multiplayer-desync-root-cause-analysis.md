# 多人模式双端位置不一致根因分析

**日期**: 2026-04-29  
**问题**: 双端球的位置会出现不一致的情况  
**分析者**: Builder + Reviewer  

---

## 执行摘要

**核心结论**：当前架构并非为双端严格确定性设计，而是"固定步长 + 本地各跑各的 + 轻量服务端裁决"模式。双端不一致是**架构特性**，不是单一 bug。

**双方共识的 P0 根因**：
1. ✅ **有损累加器机制** - 两端执行不同数量的 substeps
2. ✅ **帧率相关的停球判定** - 不同帧率导致 settled 时机不同
3. ✅ **缺失绝对时钟同步** - 两端在不同物理时间轴上模拟

**分歧点**：
- Builder 更关注"为什么会分叉"（碰撞求解器、阈值判断）
- Reviewer 更关注"如何修复"（无损时间补偿、确定性停球）

---

## 双方分析对比

### 根因 1: 有损累加器机制 ⚠️ **P0 - 双方一致**

#### Builder 视角
**问题 7**: 两端会执行不同数量的 substeps
- 设备 A: `16ms` → 1 substep
- 设备 B: `24ms` → 2 substeps
- Fixed timestep 保证"每步长度固定"，但**不保证步数一致**

**问题 8**: 50ms 截断造成两端丢失不同的真实时间
```javascript
// physics.js:53-57
const cappedFrameMs = Math.min(frameMs, MAX_FRAME_MS); // 50ms
game.physicsAccumulatorMs += cappedFrameMs;

// physics.js:80-86
if (game.physicsAccumulatorMs > MAX_ACCUMULATION) {
  game.physicsAccumulatorMs = MAX_ACCUMULATION; // 丢失时间
}
```

**场景**:
- Client A 遭遇 100ms 卡顿 → 只模拟 50-66ms → **丢失 40ms 物理时间**
- Client B 流畅运行 → 完整模拟 100ms
- 结果：Client A 的球体行程短于 Client B

#### Reviewer 视角
**有损的累加器机制 (Lossy Accumulator)** - 高可能性
- **输入截断**: `Math.min(frameMs, MAX_FRAME_MS)` (50ms)
- **步数截断**: `substeps < MAX_SUBSTEPS` (8步，即 66.6ms)
- **上限截断**: `MAX_ACCUMULATION = 50ms`

**影响**: 直接导致球体行程不同，最终停球位置必然不一致

#### 共识
✅ 这是 **P0 根因**，必须修复

---

### 根因 2: 帧率相关的停球判定 ⚠️ **P0 - 双方一致**

#### Builder 视角
**问题 5**: settled/authoritative 是终局收敛，不是过程收敛
- 当前是"本地先各跑各的，停球后再交 finalBallState / stateHash"
- 用户看到的不一致发生在**运动过程中**，甚至停球前后一小段时间

#### Reviewer 视角
**帧率相关的停球判定 (Frame-rate Dependent Settling)**
```javascript
// game.js update 循环
if (game.wasMoving && !game.isMoving() && !game.isGameOver) {
  game.evaluateShot() // 在渲染帧触发，不是物理步
}
```

**问题**: `isMoving()` 检查在**渲染帧**触发
- Client A (60fps): 每 16.6ms 检查一次
- Client B (144fps): 每 6.9ms 检查一次
- Client B 更早检测到"速度低于阈值"，捕获到的快照位置不同

#### 共识
✅ 这是 **P0 根因**，`isMoving()` 判定必须移入物理步内部

---

### 根因 3: 碰撞求解器不是严格收敛解 ⚠️ **P1 - Builder 强调**

#### Builder 视角
**问题 3**: 只首轮冲量、后续只解位置
```javascript
// physics.js:295-301
for (let iteration = 0; iteration < COLLISION_ITERATIONS; iteration++) {
  // 只在 iteration === 0 时计算冲量
  // 后续轮次只做位置修正，不传递速度约束
}
```

**问题 9**: 离散检测 + 位置修正，不是连续碰撞
- "先推进位置，再看是否重叠，再回推"
- 不同端只要一步推进后重叠量差一点，后续 correction 就会不同

**问题 10**: 只做 6 轮迭代
- 后续轮次更多是"把球分开"，不是让速度场继续一致收敛
- 球堆散开的最终轨迹对前面初始误差非常敏感

#### Reviewer 视角
**碰撞迭代的非确定性风险**
- `handleBallCollisions` 中的迭代顺序依赖于 `activeBalls` 数组
- 如果两端球体进入 `active` 数组的顺序不同，碰撞求解顺序就会改变
- 在密集碰撞中，求解顺序的改变会导致完全不同的位移结果

#### 分歧
- Builder: 强调求解器本身不够强（只首轮冲量）
- Reviewer: 强调迭代顺序的非确定性风险
- **优先级**: Builder 认为是 P2，Reviewer 认为是 P1

---

### 根因 4: 缺失绝对时钟同步 ⚠️ **P0 - Reviewer 强调**

#### Builder 视角
**问题 12**: shotId / startedAt / Date.now() 不是球路根因
- 这些不会直接改变物理推进
- 但会影响 settled 对账、超时、状态切换、日志时序

**问题 13**: 真正的随机种子并没有用于统一物理
- `createShotStartData()` 里有 `randomSeed: null`
- 当前没有"同一输入+同一seed"这套强确定性机制

#### Reviewer 视角
**缺失的绝对时钟同步**
- `applyShotStart` 仅同步了初始位置和力度，但没有同步"物理起始步"
- 两端根据收到网络消息的瞬间开始累加物理时间
- 由于网络抖动，两端实际上是在**不同的物理时间轴**上进行模拟
- 没有中间态的强制对账

#### 共识
✅ 这是 **P0 根因**，需要同步物理起始步或总步数

---

### 根因 5: 其他因素

#### Builder 提出
**问题 11**: rail/pocket 邻域判断也是分叉点
- `isNearPocket`、库边条件判断、`Vec2.distance < POCKET_RADIUS` 都是阈值判断
- "临界值一边进、一边不进"的情况，容易导致双端某颗球一个入袋、另一个擦边

**问题 6**: 状态量化会让终局一致性是"近似一致"
- `BALL_STATE_PRECISION = 100`，位置和速度都量化到 0.01
- 足够做业务对账，但不等于两端原始物理轨迹严格一致

#### Reviewer 提出
**状态哈希容差** (P1)
- 在 `shot-state.js` 中增加位置容差
- 或者在 `settled` 对账时，以击球方 (Shooter) 的最终位置为准，强制覆盖观察方 (Witness)

---

## 根因优先级排序

### Builder 排序
1. **P0**: 两端执行的 substeps 数不同（累加器截断）
2. **P0**: 多球碰撞求解器不是严格收敛解
3. **P1**: 离散碰撞 + 阈值判断在 pocket/rail 邻域分叉
4. **P1**: 运动期不再做过程收敛，只靠 settled/authoritative 终局收敛
5. **P2**: 量化和时间戳造成的边界差异

### Reviewer 排序
1. **P0**: 无损时间补偿（累加器不能简单截断）
2. **P0**: 确定性停球（`isMoving()` 移入物理步内部）
3. **P1**: 状态哈希容差（以 Shooter 为准强制覆盖）

### 综合优先级（Lead 裁决）
1. **P0 - 立即修复**:
   - ✅ 有损累加器机制
   - ✅ 帧率相关的停球判定
   - ✅ 缺失绝对时钟同步

2. **P1 - 短期修复**:
   - 碰撞求解器改进（迭代顺序确定性 + 多轮冲量）
   - 状态哈希容差（以 Shooter 为准）

3. **P2 - 长期优化**:
   - 阈值判断的边界情况处理
   - 量化精度提升

---

## 修复方案建议

### Phase 1: P0 修复（立即执行）

#### 1.1 无损时间补偿
**目标**: 确保两端执行相同数量的物理步

**方案 A - 服务端广播总步数** (推荐)
```javascript
// 服务端在 applyShotStart 时计算并广播
shotStartData.totalPhysicsSteps = Math.floor(expectedDuration / PHYSICS_TIMESTEP_MS);

// 客户端严格执行指定步数
while (game.currentPhysicsStep < shotStartData.totalPhysicsSteps) {
  stepPhysics(PHYSICS_TIMESTEP_MS);
  game.currentPhysicsStep++;
}
```

**方案 B - 记录欠下的时间**
```javascript
// physics.js
if (game.physicsAccumulatorMs > MAX_ACCUMULATION) {
  game.physicsDebtMs += (game.physicsAccumulatorMs - MAX_ACCUMULATION);
  game.physicsAccumulatorMs = MAX_ACCUMULATION;
}

// 在后续帧中补齐
if (game.physicsDebtMs > 0 && frameMs < MAX_FRAME_MS) {
  const repayAmount = Math.min(game.physicsDebtMs, MAX_FRAME_MS - frameMs);
  game.physicsAccumulatorMs += repayAmount;
  game.physicsDebtMs -= repayAmount;
}
```

**Builder 评估**: 方案 A 更简单可靠，方案 B 可能导致补偿时机不同  
**Reviewer 评估**: 待确认

---

#### 1.2 确定性停球判定
**目标**: `isMoving()` 判定与渲染帧率无关

**方案**:
```javascript
// physics.js - 在物理步内部检查
function stepPhysics(dt) {
  // ... 现有物理推进 ...
  
  // 在物理步结束时检查停球
  const wasMoving = game.isMoving();
  updateBallMotionState(); // 更新速度状态
  const isMovingNow = game.isMoving();
  
  if (wasMoving && !isMovingNow) {
    game.onPhysicsSettled(); // 触发 settled 事件
  }
}

// game.js - 只响应物理层事件
game.onPhysicsSettled = function() {
  if (!this.isGameOver) {
    this.evaluateShot();
  }
};
```

**Builder 评估**: 正确方向，需要确保 `isMoving()` 的阈值判断也是确定性的  
**Reviewer 评估**: 待确认

---

#### 1.3 绝对时钟同步
**目标**: 两端在相同的物理时间轴上模拟

**方案**:
```javascript
// 服务端在 applyShotStart 时广播物理起始时间戳
shotStartData.physicsStartTimestamp = Date.now();

// 客户端收到后，基于服务端时间戳计算本地物理时间
const serverElapsed = Date.now() - shotStartData.physicsStartTimestamp;
const localElapsed = performance.now() - localStartTime;
const timeDrift = serverElapsed - localElapsed;

// 如果时间漂移超过阈值，调整累加器
if (Math.abs(timeDrift) > 50) {
  game.physicsAccumulatorMs += timeDrift;
}
```

**Builder 评估**: 需要考虑网络延迟，可能需要 NTP 式的时钟同步  
**Reviewer 评估**: 待确认

---

### Phase 2: P1 修复（短期执行）

#### 2.1 碰撞求解器改进
**目标**: 提高多球碰撞的收敛性和确定性

**方案**:
1. 确保 `activeBalls` 数组的迭代顺序确定（按 ID 排序）
2. 在所有迭代轮次中都计算冲量，不只是第 0 轮
3. 增加迭代次数到 8-10 轮

**Builder 评估**: 需要性能测试，可能影响帧率  
**Reviewer 评估**: 待确认

---

#### 2.2 状态哈希容差
**目标**: 减少因微小浮点误差导致的 hash 不匹配

**方案**:
```javascript
// shot-state.js
function compareBallStates(state1, state2, tolerance = 0.5) {
  const dx = Math.abs(state1.x - state2.x);
  const dy = Math.abs(state1.y - state2.y);
  return dx < tolerance && dy < tolerance;
}

// game.js - settled 对账时
if (!statesMatch && isShooter) {
  // 击球方强制覆盖观察方
  broadcastAuthoritativeState(localState);
} else if (!statesMatch && !isShooter) {
  // 观察方接受击球方的状态
  applyAuthoritativeState(remoteState);
}
```

**Builder 评估**: 治标不治本，但可以减少用户可见的不一致  
**Reviewer 评估**: 待确认

---

## 验证方案

### 日志增强
**Builder 建议**:
1. 在 `physics.js` 记录每杆：
   - 总 substeps 数
   - 每帧 substeps 分布
   - 是否触发 accumulator cap
   - 累计丢失的物理时间

2. 在 settled 前后记录：
   - 本地 `finalStateHash`
   - 服务端 authoritative `stateHash`
   - 首次出现差异的球 `id/x/y/vx/vy`

### 测试场景
1. **单端稳定性测试**: 同一设备重复击球 10 次，验证轨迹一致性
2. **双端同步测试**: 两个相同设备同时击球，对比最终位置
3. **异构设备测试**: 60fps vs 144fps 设备对战，观察 settled 时机差异
4. **网络抖动测试**: 模拟 100-200ms 延迟和丢包，观察时钟漂移

---

## 架构反思

### 当前架构的本质
**Builder 总结**:
> 当前实现并不是为双端严格确定性设计的。它是"固定步长 + 本地各跑各的 + 轻量服务端裁决"的架构。在这个架构下：
> - 单端稳定性可以很好
> - 拉扯可以明显减少
> - 但"双端运动过程完全一致"本来就不是强保证

### 长期方向
如果要实现严格的双端一致性，需要考虑：
1. **Lockstep 模式**: 所有客户端同步执行相同的物理步数
2. **Rollback Netcode**: 客户端预测 + 服务端回滚纠正
3. **服务端权威**: 物理模拟完全在服务端执行，客户端只做渲染

**当前方案**: 先修复 P0 问题，观察效果后再决定是否需要架构级改造

---

## 下一步行动

1. **Builder**: 实施 Phase 1.1（无损时间补偿）方案 A
2. **Reviewer**: 实施 Phase 1.2（确定性停球判定）
3. **Lead**: 协调双方，确保修改不冲突
4. **All**: 增强日志，准备验证测试

**预计工期**: Phase 1 约 2-3 人天

---

## 总结

双端位置不一致是**架构特性**，不是单一 bug。当前修复方案聚焦于：
1. 确保两端执行相同数量的物理步（无损时间补偿）
2. 确保停球判定与帧率无关（确定性停球）
3. 同步物理时间轴（绝对时钟同步）

这些修复可以显著减少不一致，但无法完全消除（除非改为 lockstep 或服务端权威架构）。
