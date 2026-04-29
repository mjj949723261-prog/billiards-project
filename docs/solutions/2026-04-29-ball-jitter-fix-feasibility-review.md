## Phase 1 可行性评估

### 1.1 累加器修改
- 可行性：⚠️ 需调整
- 实现难度：低
- 风险评估：
  - 方向是对的，当前实现里真正危险的是 [daily-billiards-vanilla_web/src/core/physics.js](/Users/majunjie/billiards-project/daily-billiards-vanilla_web/src/core/physics.js:41) 的预截断和 [daily-billiards-vanilla_web/src/core/physics.js](/Users/majunjie/billiards-project/daily-billiards-vanilla_web/src/core/physics.js:68) 的清零会直接丢物理时间。
  - reviewer 提议的“超过 100ms 就截断到 1 个步长”虽然比直接清零好，但仍然会一次性丢掉 90ms 左右 backlog，问题只是从“硬清零”变成“较大幅度截断”。
  - 如果页面长期卡死，累加器确实可能增长，但这个问题不应靠“清到 1 个步长”解决，而应靠“限制最大 backlog，但保留有限余量”解决。
- 建议调整：
  - 不建议“截断到 `FIXED_TIMESTEP_MS`”。
  - 建议改成两段式：
    - 保留 `while (accumulator >= step && substeps < MAX_SUBSTEPS)` 的上限保护。
    - 在循环后如果 `accumulator > MAX_ACCUMULATION`，截断到 `MAX_ACCUMULATION` 或 `2 * FIXED_TIMESTEP_MS`，不要截断到 1 个步长。
  - `MAX_ACCUMULATION = 100ms` 可以作为初值，但更稳妥的是 `50ms ~ 80ms` 起步。100ms 对移动端恢复期较宽松，但也会放大“慢动作追帧”的时间窗口。
  - 更好的策略是：
    - `accumulator += Math.min(frameMs, MAX_FRAME_MS)`，例如 `MAX_FRAME_MS = 50ms`
    - 循环后仅对残余 backlog 做上限压缩，不做彻底清空
  - 推荐结论：可做，但方案中的“保留一个步长余量”应改成“保留有限 backlog 余量”。

### 1.2 冲量迭代修改
- 可行性：⚠️ 需调整
- 实现难度：中
- 风险评估：
  - 当前实现只在首轮打冲量、后续只做位置修正，确实容易导致多球链式碰撞传播不充分。
  - 但“所有迭代都继续打冲量”属于算法行为变化，不是单纯参数调优。处理不好会出现两类风险：
    - 能量被重复注入，球堆比现在更弹
    - 局部振荡增强，表现成比原来更明显的“弹开又吸回”
  - `BALL_BOUNCE * 0.5` 只是经验系数，没有稳定性保证，不能直接当最终值。
- 建议调整：
  - 这项不建议直接按方案上线，建议先做原型验证。
  - 更稳妥的实现路径有两个：
    - 路径 A：保留“首轮冲量 + 多轮位置修正”，先把 `COLLISION_ITERATIONS`、`POSITION_CORRECTION`、`POSITION_SLOP` 调好。
    - 路径 B：只在前 2 轮做冲量，不是 8 轮全做；并且后续轮次使用更小 restitution，例如 `BALL_BOUNCE * 0.2 ~ 0.35`，而不是 0.5 起步。
  - 如果要继续这条路，最好增加收敛保护：
    - 当 `Math.abs(separation)` 小于阈值时跳过附加冲量
    - 或统计每轮最大 overlap，若已明显收敛则提前结束
  - 推荐结论：技术上可行，但不能按当前文档直接落地，必须先做原型验证。

### 1.3 参数调优
- 可行性：✅ 可行
- 实现难度：低
- 风险评估：
  - 这是 Phase 1 里最适合先落地的一组改动。
  - CPU 开销主要来自 `MAX_SUBSTEPS` 和 `COLLISION_ITERATIONS`，最坏情况大约接近当前上限的 4 倍：
    - 当前最坏：`5 * 4 = 20` 个“子步-碰撞轮”
    - 提案最坏：`10 * 8 = 80` 个“子步-碰撞轮”
  - 但最坏情况只发生在极端掉帧和高接触同时出现时，常态不会一直打满。
  - 真正风险不只是 CPU，还包括手感变化：修正过软可能产生可见穿透，修正过硬仍会抖。
