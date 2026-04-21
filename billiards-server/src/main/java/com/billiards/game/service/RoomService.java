package com.billiards.game.service;

import com.billiards.game.model.BilliardsRoom;
import com.billiards.game.model.GameMessage;
import com.billiards.game.repository.RoomRepository;
import com.billiards.game.repository.UserStatsMapper;
import com.billiards.game.timer.TurnTimerService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

/**
 * [描述] 房间核心业务服务类
 * 实现游戏的核心逻辑，包括玩家匹配加入、掉线处理、回合切换、倒计时管理以及全局物理状态的同步校准。
 */
@Service
public class RoomService {

    private static final Logger log = LoggerFactory.getLogger(RoomService.class);

    @Autowired
    private SimpMessagingTemplate messagingTemplate;

    @Autowired
    private RoomRepository roomRepository;

    @Autowired
    private TurnTimerService turnTimerService;

    @Autowired
    private UserStatsMapper userStatsMapper;

    private static final int TURN_TIME_LIMIT = 45;
    public synchronized void processJoin(String playerId, String requestedRoomId, String nickname) {
        Optional<BilliardsRoom> currentRoom = roomRepository.findAll().stream()
                .filter(r -> r.getPlayerIds().contains(playerId))
                .findFirst();

        BilliardsRoom room = null;
        if (currentRoom.isPresent()) {
            BilliardsRoom oldRoom = currentRoom.get();
            if (requestedRoomId != null && !oldRoom.getRoomId().equals(requestedRoomId)) {
                oldRoom.getPlayerIds().remove(playerId);
                oldRoom.getPlayerNames().remove(playerId);
                cleanupRoomAfterLeave(oldRoom);
            } else {
                room = oldRoom;
            }
        }

        if (room == null) {
            if (requestedRoomId != null) {
                room = roomRepository.findById(requestedRoomId).orElseGet(() -> {
                    BilliardsRoom r = new BilliardsRoom();
                    r.setRoomId(requestedRoomId);
                    roomRepository.save(r);
                    return r;
                });
            } else {
                room = roomRepository.findWaitingRoom().orElseGet(() -> {
                    BilliardsRoom r = new BilliardsRoom();
                    roomRepository.save(r);
                    return r;
                });
            }
        }

        BilliardsRoom.GameStatus oldStatus = room.getStatus();
        
        if (room.addPlayer(playerId)) {
            room.getPlayerNames().put(playerId, resolveDisplayName(playerId, nickname));
            roomRepository.save(room);
            
            GameMessage joinResponse = GameMessage.builder()
                    .type(GameMessage.MessageType.JOIN)
                    .roomId(room.getRoomId())
                    .senderId("SYSTEM")
                    .content(Map.of(
                        "room", room,
                        "status", room.getStatus().toString(),
                        "serverTime", System.currentTimeMillis()
                    ))
                    .build();
            
            messagingTemplate.convertAndSend("/topic/room/" + room.getRoomId(), joinResponse);
            messagingTemplate.convertAndSend("/queue/player/" + playerId, joinResponse);

            if (oldStatus == BilliardsRoom.GameStatus.WAITING && room.getStatus() == BilliardsRoom.GameStatus.PLAYING) {
                startTurnTimer(room);
                notifyGameStart(room);
            }
        }
    }

    public synchronized void handleDisconnect(String playerId) {
        Optional<BilliardsRoom> roomOpt = roomRepository.findAll().stream()
                .filter(r -> r.getPlayerIds().contains(playerId))
                .findFirst();
        
        if (roomOpt.isPresent()) {
            BilliardsRoom room = roomOpt.get();
            if (room.getStatus() == BilliardsRoom.GameStatus.PLAYING) {
                messagingTemplate.convertAndSend("/topic/room/" + room.getRoomId(), GameMessage.builder()
                        .type(GameMessage.MessageType.PLAYER_LEFT)
                        .roomId(room.getRoomId())
                        .senderId(playerId)
                        .content("玩家掉线")
                        .build());
                return;
            }
            
            room.getPlayerIds().remove(playerId);
            room.getPlayerNames().remove(playerId);
            cleanupRoomAfterLeave(room);
        }
    }

