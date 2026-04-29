package com.billiards.game.controller;

import com.billiards.game.config.WebSocketEventListener;
import com.billiards.game.model.GameMessage;
import com.billiards.game.service.RoomService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Controller;

import java.util.Map;

/**
 * [描述] 游戏 WebSocket 控制器
 * 负责接收和分发客户端发来的所有实时指令，包括玩家加入、击球动作、瞄准同步以及物理位置校验。
 * 该类是 STOMP 协议下的核心分发器。
 */
@Controller
public class GameWebSocketController {

    private static final Logger log = LoggerFactory.getLogger(GameWebSocketController.class);

    /** 核心业务逻辑服务，处理具体的对局规则和房间管理 */
    @Autowired
    private RoomService roomService;

    /** 用于向特定的订阅主题 (Topic) 或 队列 (Queue) 推送消息的模板工具 */
    @Autowired
    private SimpMessagingTemplate messagingTemplate;

    /** 掉线监听器，用于在此手动注册 Session 与 PlayerID 的关联 */
    @Autowired
    private WebSocketEventListener eventListener;

    /**
     * 处理玩家加入房间的消息
     * 客户端发送路径: /app/game.join
     * @param message 包含 roomId, senderId 和 昵称信息的载体
     * @param headerAccessor 用于访问 WebSocket 会话底层数据的访问器（如 SessionID）
     */
    @MessageMapping("/game.join")
    public void joinGame(@Payload GameMessage message, SimpMessageHeaderAccessor headerAccessor) {
        String sessionId = headerAccessor.getSessionId();
        log.info("玩家加入请求: {} (Room: {}, Session: {})", message.getSenderId(), message.getRoomId(), sessionId);

        // 1. 将本次会话的 SessionID 与 玩家ID 绑定，方便掉线后快速识别
        eventListener.registerSession(sessionId, message.getSenderId());
        
        // 2. 调用业务层逻辑处理加入房间（匹配或创建）
        roomService.processJoin(message.getSenderId(), message.getRoomId(), extractNickname(message.getContent()));
    }

    /**
     * 辅助方法：从 GameMessage 的 content 载体中解析出玩家昵称
     * @param content 原始消息内容 (通常是一个 Map)
     * @return 过滤后的有效昵称字符串，若无效则返回 null
     */
    private String extractNickname(Object content) {
        if (content instanceof Map<?, ?> contentMap) {
            Object nickname = contentMap.get("nickname");
            if (nickname instanceof String nicknameText && !nicknameText.isBlank()) {
                return nicknameText.trim();
            }
        }
        return null;
    }

    /**
     * 处理击球动作消息
     * 客户端发送路径: /app/game.shoot
     * @param message 包含击球力度、角度等信息的载体
     */
    @MessageMapping("/game.shoot")
    public void shoot(@Payload GameMessage message) {
        log.info("房间 {} 击球同步", message.getRoomId());
        
        // 0. 记录最近一次正式出杆上下文，供重连恢复和后续权威裁决使用
        Object canonicalContent = roomService.recordShotStart(message.getRoomId(), message.getSenderId(), message.getContent());
        if (canonicalContent == null) {
            return;
        }

        // 1. 击球后立即在服务端停止回合倒计时（球体运动期间不计时）
        roomService.stopTurnTimer(message.getRoomId());
        
        // 2. 将击球参数广播给房间内的所有玩家（包括发送者自己，以确移动画触发点对齐）
        message.setContent(canonicalContent);
        messagingTemplate.convertAndSend("/topic/room/" + message.getRoomId(), message);
    }

    @MessageMapping("/game.shotStart")
    public void shotStart(@Payload GameMessage message) {
        roomService.processShotStart(message.getRoomId(), message.getSenderId(), message.getContent());
    }

    @MessageMapping("/game.shotEnd")
    public void shotEnd(@Payload GameMessage message) {
        roomService.processShotEndReport(message.getRoomId(), message.getSenderId(), message.getContent());
    }

    /**
     * 处理实时瞄准/移动球杆消息
     * 客户端发送路径: /app/game.aim
     * @param message 包含球杆当前坐标和偏转角
     */
    @MessageMapping("/game.aim")
    public void aim(@Payload GameMessage message) {
        // 此类消息频率较高且仅涉及视觉表现，直接转发以实现“所见即所得”的视觉同步
        messagingTemplate.convertAndSend("/topic/room/" + message.getRoomId(), message);
    }

    /**
     * 处理物理同步消息（关键帧校准）
     * 客户端发送路径: /app/game.sync
     * 通常在球全部停止移动、或者玩家获得自由球时，由作为“主控端”的客户端上报最终结果
     * @param message 包含所有球的位置坐标、分数变化等
     */
    @MessageMapping("/game.sync")
    public void sync(@Payload GameMessage message) {
        log.debug("收到来自玩家 {} 房间 {} 的物理状态同步请求", message.getSenderId(), message.getRoomId());
        
        // 1. 在服务端业务逻辑中持久化更新并处理回合切换
        Map<String, Object> syncResult = roomService.syncRoomState(message.getRoomId(), message.getSenderId(), message.getContent());
        if (!Boolean.TRUE.equals(syncResult.get("accepted"))) {
            messagingTemplate.convertAndSend("/queue/player/" + message.getSenderId(), GameMessage.builder()
                    .type(GameMessage.MessageType.ERROR)
                    .roomId(message.getRoomId())
                    .senderId("SYSTEM")
                    .content(syncResult)
                    .build());
            return;
        }
        
        // 2. 将最终校验过的位置广播给全房间，防止各个设备上因为物理引擎浮点数误差产生的“散落感”
        Object authoritativeContent = syncResult.get("broadcastContent");
        GameMessage outbound = message;
        if (authoritativeContent != null) {
            outbound = GameMessage.builder()
                    .type(GameMessage.MessageType.SYNC_STATE)
                    .roomId(message.getRoomId())
                    .senderId("SYSTEM")
                    .content(authoritativeContent)
                    .build();
        }
        messagingTemplate.convertAndSend("/topic/room/" + message.getRoomId(), outbound);
    }

    /**
     * 处理再来一局消息
     * 客户端发送路径: /app/game.rematch
     * @param message 包含发送者 ID 和 房间 ID
     */
    @MessageMapping("/game.rematch")
    public void rematch(@Payload GameMessage message) {
        log.info("房间 {} 收到玩家 {} 的再来一局请求", message.getRoomId(), message.getSenderId());
        
        // 交由业务层判断两名玩家是否都已点击“再来一局”
        roomService.processRematch(message.getSenderId(), message.getRoomId());
    }

    /**
     * 处理房间内文字聊天消息
     * 客户端发送路径: /app/game.chat
     * @param message 包含聊天文本
     */
    @MessageMapping("/game.chat")
    public void chat(@Payload GameMessage message) {
        // 直接透传消息给房间内的所有人
        messagingTemplate.convertAndSend("/topic/room/" + message.getRoomId(), message);
    }
}