- 建议调整：
  - `MAX_SUBSTEPS: 5 -> 10`
    - 可行，但不建议和所有其他参数一起一次性上满。
    - 建议先到 `8`，除非日志证明 `5` 经常打满。
  - `COLLISION_ITERATIONS: 4 -> 8`
    - 可行，建议优先试 `6`，观察残余 overlap，再决定是否到 `8`。
  - `POSITION_CORRECTION: 0.82 -> 0.6`
    - 方向正确，但 0.6 可能偏软，建议先试 `0.65 ~ 0.7`。
  - `POSITION_SLOP: 0.01 -> 0.02`
    - 合理，可以先试；如果仍有高频微抖，可继续试到 `0.03`。
  - 是否动态调整：
    - 建议。优先只在“开球后前若干帧 / 高速多接触阶段”使用更高迭代，普通阶段保持较低成本。
  - 更优参数组合建议：
    - 首轮实验：`MAX_SUBSTEPS=8`、`COLLISION_ITERATIONS=6`、`POSITION_CORRECTION=0.68`、`POSITION_SLOP=0.02`
    - 第二轮再看是否需要继续加到 `10/8`

## Phase 2 可行性评估

### 2.1 Gram-Schmidt 正交化
- 可行性：⚠️ 需调整
- 实现难度：中
- 风险评估：
  - 数学方向是合理的，线性插值矩阵分量确实会破坏正交性。
  - 但“每帧每球都做 Gram-Schmidt”在当前问题里不是主收益点。当前用户感知到的“拉扯”首先是位置层面，不是旋转层面。
  - 性能上单次 3x3 正交化不大，但按“每帧 * 每球”长期执行属于持续开销，且收益主要体现在滚动旋转视觉质量，不是击球轨迹稳定性。
- 建议调整：
  - 技术上可做，但不建议放在 P0 主线。
  - 如果要做，建议只在以下情况触发：
    - `renderRot` 与 `physicsRot` 差异超过阈值
    - 或每 N 帧做一次，而不是每帧每球
  - 更高效的实现是：
    - 位置先修复
    - 旋转正交化作为 Phase 2 补充优化
  - 推荐结论：不是不可行，而是优先级应下调。

### 2.2 指数衰减插值
- 可行性：✅ 可行
- 实现难度：低
- 风险评估：
  - 这是正确方向。当前 [daily-billiards-vanilla_web/src/entities/ball.js](/Users/majunjie/billiards-project/daily-billiards-vanilla_web/src/entities/ball.js:191) 和 [daily-billiards-vanilla_web/src/game.js](/Users/majunjie/billiards-project/daily-billiards-vanilla_web/src/game.js:829) 使用固定 `0.25`，天然是帧率相关的。
  - `Math.exp` 的性能成本很低，相比碰撞检测可以忽略。
  - 风险主要是参数感受：`k` 太大会变成接近 snap，太小又会拖影。
- 建议调整：
  - `k = 18.0` 可以作为起点，技术上合理。
  - 但不建议写死成唯一值。更稳妥的是：
    - 常态 `k = 14 ~ 18`
    - authoritative/settled 后短时提高到 `18 ~ 24`
  - 如果想保持简单，先统一用 `18` 没问题。
  - 前提是 `updateRender` 需要改签名，传入真实 `dt`，不能继续从 `game.update()` 里硬传 `0.25` 语义。

## Phase 3 可行性评估

### 3.1 纠偏阈值收紧
- 可行性：⚠️ 需调整
- 实现难度：低
- 风险评估：
  - 当前阈值 `BALL_RADIUS * 2` 确实偏宽，[daily-billiards-vanilla_web/src/game.js](/Users/majunjie/billiards-project/daily-billiards-vanilla_web/src/game.js:536) 会允许较大的视觉偏差累积后再 snap。
  - 但直接收紧到 `BALL_RADIUS * 0.5`，也就是 7px，风险是太严格，可能在普通碰撞和网络对账里更频繁触发 snap。
  - 现有方案里提到“速度补偿”，但实际上没有显式机制，只是寄希望于后续 `updateRender`。这不算真正的速度补偿。
- 建议调整：
  - 不建议一步到 7px。
  - 建议先试 `BALL_RADIUS * 1.0` 或 `0.75`，观察 snap 频率。
  - 若要做速度补偿，需要显式设计：
    - 调整 `renderPos` 追赶速度
    - 或单独维护 `renderVel`
  - 推荐结论：可做，但阈值要保守一点，且“速度补偿”不能只写注释。

### 3.2 Snapshot Interpolation
- 可行性：⚠️ 需调整
- 实现难度：高
- 风险评估：
  - 数据结构本身简单，队列开销也不大。
  - 真正难点是与现有同步架构的集成：
    - 当前架构已经明确切掉运动期整桌 live 回写
    - 非击球方现在主要依赖 settled/authoritative，而不是稳定连续的高频快照流
  - 如果没有稳定且带时间戳的运动期快照源，单独引入 200ms 队列并不能自然发挥作用。
  - 100ms 延迟对观战端通常可接受，但对“对手实时观看出杆结果”的感知会有轻微滞后。