    private String resolveDisplayName(String playerId, String nickname) {
        if (nickname != null && !nickname.isBlank()) return nickname.trim();
        return "玩家-" + (playerId.length() > 4 ? playerId.substring(playerId.length() - 4) : playerId);
    }

    private void cleanupRoomAfterLeave(BilliardsRoom room) {
        turnTimerService.cancelTimer(room.getRoomId());
        turnTimerService.cancelPeriodicSync(room.getRoomId());
        
        if (room.getPlayerIds().isEmpty()) {
            roomRepository.remove(room.getRoomId());
        } else {
            room.setStatus(BilliardsRoom.GameStatus.WAITING);
            roomRepository.save(room);
        }
    }

    private void notifyGameStart(BilliardsRoom room) {
        messagingTemplate.convertAndSend("/topic/room/" + room.getRoomId(), GameMessage.builder()
                .type(GameMessage.MessageType.GAME_START)
                .roomId(room.getRoomId())
                .senderId("SYSTEM")
                .content(room)
                .build());
    }

    public synchronized void resetTurnTimer(String roomId) {
        roomRepository.findById(roomId).ifPresent(this::startTurnTimer);
    }

    public synchronized void stopTurnTimer(String roomId) {
        roomRepository.findById(roomId).ifPresent(room -> {
            turnTimerService.cancelTimer(roomId);
            room.setExpireAt(0);
            roomRepository.save(room);
        });
    }

    public synchronized Object recordShotStart(String roomId, String senderId, Object content) {
        Optional<BilliardsRoom> roomOpt = roomRepository.findById(roomId);
        if (roomOpt.isEmpty()) return content;

        BilliardsRoom room = roomOpt.get();
        synchronized (room) {
            if (senderId != null && !senderId.equals(room.getCurrentTurnPlayerId())) {
                return null;
            }

            Map<String, Object> canonicalShot = new LinkedHashMap<>();
            canonicalShot.put("protocol", "shot-start-v1");
            canonicalShot.put("senderId", senderId);

            room.setLastShotPlayerId(senderId);
            if (content instanceof Map<?, ?> contentMap) {
                Object shotIdObj = contentMap.get("shotId");
                if (shotIdObj instanceof String shotId && !shotId.isBlank()) {
                    room.setLastShotId(shotId);
                    canonicalShot.put("shotId", shotId);
                }

                Object startedAtObj = contentMap.get("startedAt");
                if (startedAtObj instanceof Number startedAt) {
                    room.setLastShotStartedAt(startedAt.longValue());
                    canonicalShot.put("startedAt", startedAt.longValue());
                }

                Object protocolObj = contentMap.get("protocol");
                if (protocolObj instanceof String protocol && !protocol.isBlank()) {
                    room.setLastShotProtocol(protocol);
                    canonicalShot.put("protocol", protocol);
                } else {
                    room.setLastShotProtocol("shot-start-v1");
                }

                Object aimAngleObj = contentMap.get("aimAngle");
                if (aimAngleObj instanceof Number aimAngle) canonicalShot.put("aimAngle", aimAngle.doubleValue());

                Object powerRatioObj = contentMap.get("powerRatio");
                if (powerRatioObj instanceof Number powerRatio) canonicalShot.put("powerRatio", powerRatio.doubleValue());

                Object cueBallXObj = contentMap.get("cueBallX");
                if (cueBallXObj instanceof Number cueBallX) canonicalShot.put("cueBallX", cueBallX.doubleValue());

                Object cueBallYObj = contentMap.get("cueBallY");
                if (cueBallYObj instanceof Number cueBallY) canonicalShot.put("cueBallY", cueBallY.doubleValue());

                Object randomSeedObj = contentMap.get("randomSeed");
                canonicalShot.put("randomSeed", randomSeedObj);
            } else {
                room.setLastShotProtocol("shot-start-v1");
            }

            room.setAwaitingSettledSync(true);
            roomRepository.save(room);
            canonicalShot.put("shotId", room.getLastShotId());
            canonicalShot.put("startedAt", room.getLastShotStartedAt());
            canonicalShot.put("protocol", room.getLastShotProtocol());
            return canonicalShot;
        }
    }

