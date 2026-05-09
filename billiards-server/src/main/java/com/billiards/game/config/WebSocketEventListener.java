package com.billiards.game.config;

import com.billiards.game.service.RoomService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.event.EventListener;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;

import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * [描述] WebSocket 事件监听器
 * 专门负责监控客户端的连接状态，处理玩家断开连接（掉线）事件，并通知业务层更新房间状态。
 */
@Component
public class WebSocketEventListener {

    private static final Logger log = LoggerFactory.getLogger(WebSocketEventListener.class);

    @Autowired
    private RoomService roomService;

    // sessionId -> playerId
    private static final Map<String, String> sessionPlayerMap = new ConcurrentHashMap<>();
    
    // playerId -> Set<sessionId> (支持同一玩家多个连接)
    private static final Map<String, Set<String>> playerSessionsMap = new ConcurrentHashMap<>();

    public void registerSession(String sessionId, String playerId) {
        if (sessionId == null || playerId == null || playerId.isBlank()) {
            log.warn("忽略无效 WebSocket 会话注册: sessionId={}, playerId={}", sessionId, playerId);
            return;
        }

        String previousPlayerId = sessionPlayerMap.put(sessionId, playerId);
        if (previousPlayerId != null && !previousPlayerId.equals(playerId)) {
            removeSession(previousPlayerId, sessionId);
        }

        playerSessionsMap.computeIfAbsent(playerId, id -> ConcurrentHashMap.newKeySet()).add(sessionId);
        log.info("注册玩家 WebSocket 会话: sessionId={}, playerId={}, activeSessions={}",
                sessionId, playerId, playerSessionsMap.get(playerId).size());
    }

    public static boolean isPlayerOnline(String playerId) {
        Set<String> sessions = playerSessionsMap.get(playerId);
        return sessions != null && !sessions.isEmpty();
    }

    @EventListener
    public void handleWebSocketDisconnectListener(SessionDisconnectEvent event) {
        StompHeaderAccessor headerAccessor = StompHeaderAccessor.wrap(event.getMessage());
        String sessionId = headerAccessor.getSessionId();
        
        String playerId = sessionPlayerMap.remove(sessionId);
        if (playerId != null) {
            boolean stillOnline = removeSession(playerId, sessionId);
            if (stillOnline) {
                log.info("玩家 {} 的一个 WebSocket 会话已断开: sessionId={}, remainingSessions={}",
                        playerId, sessionId, playerSessionsMap.get(playerId).size());
                return;
            }

            log.info("玩家 {} 所有 WebSocket 会话均已断开", playerId);
            roomService.handleDisconnect(playerId);
        }
    }

    private static boolean removeSession(String playerId, String sessionId) {
        Set<String> sessions = playerSessionsMap.get(playerId);
        if (sessions == null) {
            return false;
        }

        sessions.remove(sessionId);
        if (sessions.isEmpty()) {
            playerSessionsMap.remove(playerId, sessions);
            return false;
        }
        return true;
    }
}
