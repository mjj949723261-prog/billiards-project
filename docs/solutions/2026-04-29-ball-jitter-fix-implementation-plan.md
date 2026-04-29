# 击球拉扯 (Ball Jitter/Pulling) 问题修复实施方案

**日期**：2026-04-29
**版本**：1.0
**状态**：待评审

## 1. Phase 1：物理层修复方案（P0）

### 1.1 累加器时间丢失修复
- **目标文件**：`daily-billiards-vanilla_web/src/core/physics.js`
- **修改原理**：删除硬性清零逻辑。通过在增加时间时使用 `Math.min` 已能防止“螺旋卡死”，保留剩余的 `physicsAccumulatorMs` 可以保证物理模拟的时间连续性，消除因模拟丢失导致的位移跳变。

**修改前 (L67-69)：**
```javascript
  if (substeps === MAX_SUBSTEPS && game.physicsAccumulatorMs > FIXED_TIMESTEP_MS) {
    game.physicsAccumulatorMs = 0
  }
```

**修改后：**
```javascript
  // 仅在累加器由于极端掉帧积累了超过 100ms 的延迟时，才进行截断以防止长期卡死，
  // 但即便截断也要保留一个步长的余量，而不是直接清零。
  const MAX_ACCUMULATION = 100;
  if (game.physicsAccumulatorMs > MAX_ACCUMULATION) {
    console.warn(`[Physics] High lag detected: ${game.physicsAccumulatorMs.toFixed(2)}ms. Capping accumulator.`);
    game.physicsAccumulatorMs = FIXED_TIMESTEP_MS; 
  }
```

---

### 1.2 碰撞冲量迭代修复
- **目标文件**：`daily-billiards-vanilla_web/src/core/physics.js`
- **修改原理**：允许冲量计算在每次迭代中进行。这使得多体碰撞（如开球时一球撞击球堆）的动量能够通过迭代在球体间正确传递。

**修改前 (L261-262)：**
```javascript
        // 仅在第一轮处理速度冲量，后续迭代专注收敛重叠。
        if (iteration > 0) continue
```

**修改后：**
```javascript
        // 移除限制，允许冲量参与迭代。
        // 为了防止过快反弹导致的振荡，可以在后续迭代中应用较小的弹性系数。
        const restitution = (iteration === 0) ? BALL_BOUNCE : BALL_BOUNCE * 0.5;
        const impulse = -(1 + restitution) * separation / 2;
```

---

### 1.3 参数调优
- **`MAX_SUBSTEPS`**：5 -> **10**
    - **理由**：5 步在 120Hz 下仅支持 41.6ms 的帧耗时，现代移动端掉帧时常超过此值。10 步可支持 83.3ms，显著提升卡顿后的恢复平滑度。
- **`COLLISION_ITERATIONS`**：4 -> **8**
    - **理由**：配合冲量迭代，更多的迭代轮数能让紧密排列的球体位置和速度更精确地收敛。
- **`POSITION_CORRECTION`**：0.82 -> **0.6**
    - **理由**：配合更多迭代轮数，降低单次修正权重可以减少高频振荡（Jitter）。
- **`POSITION_SLOP`**：0.01 -> **0.02**
    - **理由**：微量增加容差，减少在微小重叠时的频繁位置抖动。

---

## 2. Phase 2：渲染层修复方案（P0）

### 2.1 旋转矩阵插值修复
- **目标文件**：`daily-billiards-vanilla_web/src/entities/ball.js`
- **修改原理**：线性插值矩阵分量会破坏旋转矩阵的正交性。推荐使用 **方案 B：矩阵 Gram-Schmidt 正交化**。该方案无需引入四元数库，且计算开销极低。

**修改后 (新增工具函数)：**
```javascript
/**
 * 对 3x3 矩阵进行正交规范化（Gram-Schmidt 过程）。
 * 确保旋转矩阵在插值后依然满足 SO(3) 约束。
 */
function mat3Normalize(m) {
    // 列向量 v1, v2, v3
    let v1 = {x: m[0], y: m[1], z: m[2]};
    let v2 = {x: m[3], y: m[4], z: m[5]};
    
    // Normalize v1
    let l1 = Math.sqrt(v1.x*v1.x + v1.y*v1.y + v1.z*v1.z);
    if (l1 < 1e-6) return m; // 防止除零
    v1.x /= l1; v1.y /= l1; v1.z /= l1;
    
    // Make v2 orthogonal to v1
    let dot12 = v1.x*v2.x + v1.y*v2.y + v1.z*v2.z;
    v2.x -= dot12 * v1.x; v2.y -= dot12 * v1.y; v2.z -= dot12 * v1.z;
    
    // Normalize v2
    let l2 = Math.sqrt(v2.x*v2.x + v2.y*v2.y + v2.z*v2.z);
    if (l2 < 1e-6) return m;
    v2.x /= l2; v2.y /= l2; v2.z /= l2;
    
    // v3 = v1 x v2
    let v3 = {
        x: v1.y * v2.z - v1.z * v2.y,
        y: v1.z * v2.x - v1.x * v2.z,
        z: v1.x * v2.y - v1.y * v2.x
    };
    
    m[0] = v1.x; m[1] = v1.y; m[2] = v1.z;
    m[3] = v2.x; m[4] = v2.y; m[5] = v2.z;
    m[6] = v3.x; m[7] = v3.y; m[8] = v3.z;
    return m;
}
```