    private void startTurnTimer(BilliardsRoom room) {
        long expire = System.currentTimeMillis() + TURN_TIME_LIMIT * 1000L;
        room.setExpireAt(expire);
        roomRepository.save(room);
        turnTimerService.startTimer(room.getRoomId(), TURN_TIME_LIMIT, () -> handleTurnTimeout(room.getRoomId()));
    }

    private void handleTurnTimeout(String roomId) {
        roomRepository.findById(roomId).ifPresent(room -> {
            synchronized (room) {
                if (room.getPlayerIds().size() < 2) return;

                int currentIndex = room.getPlayerIds().indexOf(room.getCurrentTurnPlayerId());
                int nextIndex = (currentIndex + 1) % room.getPlayerIds().size();
                String nextPlayerId = room.getPlayerIds().get(nextIndex);
                
                room.setCurrentTurnPlayerId(nextPlayerId);
                room.setAwaitingSettledSync(false);
                startTurnTimer(room);
                roomRepository.save(room);
                
                messagingTemplate.convertAndSend("/topic/room/" + roomId, GameMessage.builder()
                        .type(GameMessage.MessageType.TURN_TIMEOUT)
                        .roomId(roomId)
                        .senderId("SYSTEM")
                        .content(room)
                        .build());
            }
        });
    }

    public synchronized void processRematch(String playerId, String roomId) {
        roomRepository.findById(roomId).ifPresent(room -> {
            if (!room.getRematchReadyPlayers().contains(playerId)) {
                room.getRematchReadyPlayers().add(playerId);
            }
            if (room.getRematchReadyPlayers().size() == 2) {
                room.resetGame();
                roomRepository.save(room);
                startTurnTimer(room);
                notifyGameStart(room);
            }
        });
    }

    public synchronized Map<String, Object> syncRoomState(String roomId, String senderId, Object content) {
        Optional<BilliardsRoom> roomOpt = roomRepository.findById(roomId);
        if (roomOpt.isEmpty()) return Map.of("accepted", false, "code", "ROOM_NOT_FOUND");

        BilliardsRoom room = roomOpt.get();
        synchronized (room) {
            if (senderId != null && !senderId.equals(room.getCurrentTurnPlayerId())) {
                return Map.of("accepted", false, "code", "NOT_CURRENT_PLAYER");
            }

            boolean isLive = false;
            boolean isSettledSync = false;
            String sourceShotId = null;
            if (content instanceof Map<?, ?> contentMap) {
                Object isLiveObj = contentMap.get("isLive");
                if (isLiveObj instanceof Boolean) {
                    isLive = (Boolean) isLiveObj;
                }
                Object syncKindObj = contentMap.get("syncKind");
                if (syncKindObj instanceof String syncKind) {
                    isSettledSync = "settled".equals(syncKind);
                }
                Object sourceShotIdObj = contentMap.get("sourceShotId");
                if (sourceShotIdObj instanceof String shotId && !shotId.isBlank()) {
                    sourceShotId = shotId;
                }
            }

            if (isSettledSync) {
                String activeShotId = room.getLastShotId();
                if (sourceShotId == null || activeShotId == null || !activeShotId.equals(sourceShotId)) {
                    log.warn("拒绝过期 settled sync, roomId={}, senderId={}, sourceShotId={}, activeShotId={}", roomId, senderId, sourceShotId, activeShotId);
                    return buildSyncRejectedPayload(room, sourceShotId, activeShotId);
                }
            }

            room.setBallState(content);

            if (content instanceof Map<?, ?> contentMap) {
                try {
                    Object scores = contentMap.get("scores");
                    if (scores instanceof Map<?, ?> scoreMap) {
                        room.setPlayer1Score(((Number) scoreMap.get("1")).intValue());
                        room.setPlayer2Score(((Number) scoreMap.get("2")).intValue());
                    }
                } catch (Exception e) {}
                
                try {
                    Object groups = contentMap.get("playerGroups");
                    if (groups instanceof Map<?, ?> groupMap) {
                        room.setPlayer1Group((String) groupMap.get("1"));
                        room.setPlayer2Group((String) groupMap.get("2"));
                    }
                } catch (Exception e) {}

                Object currentPlayerIndex = contentMap.get("currentPlayer");
                if (currentPlayerIndex instanceof Number index) {
                    int idx = index.intValue() - 1;
                    if (idx >= 0 && idx < room.getPlayerIds().size()) {
                        String newPlayerId = room.getPlayerIds().get(idx);
                        if (!newPlayerId.equals(room.getCurrentTurnPlayerId())) {
                            room.setCurrentTurnPlayerId(newPlayerId);
                        }
                    }
                }
                
                Object ballInHand = contentMap.get("ballInHand");
                if (ballInHand instanceof Boolean) room.setBallInHand((Boolean) ballInHand);
                Object zone = contentMap.get("ballInHandZone");
                if (zone instanceof String) room.setBallInHandZone((String) zone);

                Object isFinished = contentMap.get("isFinished");
                if (Boolean.TRUE.equals(isFinished) && room.getStatus() != BilliardsRoom.GameStatus.FINISHED) {
                    room.setStatus(BilliardsRoom.GameStatus.FINISHED);
                    Object winnerIndex = contentMap.get("winner");
                    if (winnerIndex instanceof Number wIdx) {
                        handleGameOverStats(room, wIdx.intValue());
                    }
                }

                if (sourceShotId != null) {
                    room.setLastShotId(sourceShotId);
                }

                Object syncKindObj = contentMap.get("syncKind");
                if (syncKindObj instanceof String syncKind && "settled".equals(syncKind)) {
                    room.setAwaitingSettledSync(false);
                    Object settledAtObj = contentMap.get("settledAt");
                    if (settledAtObj instanceof Number settledAt) {
                        room.setLastSettledAt(settledAt.longValue());
                    } else {
                        room.setLastSettledAt(System.currentTimeMillis());
                    }
                    Object settledSignatureObj = contentMap.get("settledSignature");
                    if (settledSignatureObj instanceof String settledSignature && !settledSignature.isBlank()) {
                        room.setLastSettledSignature(settledSignature);
                    }
                }
            }

            roomRepository.save(room);

            if ((isSettledSync || !isLive) && room.getStatus() == BilliardsRoom.GameStatus.PLAYING) {
                resetTurnTimer(roomId);
            }
            return Map.of(
                    "accepted", true,
                    "broadcastContent", buildAuthoritativeSyncPayload(room, isSettledSync)
            );
        }
    }