- 建议调整：
  - 不建议作为当前 P1 优先级。
  - 只有在确认“现有 authoritative/settled 之外，仍需要对非击球方展示连续运动过程”，并且同步源能够提供可靠时间序列时，才值得做。
  - 在当前架构下，更优先的是：
    - 先把本地物理和 render 追赶修好
    - 再决定是否需要额外运动期插值层
  - 推荐结论：技术上可行，但和当前同步模式耦合较重，不建议先上。

## 调试日志方案

- 可行性：✅ 可行
- 风险评估：
  - URL Hash 开关是合适的，侵入低，适合浏览器内快速复现。
  - 但仅用 `console.log` 两三条信息还不够，后续分析会不成体系。
- 建议调整：
  - 保留 `#debug-jitter` 或 `#physics-debug` 开关。
  - 日志格式建议结构化，至少统一字段：
    - `frameMs`
    - `substeps`
    - `accumulatorBefore/After`
    - `lostBacklogMs`
    - `collisionPairs`
    - `maxOverlap`
    - `snapCount`
    - `maxRenderLag`
  - 纠偏日志建议按帧聚合，不要每球逐条狂刷，避免日志本身干扰分析。
  - 推荐增加一个 `window.__jitterStats` 聚合对象，便于每秒输出一次汇总。

## 验证方案

- 可行性：⚠️ 需调整
- 风险评估：
  - 当前两个场景有价值，但覆盖不够完整。
  - “三球一线对冲”更偏冲量传播验证，不能完全代表开球堆散。
  - `0.5ms` 物理更新预算过于理想化，尤其是在移动端、开球高接触、8 轮迭代条件下，不适合作为硬门槛。
- 建议调整：
  - 增加测试场景：
    - 开球球堆散开
    - 五球紧密簇团中间受撞
    - 低帧率 + 高频碰撞
    - authoritative settled 到达后的视觉纠偏
  - 建议增加自动化测试：
    - 单元测试：累加器 backlog 不被错误清零
    - 单元测试：碰撞迭代后 overlap 单调下降或不恶化
    - 集成测试：`applyGameStateSnapshot` 的 snap 次数/阈值行为
  - 性能基准建议改成区间目标：
    - 桌面正常帧：`updateGamePhysics < 1ms`
    - 中端移动设备开球高负载：峰值尽量 `< 2~3ms`
  - 比“绝对 0.5ms”更现实，也更利于裁决。

## 总体建议

- 推荐实施顺序：
  1. Phase 1.1 累加器修正，但改成“有限 backlog 保留”，不要“截到 1 个步长”。
  2. Phase 1.3 参数调优，先做温和版本，并优先考虑只在高接触阶段增强。
  3. Phase 2.2 指数衰减插值，修复 render 追赶的帧率依赖。
  4. Phase 3.1 纠偏阈值适度收紧，但不要一次压到 7px。
  5. Phase 1.2 冲量多轮迭代，先做原型验证，再决定是否进入主线。
  6. Phase 2.1 Gram-Schmidt 和 Phase 3.2 Snapshot Interpolation 放到后面。

- 高风险项：
  - 冲量参与所有迭代
  - 直接把 snap 阈值收紧到 7px
  - 在当前同步架构下强行上 Snapshot Interpolation

- 需要原型验证的项：
  - 多轮冲量迭代的 restitution 衰减策略
  - 大幅提高 `MAX_SUBSTEPS` 和 `COLLISION_ITERATIONS` 后的移动端峰值性能
  - 更严格纠偏阈值下的 snap 频率

- 是否有技术上不可行的方案：
  - 没有绝对不可行项。
  - 但“Snapshot Interpolation 作为当前 P1 主线”在现有架构下性价比很低，不建议这么排优先级。

- 是否有更优替代方案：
  - 有。
  - 对当前问题更优的主线不是“再加一层运动期插值”，而是：
    - 修正累加器丢时
    - 温和提升碰撞收敛
    - 改善 render 追赶的时间相关性
  - 这三项更小、更集中，也更符合“不能破坏固定步长引擎、不能显著增加性能开销”的约束。

- 实施顺序建议：
  - 先物理时间连续性，再碰撞参数，再渲染追赶，再考虑同步纠偏。
  - 不建议同步层方案先行。

- 预计实施工作量：
  - 累加器修正 + 参数调优 + 指数衰减插值 + 日志与基础测试：`1.5 ~ 2.5` 人天
  - 冲量多轮迭代原型验证：`0.5 ~ 1.5` 人天
  - Snapshot Interpolation 完整接入：额外 `2 ~ 4` 人天
