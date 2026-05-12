# 台球项目代码审查报告

**审查日期:** 2026-05-12  
**审查范围:** 全栈（Spring Boot 后端 + Vanilla JS 前端）

---

## 一、严重问题（需优先修复）

### 1.1 WebSocket senderId 可伪造

- **文件:** `billiards-server/.../controller/GameWebSocketController.java`
- **描述:** 所有 `@MessageMapping` 处理器直接信任客户端消息中的 `senderId` 字段，未验证其是否与 WebSocket 认证用户一致。任何已连接客户端可以发送任意 `senderId`，冒充其他玩家执行操作。
- **影响:** 玩家可代替对手出杆、触发重赛、篡改游戏状态。
- **修复建议:** 在 STOMP 拦截器中将认证用户 ID 绑定到 session attribute，消息处理时从 session 中获取真实身份，忽略客户端提供的 senderId。

### 1.2 JWT 密钥硬编码

- **文件:** `billiards-server/.../resources/application.yml:29`, `JwtUtils.java:25`
- **描述:** JWT 签名密钥为硬编码字符串 `======================BilliardsSecretKeyMustBeVeryLong======================`，仅在环境变量 `JWT_SECRET` 设置时才会覆盖。
- **影响:** 未配置环境变量时，攻击者可用已知密钥伪造任意用户的 JWT token。
- **修复建议:** 启动时检测是否使用默认密钥，若是则拒绝启动或打印严重警告。生产环境强制要求环境变量。

### 1.3 开球合法性判断错误

- **文件:** `billiards-server/.../service/RoomService.java:738-741`
- **代码:**
  ```java
  boolean legalBreak = cuePocketed || !coloredPocketed.isEmpty() || railContacts >= 4;
  ```
- **描述:** 将白球进袋（`cuePocketed`）视为合法开球条件。按照标准八球规则，开球时白球进袋是犯规，不是合法开球。
- **修复建议:** 移除 `cuePocketed` 条件：`boolean legalBreak = !coloredPocketed.isEmpty() || railContacts >= 4;`

### 1.4 Timer 回调与 Service 方法锁策略不一致

- **文件:** `billiards-server/.../service/RoomService.java`
- **描述:**
  - `recordShotStart`、`processShotEndReport` 等方法 synchronized 在 `this`（RoomService 实例）
  - `finalizeShotFromAvailableReports`（line 573）和 `handleTurnTimeout`（line 935）从调度线程调用，仅 synchronized 在 `room` 对象
  - 两组方法可并发修改同一房间状态
- **影响:** 竞态条件可能导致房间状态损坏、重复出杆、timer 异常。
- **修复建议:** 统一锁策略。建议所有修改房间状态的操作都先获取 service 级锁或改为 per-room 锁（但需全部方法一致）。

### 1.5 前端 SYNC_STATE case 缺少 break

- **文件:** `daily-billiards-vanilla_web/src/network/game-client.js:524`
- **描述:** `SYNC_STATE` case 中，当 `msg.senderId !== 'SYSTEM'` 时没有 break 语句，执行会穿透到 `REMATCH` case。
- **影响:** 非 SYSTEM 的状态同步消息会错误触发重赛处理逻辑。
- **修复建议:** 在 SYNC_STATE case 末尾添加 `break`。

### 1.6 前端 updateEffects() 每帧创建新 Graphics 对象

- **文件:** `daily-billiards-vanilla_web/src/render/pixi-renderer.js:555-603`
- **描述:** 每帧创建 `new PIXI.Graphics()`，`removeChildren()` 移除旧对象但从不调用 `destroy()`。
- **影响:** GPU 内存持续增长，长时间游戏后性能下降甚至崩溃。
- **修复建议:** 复用单个 Graphics 实例，每帧调用 `.clear()` 重绘；或在 removeChildren 后对移除的子节点调用 destroy()。

### 1.7 前端 syncCounter 逻辑完全失效

- **文件:** `daily-billiards-vanilla_web/src/game.js:1078-1080`
- **代码:**
  ```javascript
  if (GameClient.isMyTurn && this.isMoving()) {
      this.syncCounter = 0;
  } else this.syncCounter = 0;
  ```
- **描述:** 两个分支都将 syncCounter 设为 0，实时运动同步功能完全无效。
- **影响:** 对手看不到己方球的实时运动轨迹，只能等球停下后同步最终状态。
- **修复建议:** 恢复正确的同步逻辑，在 `isMyTurn && isMoving()` 时递增 counter 并在达到阈值时发送中间状态。

### 1.8 前端 bindGameInput() 无清理机制

- **文件:** `daily-billiards-vanilla_web/src/input/bindings.js:644-676`
- **描述:** 向 `window` 和 DOM 元素添加事件监听器，但没有提供解绑函数。重新匹配或重连时，旧监听器不会被移除。
- **影响:** 事件处理器累积，导致重复响应和内存泄漏。
- **修复建议:** 返回 cleanup 函数，在游戏重新初始化时调用。

---

## 二、中等问题

### 2.1 后端