    private Map<String, Object> buildSyncRejectedPayload(BilliardsRoom room, String sourceShotId, String activeShotId) {
        Map<String, Object> payload = new HashMap<>();
        payload.put("accepted", false);
        payload.put("code", "STALE_SETTLED_SYNC");
        payload.put("roomId", room.getRoomId());
        payload.put("sourceShotId", sourceShotId);
        payload.put("activeShotId", activeShotId);
        payload.put("room", room);
        payload.put("authoritativeSnapshot", room.getBallState());
        payload.put("serverTime", System.currentTimeMillis());
        return payload;
    }

    private Map<String, Object> buildAuthoritativeSyncPayload(BilliardsRoom room, boolean isSettledSync) {
        Map<String, Object> payload = new HashMap<>();
        payload.put("authoritative", true);
        payload.put("syncKind", isSettledSync ? "authoritative-settled" : "authoritative-sync");
        payload.put("room", room);
        payload.put("ballState", room.getBallState());
        payload.put("lastSettledSignature", room.getLastSettledSignature());
        payload.put("serverTime", System.currentTimeMillis());
        return payload;
    }

    private void handleGameOverStats(BilliardsRoom room, int winnerIndex) {
        if (room.getPlayerIds().size() < 2) return;
        String p1Id = room.getPlayerIds().get(0);
        String p2Id = room.getPlayerIds().get(1);
        updateUserStats(p1Id, winnerIndex == 1);
        updateUserStats(p2Id, winnerIndex == 2);
    }

    private void updateUserStats(String playerId, boolean isWinner) {
        if (playerId != null && playerId.startsWith("u_")) {
            try {
                Long userId = Long.parseLong(playerId.substring(2));
                if (isWinner) {
                    userStatsMapper.addWin(userId, 25);
                } else {
                    userStatsMapper.addLoss(userId, 20);
                }
            } catch (Exception e) {
                log.error("更新用户战绩失败: {}", playerId, e);
            }
        }
    }
}
