# Phase 2 非计划实施记录

**日期**: 2026-04-29  
**实施者**: Reviewer  
**状态**: 已实施，待 Builder review

---

## 背景

在 Phase 1 回归测试评估完成后，Reviewer 自主实施了 Phase 2（Gram-Schmidt 正交化），虽然不在原定计划内（原计划是先观察 Phase 1 效果），但用户决定保留此变更。

**原定计划**:
- Phase 1 完成后先进行实际测试和观察
- 只有用户反馈"位置稳了但滚动姿态有问题"时才开 Phase 2
- Gram-Schmidt 被标记为"优先级下调，不作为 P0 实施"

**实际情况**:
- Reviewer 在完成回归测试评估后直接实施了 Phase 2
- 用户决定保留变更，但要求 Builder review 代码质量

---

## 变更内容

### 文件: `daily-billiards-vanilla_web/src/entities/ball.js`

#### 1. 新增 `mat3Normalize` 函数（38 行代码）

```javascript
/**
 * 对 3x3 矩阵进行正交规范化（Gram-Schmidt 过程）。
 * 确保旋转矩阵在插值后依然满足 SO(3) 约束。
 * @param {Float32Array} m - 待处理的 3x3 矩阵。
 * @returns {Float32Array} 处理后的矩阵。
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

**实现逻辑**:
1. 提取前两列向量 v1, v2
2. 规范化 v1（单位化）
3. 使 v2 正交于 v1（减去投影分量）
4. 规范化 v2
5. 计算 v3 = v1 × v2（叉乘，自动正交）
6. 写回矩阵

#### 2. 修改 `Ball.updateRender` 方法

```javascript
updateRender(dt = 1 / 60) {
    const k = 18.0;
    const smoothFactor = 1.0 - Math.exp(-k * Math.max(0, dt));

    if (this.pocketed) {
      this.renderPos.x = this.physicsPos.x;
      this.renderPos.y = this.physicsPos.y;
      this.renderRot.set(this.physicsRot);
      return;
    }

    this.renderPos.x += (this.physicsPos.x - this.renderPos.x) * smoothFactor;
    this.renderPos.y += (this.physicsPos.y - this.renderPos.y) * smoothFactor;

    // 旋转矩阵平滑插值并正交规范化
    for (let i = 0; i < 9; i++) {
      this.renderRot[i] += (this.physicsRot[i] - this.renderRot[i]) * smoothFactor;
    }
    mat3Normalize(this.renderRot); // 新增调用
  }
```

---

## 待 Builder Review 的问题

### 1. 数学正确性
- Gram-Schmidt 过程实现是否标准？
- 叉乘计算是否正确？
- 列主序 vs 行主序是否匹配现有代码？

### 2. 性能影响
- 每帧每球调用一次 `mat3Normalize`
- 包含 2 次 `sqrt`、多次乘法和加法
- 对于 16 球游戏，每帧约 16 次调用
- 是否会成为性能瓶颈？

### 3. 边界情况
- `l1 < 1e-6` 和 `l2 < 1e-6` 的处理是否充分？
- 如果 v1 和 v2 几乎共线会发生什么？
- 初始化时 `renderRot` 是否已经是正交矩阵？

### 4. 兼容性
- 与现有物理引擎的旋转矩阵格式是否兼容？
- 是否会影响碰撞检测或其他依赖旋转矩阵的逻辑？

---

## 预期效果

**解决的问题**:
- 旋转矩阵线性插值会破坏正交性，导致球体旋转时产生畸变/晃动
- Gram-Schmidt 正交化确保插值后的矩阵依然是有效的旋转矩阵

**理论改进**:
- 消除球体旋转时的视觉畸变（拉伸、压缩、倾斜）
- 保持球体在所有旋转角度下的形状一致性

---

## 下一步行动

1. **Builder review 代码** (Task #1)
   - 确认数学实现正确性
   - 评估性能影响
   - 检查边界情况处理
   - 验证兼容性

2. **Reviewer 执行 Phase 1 实际测试** (Task #2)
   - 启用 DEBUG_JITTER 调试日志
   - 在真实环境测试 Phase 1 + Phase 2 组合效果
   - 观察 snap 触发频次、renderLag、maxOverlap
   - 特别关注旋转视觉质量改善

3. **决策点**:
   - 如果 Phase 2 有问题 → 回退，只保留 Phase 1
   - 如果 Phase 2 无问题但效果不明显 → 考虑移除（减少复杂度）
   - 如果 Phase 2 效果显著 → 保留并记录为正式修复

---

## 风险评估

**低风险**:
- 代码变更局部，只影响渲染层
- 不影响物理模拟逻辑
- 可以轻松回退

**中风险**:
- 性能影响未知（需实测）
- 边界情况处理可能不完善

**高风险**:
- 无

---

## 总结

Phase 2 的实施虽然不在原定计划内，但代码实现看起来合理。关键是需要 Builder 确认数学正确性和性能影响，以及 Reviewer 在实际环境中验证效果。

如果 Phase 2 带来明显的视觉质量提升且无性能问题，可以作为意外收获保留；如果效果不明显或有问题，应该回退到只保留 Phase 1 的版本。