| # | 文件 | 问题 | 修复建议 |
|---|------|------|----------|
| 1 | `AuthController.java:57-82` | 注册接口无输入校验，用户名/密码可为空字符串 | 添加 `@NotBlank`、`@Size`、`@Email` 注解 |
| 2 | `AuthController.java:19`, `WebSocketConfig.java:48` | CORS 配置为 `*`，允许任意来源 | 限制为实际前端域名 |
| 3 | `application.yml:13` | `ddl-auto: update` 不适合生产环境 | 生产环境改为 `validate` 或 `none` |
| 4 | `RoomService.java:60` | `roomPausedAt` map 在房间删除时未清理 | `cleanupRoomAfterLeave` 中同步移除 |
| 5 | `RoomService.java` | FINISHED 状态房间永不清理，玩家关闭浏览器后房间永驻内存 | 添加定时清理任务处理 FINISHED 房间 |
| 6 | `RoomService.java:363-378` | `processRematch` 不验证请求玩家是否属于该房间 | 添加 `room.getPlayerIds().contains(playerId)` 检查 |
| 7 | `SchedulerConfig.java:37` | 线程池大小为 5，多房间并发时 timer 回调延迟 | 根据预期并发房间数调整，或使用动态线程池 |
| 8 | `RoomService.java:446-454` | 空 catch 块吞掉异常，隐藏数据解析错误 | 至少记录 warn 日志 |
| 9 | `BilliardsRoom.java` | 内部集合（ArrayList、HashMap）非线程安全，通过 getter 暴露后被多线程直接修改 | 使用线程安全集合或深拷贝 |

### 2.2 前端

| # | 文件 | 问题 | 修复建议 |
|---|------|------|----------|
| 1 | `style.css:1-24` | 全局 `caret-color: transparent !important` 导致输入框光标不可见 | 排除 input 元素 |
| 2 | `style.css:24` | 全局 `pointer-events: auto !important` 与 overlay 的 `pointer-events: none` 冲突 | 移除全局规则或缩小作用范围 |
| 3 | `physics.js:272` | `ball.vel = new Vec2(0,0)` 替换引用对象，同一物理帧内持有旧引用的代码会指向过期对象 | 改为 `ball.vel.x = 0; ball.vel.y = 0` |
| 4 | `pixi-renderer.js:100` | 无 devicePixelRatio 上限，3x DPI 设备创建超大帧缓冲 | 添加 `Math.min(window.devicePixelRatio, 2)` 限制 |
| 5 | `index.html:337` | CDN 加载 Pixi.js 无 SRI integrity 属性 | 添加 integrity 和 crossorigin 属性 |
| 6 | `main.js:843` | `setInterval(preventTextSelection, 300)` 永不清除 | 仅在游戏进行时启用，结束时 clearInterval |
| 7 | `game-client.js:302` | `window.updateGameplayRoomChrome` 未暴露到 window，条件永远为 false | 在 main.js 中将函数赋值给 window |
| 8 | `entities/ball.js:217` | 实际摩擦力硬编码 0.992，与 `FRICTION` 常量 0.994 不一致 | 使用导入的常量 |
| 9 | `game.js:1062-1065` | 后台 tab 时 timer 用本地帧时间倒计时，frameMs 被 clamp 到 80ms，玩家可通过切后台获得额外时间 | 使用 `expireAt` 绝对时间计算剩余 |
| 10 | `state-sync.js:30` | `statusRemainingMs` 为 0 时被视为 falsy，状态消息无法被正确清除 | 改为 `snapshot.statusRemainingMs == null` |

---

## 三、小问题

| # | 文件 | 问题 |
|---|------|------|
| 1 | `index.html:238` | 多余的 `</div>` 闭合标签，破坏 DOM 结构 |
| 2 | `index.html:29-49` | 表单输入缺少 `<label>` 和 `autocomplete` 属性 |
| 3 | `index.html:5` | `user-scalable=no` 阻止缩放，违反 WCAG 1.4.4 |
| 4 | `rules.js:35` / `game.js:1067` | `displayedSecond` 用 `null` 和 `-1` 两种方式表示隐藏 |
| 5 | `game.js:1068,1071` | `updateTimerUI()` 同一帧内调用两次 |
| 6 | `entities/ball.js:52-65` | `mat3Rotate` 函数是死代码，从未被调用 |
| 7 | `pixi-renderer.js:276` | `drawStaticTable()` 每次 resize 创建新 BlurFilter 不销毁旧的 |
| 8 | `audio-manager.js:120-161` | 音频节点在 onended 回调中未 disconnect |
| 9 | `application.yml:13` | `show-sql: true` 生产环境应关闭 |
| 10 | `application.yml:24` | DEBUG 日志级别在生产环境产生过多日志 |
| 11 | `main.js:358-363` | 本地玩家的 shot 被 `executeAcceptedShotInput` 重复执行（依赖 dedup guard） |

---

## 四、修复优先级建议

### P0 — 立即修复（安全/正确性）

1. WebSocket senderId 验证
2. JWT 密钥强制配置
3. 开球合法性判断修正
4. SYNC_STATE break 缺失
5. syncCounter 逻辑恢复

### P1 — 尽快修复（稳定性/性能）

6. Timer 回调锁策略统一
7. updateEffects() 内存泄漏
8. bindGameInput() 清理机制
9. 注册接口输入校验
10. FINISHED 房间清理

### P2 — 计划修复（体验/规范）

11. CSS 全局规则冲突
12. devicePixelRatio 上限
13. 摩擦力常量统一
14. 后台 tab timer 作弊
15. 其余中等问题

### P3 — 有空再修（代码质量）

16. 死代码清理
17. 重复调用优化
18. 日志级别调整
19. 可访问性改进
