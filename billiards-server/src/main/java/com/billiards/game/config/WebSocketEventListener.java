package com.billiards.game.config;

import com.billiards.game.model.GameMessage;
import com.billiards.game.service.RoomService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.event.EventListener;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * [描述] WebSocket 事件监听器
 * 专门负责监控客户端的连接状态，处理玩家断开连接（掉线）事件，并通知业务层更新房间状态。
 */
@Component
public class WebSocketEventListener {

    private static final Logger log = LoggerFactory.getLogger(WebSocketEventListener.class);

    @Autowired
    private SimpMessagingTemplate messagingTemplate;

    @Autowired
    private RoomService roomService;

    private final Map<String, String> sessionPlayerMap = new ConcurrentHashMap<>();

    public void registerSession(String sessionId, String playerId) {
        sessionPlayerMap.put(sessionId, playerId);
    }

    @EventListener
    public void handleWebSocketDisconnectListener(SessionDisconnectEvent event) {
        StompHeaderAccessor headerAccessor = StompHeaderAccessor.wrap(event.getMessage());
        String sessionId = headerAccessor.getSessionId();
        
        String playerId = sessionPlayerMap.remove(sessionId);
        if (playerId != null) {
            log.info("玩家 {} 已断开连接", playerId);
            roomService.handleDisconnect(playerId);
        }
    }
}