**修改后 (updateRender 逻辑)：**
```javascript
    // 旋转矩阵平滑插值并正交化
    for (let i = 0; i < 9; i++) {
      this.renderRot[i] += (this.physicsRot[i] - this.renderRot[i]) * smoothFactor;
    }
    mat3Normalize(this.renderRot);
```

---

### 2.2 时间相关插值 (Framerate Independence)
- **修改原理**：将固定权重改为基于 `dt` 的指数衰减函数。
- **推荐常数**：`k = 18.0`（在 60Hz 下等效于约 0.25 的平滑系数）。

**修改前 (ball.js L191)：**
```javascript
  updateRender(smoothFactor = 0.25) {
```

**修改后：**
```javascript
  /**
   * 让渲染层状态平滑追赶物理层状态。
   * @param {number} dt - 帧间隔时间（秒）。
   */
  updateRender(dt) {
    const k = 18.0;
    const smoothFactor = 1.0 - Math.exp(-k * dt);
    
    if (this.pocketed) {
      // ... 原有逻辑
      return;
    }

    this.renderPos.x += (this.physicsPos.x - this.renderPos.x) * smoothFactor;
    this.renderPos.y += (this.physicsPos.y - this.renderPos.y) * smoothFactor;

    for (let i = 0; i < 9; i++) {
      this.renderRot[i] += (this.physicsRot[i] - this.renderRot[i]) * smoothFactor;
    }
    mat3Normalize(this.renderRot);
  }
```

---

## 3. Phase 3：同步层修复方案（P1）

### 3.1 纠偏阈值收紧与速度补偿
- **目标文件**：`daily-billiards-vanilla_web/src/game.js`
- **修改原理**：将 Snap 阈值从 28px 收紧至 7px。当偏差在阈值内时，不仅插值位置，还尝试补偿速度以实现更自然的追赶。

**修改后 (L429 附近)：**
```javascript
    const deviation = Math.hypot(physicsPos.x - renderPos.x, physicsPos.y - renderPos.y);
    const snapThreshold = BALL_RADIUS * 0.5; // 7 像素
    const shouldSnapRender = isPlacementLiveSync || wasPocketed !== ball.pocketed || deviation > snapThreshold;

    if (shouldSnapRender) {
      ball.syncPhysicsToRender();
    } else if (deviation > 0.1) {
      // 速度补偿：如果物理位置超前，暂时调大渲染平滑系数
      // 这不需要直接修改逻辑，只需依赖接下来 updateRender 中的指数衰减追赶
    }
```

---

### 3.2 运动期快照插值 (Snapshot Interpolation)
- **要求输出**：在非击球方客户端应用延迟渲染逻辑。

**设计方案**：
1.  **数据结构**：
    ```javascript
    game.snapshotQueue = []; // 存储 { timestamp, balls: [] }
    ```
2.  **核心算法**：
    - 渲染时刻：`renderTime = currentTime - 100ms`。
    - 在队列中寻找满足 `snapA.ts <= renderTime <= snapB.ts` 的两个快照。
    - 计算 `alpha = (renderTime - snapA.ts) / (snapB.ts - snapA.ts)`。
    - 在 A 和 B 之间插值球体位置。

---

## 4. 调试日志方案

**代码插入：**
```javascript
// 在 game.js 的 update 循环顶部增加 debug 开关
const DEBUG_JITTER = window.location.hash.includes('debug-jitter');

// 在 physics.js 中记录丢失帧
if (DEBUG_JITTER && lostSteps > 0) {
    console.log(`[JitterLog] Frame dropped steps: ${lostSteps}, Accumulator: ${game.physicsAccumulatorMs}ms`);
}

// 在纠偏发生时记录
if (DEBUG_JITTER && deviation > 1.0) {
    console.log(`[JitterLog] Ball ${ball.label} corrected by ${deviation.toFixed(2)}px`);
}
```

---

## 5. 验证方案

### 5.1 集成测试场景
- **场景 A：三球一线对冲**。
    - 操作：将三颗球紧密排成一排，用母球正向撞击。
    - 观察点：动量是否能穿过中间球传递到最远端的球，中间球是否发生剧烈位置抖动。
- **场景 B：低帧率同步**。
    - 环境：使用 Chrome DevTools 限制 CPU 为 6x Slowdown。
    - 观察点：远程球体在卡顿后是否出现长距离“拉扯”，还是平滑收敛。

### 5.2 性能基准测试
- **测试方法**：在控制台运行 `performance.now()` 测量 `updateGamePhysics` 包含 8 轮迭代后的总耗时。
- **合格标准**：单次物理更新耗时（含 8 轮迭代）在移动端设备上应低于 0.5ms。
