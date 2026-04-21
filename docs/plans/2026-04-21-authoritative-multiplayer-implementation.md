# 台球联机权威架构实施计划

日期：2026-04-21

## 范围

把当前“位置流同步”方案，逐步迁移到：

- 固定步长物理
- 出杆输入同步
- 服务端权威结果
- 停球后一次校正

目标是：

- 降低双端抖动
- 保持手机拖杆手感
- 不破坏当前房间和 UI 链路

## 当前代码现状

前端：

- `/Users/majunjie/Desktop/台球/daily-billiards-vanilla_web/src/game.js`
- `/Users/majunjie/Desktop/台球/daily-billiards-vanilla_web/src/core/physics.js`
- `/Users/majunjie/Desktop/台球/daily-billiards-vanilla_web/src/network/game-client.js`

后端：

- `/Users/majunjie/Desktop/台球/billiards-server/src/main/java/com/billiards/game/service/RoomService.java`

当前问题集中在：

- 当前玩家运动中不断 `sendSync(... isLive: true)`
- 服务端每 `100ms` 也广播 `SYNC_STATE`
- 两端同时本地跑物理，再互相纠偏

## 分阶段实施

### 阶段 1：止血版

目标：

- 先把抖动明显压下去
- 不一次性大重构

动作：

1. 停掉服务端运动中的周期性整桌 `SYNC_STATE`
2. 保留业务同步：
   - 入房
   - 开局
   - 换手
   - 犯规
   - 结算
3. 客户端只在停球后发送一次完整状态
4. 运动中的 live sync 先降频，或仅保留给旁观者

验收：

- 双机对打时抖动显著下降
- 回合切换正常
- 停球后两端状态一致

### 阶段 2：固定步长物理

目标：

- 让不同设备性能下的球路尽量一致

动作：

1. 把 `updateGamePhysics(game, dt)` 改成固定时间步长方案
2. 引入：
   - `fixedStep = 1 / 120`
   - `accumulator`
3. 渲染继续走帧刷新
4. 物理只按固定 step 跑
5. 清理 `Date.now()` 直接影响球路的逻辑

重点文件：

- `/Users/majunjie/Desktop/台球/daily-billiards-vanilla_web/src/game.js`
- `/Users/majunjie/Desktop/台球/daily-billiards-vanilla_web/src/core/physics.js`

验收：

- 60Hz / 120Hz 设备球路明显更一致
- 低速滚动、碰库不再因为帧率差异明显分叉

### 阶段 3：引入 `SHOT_START`

目标：

- 改成同步输入，不同步路径

动作：

1. 新增消息类型 `SHOT_START`
2. 发送内容：
   - `roomId`
   - `turnId`
   - `stateVersion`
   - `senderId`
   - `cueBall`
   - `aimAngle`
   - `powerRatio`
   - `shotAt`
   - `seed`
3. 客户端收到后本地推演
4. 停止运动中的整桌坐标同步

重点文件：

- `/Users/majunjie/Desktop/台球/daily-billiards-vanilla_web/src/network/game-client.js`
- `/Users/majunjie/Desktop/台球/billiards-server/src/main/java/com/billiards/game/controller/GameWebSocketController.java`

验收：

- 出杆时只发一条关键消息
- 运动中网络消息量明显下降

### 阶段 4：服务端权威裁决

目标：

- 真正把结果权威收回服务端

动作：

1. 服务端接收 `SHOT_START`
2. 服务端跑同一套固定步长物理
3. 服务端产出：
   - 进球
   - 犯规
   - 换手
   - 球组
   - 得分
   - 结束状态
4. 新增 `SHOT_RESULT`

重点文件：

- `/Users/majunjie/Desktop/台球/billiards-server/src/main/java/com/billiards/game/service/RoomService.java`

验收：

- 客户端不再自己决定最终规则结果
- 服务端能统一裁决黑八、犯规、换手

### 阶段 5：停球收敛

目标：

- 保证最终桌面完全一致

动作：

1. 客户端收到 `SHOT_RESULT`
2. 如果和本地结果接近：
   - 平滑收敛
3. 如果差异明显：
   - 直接跳到权威状态
4. 回合推进、白球在手、结算都以服务端结果为准

验收：

- 球停下后两端桌面完全一致
- 不再需要运动期高频拉位置

### 阶段 6：重连恢复

目标：

- 解决掉线回房

动作：

1. 新增 `ROOM_SNAPSHOT`
2. 重连后拉一次完整快照
3. 恢复：
   - 房间状态
   - 回合
   - 倒计时
   - 球桌
   - 球组
   - 得分

验收：

- 掉线回来不会丢局面
- 不再卡在“入房中”

## 数据结构建议

### 前端房间状态

建议显式保留：

- `roomId`
- `status`
- `turnId`
- `stateVersion`
- `currentTurnPlayerId`
- `ballState`
- `scores`
- `playerGroups`
- `ballInHand`
- `ballInHandZone`

### 服务端权威状态

服务端房间对象建议补齐：

- `turnId`
- `stateVersion`
- `lastShot`
- `lastResolvedAt`

## 风险与注意点

### 1. 不能一步到位硬切

建议按阶段做，先止血，再做固定步长，再改协议。

### 2. 前后端必须共用一套物理常量

至少要统一：

- 球半径
- 袋口半径
- 可运动区
- 库边反弹
- 摩擦系数
- 停止阈值

### 3. 测试必须跟上

至少补：

- 固定步长物理一致性测试
- 同一杆输入下前后端结果一致性测试
- 房间重连恢复测试
- 换手/犯规/黑八结算测试

## 推荐实施顺序

最稳顺序：

1. 先做阶段 1  
2. 再做阶段 2  
3. 再做阶段 3  
4. 再做阶段 4 和阶段 5  
5. 最后做阶段 6

## 最终目标

迁移完成后，联机体验应当变成：

- 本地拖杆顺
- 出杆立即响应
- 球路平稳不抖
- 停球后双方完全一致
- 服务端最终说了算
- 重连可恢复

这就是适合正式上线和大规模使用的台球联机方案。
