package com.billiards.game.service;

import com.billiards.game.config.WebSocketEventListener;
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

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * 轻量房间裁决服务：
 * - 不运行物理引擎
 * - 只裁决回合、计时、结果可信性和恢复快照
 */
@Service
public class RoomService {

    private static final Logger log = LoggerFactory.getLogger(RoomService.class);

    private static final int TURN_TIME_LIMIT = 45;
    private static final long SYNC_INTERVAL_MS = 100;
    private static final int TABLE_WIDTH = 820;
    private static final int TABLE_HEIGHT = 410;
    private static final int BALL_RADIUS = 14;
    private static final int PLAYABLE_AREA_INSET = BALL_RADIUS + 24;
    private static final int HEAD_STRING_X = -TABLE_WIDTH / 4;
    private static final int BALL_STATE_PRECISION = 100;
    private static final String SHOT_FINALIZE_TIMER_SUFFIX = ":shot-finalize";

    @Autowired
    private SimpMessagingTemplate messagingTemplate;

    @Autowired
    private RoomRepository roomRepository;

    @Autowired
    private TurnTimerService turnTimerService;

    @Autowired
    private UserStatsMapper userStatsMapper;

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

        if (!room.getPlayerIds().contains(playerId) && !canJoinRequestedRoom(room, requestedRoomId)) {
            sendError(room, playerId, "ROOM_FULL", "房间已满或仍被对局占用");
            return;
        }

        BilliardsRoom.GameStatus oldStatus = room.getStatus();

        if (room.addPlayer(playerId)) {
            room.getPlayerNames().put(playerId, resolveDisplayName(playerId, nickname));
            roomRepository.save(room);

            Map<String, Object> joinPayload = new HashMap<>();
            joinPayload.put("room", buildRoomSnapshot(room));
            joinPayload.put("status", room.getStatus().toString());
            joinPayload.put("serverTime", System.currentTimeMillis());

            GameMessage joinResponse = GameMessage.builder()
                    .type(GameMessage.MessageType.JOIN)
                    .roomId(room.getRoomId())
                    .senderId("SYSTEM")
                    .content(joinPayload)
                    .build();

            messagingTemplate.convertAndSend("/topic/room/" + room.getRoomId(), joinResponse);
            messagingTemplate.convertAndSend("/queue/player/" + playerId, joinResponse);

            if (oldStatus == BilliardsRoom.GameStatus.WAITING && room.getStatus() == BilliardsRoom.GameStatus.PLAYING) {
                room.setStateHash("INITIAL");
                room.setTurnId(1L);
                room.setStateVersion(1L);
                room.setShotToken(newShotToken());
                room.setBreakShot(true);
                startTurnTimer(room);
                notifyGameStart(room);
                sendRoomSnapshot(room, null);
            } else if (room.getStatus() == BilliardsRoom.GameStatus.PAUSED) {
                resumePausedRoom(room);
            } else if (room.getStatus() == BilliardsRoom.GameStatus.PLAYING || room.getStatus() == BilliardsRoom.GameStatus.RESOLVING) {
                sendRoomSnapshot(room, playerId);
            }
        } else {
            sendError(room, playerId, "ROOM_FULL", "房间已满或仍被对局占用");
        }
    }

    public synchronized void handleDisconnect(String playerId) {
        Optional<BilliardsRoom> roomOpt = roomRepository.findAll().stream()
                .filter(r -> r.getPlayerIds().contains(playerId))
                .findFirst();

        if (roomOpt.isPresent()) {
            BilliardsRoom room = roomOpt.get();
            if (room.getStatus() == BilliardsRoom.GameStatus.PLAYING || room.getStatus() == BilliardsRoom.GameStatus.RESOLVING) {
                pauseRoomForDisconnect(room, playerId);
                return;
            }

            room.getPlayerIds().remove(playerId);
            room.getPlayerNames().remove(playerId);
            cleanupRoomAfterLeave(room);
        }
    }

    public synchronized void processShotStart(String roomId, String senderId, Object content) {
        roomRepository.findById(roomId).ifPresent(room -> {
            Map<String, Object> shotRequest = asMap(content);
            if (!validateShotStart(room, senderId, shotRequest)) {
                sendError(room, senderId, "SHOT_START_REJECTED", "当前不能出杆");
                return;
            }
            Map<String, Object> canonicalShot = buildCanonicalShotStart(room, senderId, shotRequest);

            room.setStatus(BilliardsRoom.GameStatus.RESOLVING);
            room.setPendingShotInput(canonicalShot);
            room.getPendingShotReports().clear();
            turnTimerService.cancelTimer(roomId);
            room.setExpireAt(0);
            roomRepository.save(room);

            Map<String, Object> payload = new HashMap<>();
            payload.put("shot", canonicalShot);
            payload.put("room", buildRoomSnapshot(room));
            payload.put("serverTime", System.currentTimeMillis());

            messagingTemplate.convertAndSend("/topic/room/" + roomId, GameMessage.builder()
                    .type(GameMessage.MessageType.SHOT_START_ACCEPTED)
                    .roomId(roomId)
                    .senderId(senderId)
                    .content(payload)
                    .build());
        });
    }

    private Map<String, Object> buildCanonicalShotStart(BilliardsRoom room, String senderId, Map<String, Object> shotRequest) {
        Map<String, Object> canonicalShot = new LinkedHashMap<>();
        canonicalShot.put("protocol", "shot-start-v1");
        canonicalShot.put("senderId", senderId);
        canonicalShot.put("turnId", room.getTurnId());
        canonicalShot.put("stateVersion", room.getStateVersion());
        canonicalShot.put("shotToken", room.getShotToken());
        canonicalShot.put("preStateHash", room.getStateHash());

        String shotId = asString(shotRequest.get("shotId"));
        if (shotId.isBlank()) {
            shotId = UUID.randomUUID().toString();
        }
        canonicalShot.put("shotId", shotId);
        room.setLastShotId(shotId);

        long startedAt = System.currentTimeMillis();
        Object startedAtObj = shotRequest.get("startedAt");
        if (startedAtObj instanceof Number startedAtNumber && startedAtNumber.longValue() > 0) {
            startedAt = startedAtNumber.longValue();
        }
        canonicalShot.put("startedAt", startedAt);
        room.setLastShotStartedAt(startedAt);

        String protocol = asString(shotRequest.get("protocol"));
        if (!protocol.isBlank()) {
            canonicalShot.put("protocol", protocol);
            room.setLastShotProtocol(protocol);
        } else {
            room.setLastShotProtocol("shot-start-v1");
        }

        room.setLastShotPlayerId(senderId);

        double aimAngle = asDouble(shotRequest.get("aimAngle"));
        if (!Double.isNaN(aimAngle)) {
            canonicalShot.put("aimAngle", aimAngle);
        }

        double powerRatio = asDouble(shotRequest.get("powerRatio"));
        if (!Double.isNaN(powerRatio)) {
            canonicalShot.put("powerRatio", powerRatio);
        }

        Map<String, Object> cueBallPos = asMap(shotRequest.get("cueBallPos"));
        if (!cueBallPos.isEmpty()) {
            double cueBallX = asDouble(cueBallPos.get("x"));
            double cueBallY = asDouble(cueBallPos.get("y"));
            if (!Double.isNaN(cueBallX)) canonicalShot.put("cueBallX", cueBallX);
            if (!Double.isNaN(cueBallY)) canonicalShot.put("cueBallY", cueBallY);
        }

        if (shotRequest.containsKey("randomSeed")) {
            canonicalShot.put("randomSeed", shotRequest.get("randomSeed"));
        } else {
            canonicalShot.put("randomSeed", null);
        }

        room.setAwaitingSettledSync(true);
        return canonicalShot;
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

    public synchronized void processShotEndReport(String roomId, String senderId, Object content) {
        roomRepository.findById(roomId).ifPresent(room -> {
            if (room.getStatus() != BilliardsRoom.GameStatus.RESOLVING) {
                log.warn("忽略 SHOT_END_REPORT: roomId={}, senderId={}, reason=status_not_resolving, status={}",
                        roomId, senderId, room.getStatus());
                return;
            }
            Map<String, Object> report = asMap(content);
            if (report.isEmpty()) {
                log.warn("忽略 SHOT_END_REPORT: roomId={}, senderId={}, reason=empty_report", roomId, senderId);
                return;
            }
            Map<String, Object> cueBall = normalizeBallState(asList(report.get("finalBallState"))).stream()
                    .filter(ball -> "cue".equals(asString(ball.get("type"))))
                    .findFirst()
                    .orElse(null);
            log.info("接收 SHOT_END_REPORT: roomId={}, senderId={}, senderRole={}, turnId={}, stateVersion={}, shotToken={}, cuePocketed={}, firstContactBallId={}, railContacts={}, cueBall={}",
                    roomId,
                    senderId,
                    asString(report.get("senderRole")),
                    asLong(report.get("turnId")),
                    asLong(report.get("stateVersion")),
                    asString(report.get("shotToken")),
                    asBoolean(report.get("cuePocketed")),
                    asString(report.get("firstContactBallId")),
                    asInt(report.get("railContacts")),
                    cueBall);
            room.getPendingShotReports().put(senderId, report);
            roomRepository.save(room);

            if (room.getPendingShotReports().size() >= 2) {
                log.info("SHOT_END_REPORT 达到双端数量，立即结算: roomId={}, reports={}",
                        roomId, room.getPendingShotReports().keySet());
                turnTimerService.cancelTimer(roomId + SHOT_FINALIZE_TIMER_SUFFIX);
                finalizeShotFromAvailableReports(roomId);
            } else {
                log.info("SHOT_END_REPORT 仅收到单端，等待 witness 或 1s 超时: roomId={}, reports={}",
                        roomId, room.getPendingShotReports().keySet());
                turnTimerService.cancelTimer(roomId + SHOT_FINALIZE_TIMER_SUFFIX);
                turnTimerService.startTimer(roomId + SHOT_FINALIZE_TIMER_SUFFIX, 1, () -> finalizeShotFromAvailableReports(roomId));
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
                sendRoomSnapshot(room, null);
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
            boolean isPlacementCommit = false;
            String sourceShotId = null;
            if (content instanceof Map<?, ?> contentMap) {
                Object isLiveObj = contentMap.get("isLive");
                if (isLiveObj instanceof Boolean) {
                    isLive = (Boolean) isLiveObj;
                }
                Object syncKindObj = contentMap.get("syncKind");
                if (syncKindObj instanceof String syncKind) {
                    isSettledSync = "settled".equals(syncKind);
                    isPlacementCommit = "ball-in-hand-commit".equals(syncKind);
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

            Map<String, Object> canonicalContent = content instanceof Map<?, ?> ? asMap(content) : null;
            if (canonicalContent != null && canonicalContent.get("balls") instanceof List<?>) {
                List<Map<String, Object>> normalizedBalls = normalizeBallState(asList(canonicalContent.get("balls")));
                boolean shouldEnsureCueVisible = isPlacementCommit || room.isBallInHand() || asBoolean(canonicalContent.get("ballInHand"));
                String zone = asString(canonicalContent.get("ballInHandZone"));
                if (zone.isBlank()) {
                    zone = room.getBallInHandZone();
                }
                if (shouldEnsureCueVisible) {
                    ensureCueBallVisible(normalizedBalls, zone, true);
                }
                canonicalContent.put("balls", denormalizeBallState(normalizedBalls));
                if (isPlacementCommit) {
                    room.setLastSettledBallState(canonicalContent);
                    room.setStateHash(buildStateHash(normalizedBalls));
                }
                content = canonicalContent;
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
                if (isPlacementCommit) {
                    room.setAwaitingSettledSync(false);
                    room.setLastSettledAt(System.currentTimeMillis());
                }
            }

            roomRepository.save(room);

            if (log.isDebugEnabled()) {
                List<?> balls = extractBallState(room.getBallState());
                Map<String, Object> cueBall = normalizeBallState(balls).stream()
                        .filter(ball -> "cue".equals(asString(ball.get("type"))))
                        .findFirst()
                        .orElse(null);
                log.debug("接受状态同步: roomId={}, senderId={}, syncKind={}, isLive={}, ballInHand={}, zone={}, cuePocketed={}, cue=({}, {}), turnId={}, stateVersion={}",
                        roomId,
                        senderId,
                        isPlacementCommit ? "ball-in-hand-commit" : (isSettledSync ? "settled" : (isLive ? "live" : "snapshot")),
                        isLive,
                        room.isBallInHand(),
                        room.getBallInHandZone(),
                        cueBall != null && asBoolean(cueBall.get("pocketed")),
                        cueBall == null ? null : cueBall.get("x"),
                        cueBall == null ? null : cueBall.get("y"),
                        room.getTurnId(),
                        room.getStateVersion());
            }

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

    private void finalizeShotFromAvailableReports(String roomId) {
        roomRepository.findById(roomId).ifPresent(room -> {
            synchronized (room) {
                if (room.getStatus() != BilliardsRoom.GameStatus.RESOLVING) {
                    log.warn("跳过 finalizeShotFromAvailableReports: roomId={}, status={}", roomId, room.getStatus());
                    return;
                }

                log.info("开始 finalizeShotFromAvailableReports: roomId={}, pendingReportSenders={}",
                        roomId, room.getPendingShotReports().keySet());
                Map<String, Object> chosenReport = chooseReport(room);
                if (chosenReport == null) {
                    log.warn("本杆结果无法选出兼容报告，准备回滚: roomId={}, reports={}",
                            roomId, room.getPendingShotReports().values());
                    rollbackResolvingRoom(room, "本杆结果冲突，已回退到上一稳定桌面");
                    return;
                }

                Map<String, Object> result = adjudicateShot(room, chosenReport);
                if (result == null) {
                    log.warn("本杆结果轻量校验失败，准备回滚: roomId={}, chosenReport={}", roomId, chosenReport);
                    rollbackResolvingRoom(room, "本杆结果未通过轻量校验");
                    return;
                }

                room.setPendingShotInput(null);
                room.getPendingShotReports().clear();
                turnTimerService.cancelTimer(roomId + SHOT_FINALIZE_TIMER_SUFFIX);
                roomRepository.save(room);
                log.info("本杆结算完成并广播 SHOT_RESULT: roomId={}, ballInHand={}, ballInHandZone={}, currentPlayer={}, statusMessage={}",
                        roomId,
                        result.get("ballInHand"),
                        result.get("ballInHandZone"),
                        result.get("currentPlayer"),
                        result.get("statusMessage"));

                messagingTemplate.convertAndSend("/topic/room/" + roomId, GameMessage.builder()
                        .type(GameMessage.MessageType.SHOT_RESULT)
                        .roomId(roomId)
                        .senderId("SYSTEM")
                        .content(result)
                        .build());
            }
        });
    }

    private Map<String, Object> chooseReport(BilliardsRoom room) {
        if (room.getPendingShotReports().isEmpty()) {
            log.warn("chooseReport 失败: roomId={}, reason=no_reports", room.getRoomId());
            return null;
        }
        if (room.getPendingShotReports().size() == 1) {
            log.info("chooseReport 使用单端报告: roomId={}, sender={}",
                    room.getRoomId(), room.getPendingShotReports().keySet());
            return room.getPendingShotReports().values().stream()
                    .map(this::asMap)
                    .findFirst()
                    .orElse(null);
        }

        List<Map<String, Object>> reports = room.getPendingShotReports().values().stream()
                .map(this::asMap)
                .collect(Collectors.toList());
        Map<String, Object> first = reports.get(0);
        Map<String, Object> second = reports.get(1);

        if (reportsBusinessCompatible(first, second)) {
            Map<String, Object> shooterPreferred = "shooter".equals(asString(first.get("senderRole"))) ? first
                    : ("shooter".equals(asString(second.get("senderRole"))) ? second : first);
            if (!asString(first.get("finalStateHash")).equals(asString(second.get("finalStateHash")))) {
                log.warn("SHOT_END finalStateHash mismatch but business outcome matched, roomId={}, shooterHash={}, witnessHash={}",
                        room.getRoomId(),
                        asString(shooterPreferred.get("finalStateHash")),
                        shooterPreferred == first ? asString(second.get("finalStateHash")) : asString(first.get("finalStateHash")));
            }
            log.info("chooseReport 选择兼容报告: roomId={}, chosenSenderRole={}, firstHash={}, secondHash={}",
                    room.getRoomId(),
                    asString(shooterPreferred.get("senderRole")),
                    asString(first.get("finalStateHash")),
                    asString(second.get("finalStateHash")));
            return shooterPreferred;
        }
        log.warn("chooseReport 发现业务不兼容报告: roomId={}, first={}, second={}",
                room.getRoomId(), first, second);
        return null;
    }

    private boolean reportsBusinessCompatible(Map<String, Object> first, Map<String, Object> second) {
        return asString(first.get("firstContactBallId")).equals(asString(second.get("firstContactBallId")))
                && asBoolean(first.get("cuePocketed")) == asBoolean(second.get("cuePocketed"))
                && asBoolean(first.get("eightPocketed")) == asBoolean(second.get("eightPocketed"))
                && asInt(first.get("railContacts")) == asInt(second.get("railContacts"))
                && normalizeStringList(asList(first.get("pocketedBallIds"))).equals(normalizeStringList(asList(second.get("pocketedBallIds"))));
    }

    private Map<String, Object> adjudicateShot(BilliardsRoom room, Map<String, Object> report) {
        List<Map<String, Object>> finalBallState = normalizeBallState(asList(report.get("finalBallState")));
        if (!validateBallState(finalBallState)) {
            log.warn("adjudicateShot 校验失败: roomId={}, reason=invalid_ball_state, report={}", room.getRoomId(), report);
            return null;
        }

        List<Map<String, Object>> preBallState = normalizeBallState(extractBallState(room.getLastSettledBallState()));
        if (!preBallState.isEmpty() && preBallState.size() != finalBallState.size()) {
            return null;
        }

        String calculatedHash = buildStateHash(finalBallState);
        if (!calculatedHash.equals(asString(report.get("finalStateHash")))) {
            log.warn("adjudicateShot 校验失败: roomId={}, reason=hash_mismatch, calculatedHash={}, reportHash={}",
                    room.getRoomId(), calculatedHash, asString(report.get("finalStateHash")));
            return null;
        }

        Map<String, Map<String, Object>> preById = indexById(preBallState);
        Map<String, Map<String, Object>> finalById = indexById(finalBallState);

        List<Map<String, Object>> newlyPocketed = finalBallState.stream()
                .filter(ball -> {
                    Map<String, Object> prev = preById.get(ball.get("id"));
                    boolean wasPocketed = prev != null && asBoolean(prev.get("pocketed"));
                    return !wasPocketed && asBoolean(ball.get("pocketed"));
                })
                .collect(Collectors.toList());

        boolean cuePocketed = newlyPocketed.stream().anyMatch(ball -> "cue".equals(asString(ball.get("type"))));
        boolean eightPocketed = newlyPocketed.stream().anyMatch(ball -> "eight".equals(asString(ball.get("type"))));
        List<Map<String, Object>> coloredPocketed = newlyPocketed.stream()
                .filter(ball -> {
                    String type = asString(ball.get("type"));
                    return "solid".equals(type) || "stripe".equals(type);
                })
                .collect(Collectors.toList());

        int currentPlayerIndex = Math.max(0, room.getPlayerIds().indexOf(room.getCurrentTurnPlayerId()));
        int currentPlayerNumber = currentPlayerIndex + 1;
        int opponentPlayerNumber = currentPlayerNumber == 1 ? 2 : 1;
        String currentGroup = normalizeGroup(currentPlayerNumber == 1 ? room.getPlayer1Group() : room.getPlayer2Group());
        String opponentGroup = normalizeGroup(opponentPlayerNumber == 1 ? room.getPlayer1Group() : room.getPlayer2Group());
        int remainingGroupBefore = countRemaining(preBallState, currentGroup);
        String legalFirstTarget = currentGroup == null ? null : (remainingGroupBefore == 0 ? "eight" : currentGroup);
        String firstContactBallId = asString(report.get("firstContactBallId"));
        Map<String, Object> firstContactBall = finalById.get(firstContactBallId);
        String firstContactType = firstContactBall == null ? null : asString(firstContactBall.get("type"));
        int railContacts = asInt(report.get("railContacts"));
        boolean isBreakShot = room.isBreakShot();
        String foulMessage = "";
        String statusMessage;
        boolean ballInHand = false;
        String ballInHandZone = "table";
        Integer winner = null;
        int nextPlayerNumber = currentPlayerNumber;
        String resolvedGroup = currentGroup;

        if (eightPocketed) {
            boolean clearedGroup = currentGroup != null && remainingGroupBefore == 0;
            if (cuePocketed || !clearedGroup) {
                winner = opponentPlayerNumber;
                statusMessage = cuePocketed ? "黑八阶段白球落袋，直接负局" : "黑八提前入袋，直接负局";
            } else {
                winner = currentPlayerNumber;
                statusMessage = "玩家" + currentPlayerNumber + "打进黑八，赢下本局";
            }
        } else {
            if (isBreakShot) {
                boolean legalBreak = cuePocketed || !coloredPocketed.isEmpty() || railContacts >= 4;
                if (!legalBreak) {
                    foulMessage = "非法开球（需进球或至少4颗球碰库）";
                }
            }

            if (foulMessage.isEmpty() && cuePocketed) {
                foulMessage = "犯规：白球落袋";
            } else if (foulMessage.isEmpty() && firstContactType == null) {
                foulMessage = "犯规：未碰到任何球";
            } else if (foulMessage.isEmpty() && legalFirstTarget != null && !legalFirstTarget.equals(firstContactType)) {
                foulMessage = "eight".equals(legalFirstTarget) ? "犯规：必须先碰黑八" : "犯规：未先碰到目标球";
            } else if (foulMessage.isEmpty() && currentGroup == null && "eight".equals(firstContactType)) {
                foulMessage = "犯规：开放球局不能先碰黑八";
            }

            if (foulMessage.isEmpty() && currentGroup == null && !coloredPocketed.isEmpty()) {
                resolvedGroup = asString(coloredPocketed.get(0).get("type"));
                String otherGroup = "solid".equals(resolvedGroup) ? "stripe" : "solid";
                room.setPlayer1Group(currentPlayerNumber == 1 ? resolvedGroup : otherGroup);
                room.setPlayer2Group(currentPlayerNumber == 2 ? resolvedGroup : otherGroup);
                opponentGroup = otherGroup;
            }

            if (!foulMessage.isEmpty()) {
                nextPlayerNumber = opponentPlayerNumber;
                ballInHand = true;
                ballInHandZone = isBreakShot ? "kitchen" : "table";
                statusMessage = foulMessage;
            } else {
                String scoringGroup = resolvedGroup == null && !coloredPocketed.isEmpty()
                        ? asString(coloredPocketed.get(0).get("type"))
                        : resolvedGroup;
                long ownPocketed = scoringGroup == null
                        ? 0
                        : coloredPocketed.stream().filter(ball -> scoringGroup.equals(asString(ball.get("type")))).count();
                if (ownPocketed > 0) {
                    statusMessage = "玩家" + currentPlayerNumber + "继续击球";
                    nextPlayerNumber = currentPlayerNumber;
                } else {
                    statusMessage = "轮到玩家" + opponentPlayerNumber;
                    nextPlayerNumber = opponentPlayerNumber;
                }
                addScore(room, currentPlayerNumber, (int) ownPocketed);
            }
        }

        if (winner == null && ballInHand) {
            ensureCueBallVisible(finalBallState, ballInHandZone, false);
            calculatedHash = buildStateHash(finalBallState);
        }

        if (winner != null) {
            room.setStatus(BilliardsRoom.GameStatus.FINISHED);
            handleGameOverStats(room, winner);
            room.setExpireAt(0);
        } else {
            room.setStatus(BilliardsRoom.GameStatus.PLAYING);
            room.setCurrentTurnPlayerId(room.getPlayerIds().get(nextPlayerNumber - 1));
            room.setBallInHand(ballInHand);
            room.setBallInHandZone(ballInHand ? ballInHandZone : "table");
            room.setBreakShot(false);
            room.setTurnId(room.getTurnId() + 1);
            room.setStateVersion(room.getStateVersion() + 1);
            room.setStateHash(calculatedHash);
            room.setShotToken(newShotToken());
            room.setBallState(denormalizeBallState(finalBallState));
            room.setLastSettledBallState(room.getBallState());
            startTurnTimer(room);
        }

        if (winner != null) {
            room.setBallState(denormalizeBallState(finalBallState));
            room.setLastSettledBallState(room.getBallState());
            room.setStateVersion(room.getStateVersion() + 1);
            room.setStateHash(calculatedHash);
            room.setShotToken(newShotToken());
        }

        Map<String, Object> result = new HashMap<>();
        result.put("turnId", room.getTurnId());
        result.put("nextTurnId", room.getTurnId());
        result.put("stateVersion", room.getStateVersion());
        result.put("stateHash", room.getStateHash());
        result.put("nextShotToken", room.getShotToken());
        result.put("ballInHand", room.isBallInHand());
        result.put("ballInHandZone", room.getBallInHandZone());
        result.put("finalBallState", room.getBallState());
        result.put("currentPlayer", room.getPlayerIds().indexOf(room.getCurrentTurnPlayerId()) + 1);
        result.put("playerGroups", buildPlayerGroups(room));
        result.put("scores", buildScoreMap(room));
        result.put("winner", winner);
        result.put("isBreakShot", room.isBreakShot());
        result.put("statusMessage", statusMessage);
        result.put("statusRemainingMs", 2200);
        result.put("expireAt", room.getExpireAt());
        result.put("serverTime", System.currentTimeMillis());
        result.put("room", buildRoomSnapshot(room));
        log.info("adjudicateShot 结果: roomId={}, cuePocketed={}, firstContactType={}, foulMessage={}, ballInHand={}, ballInHandZone={}, nextPlayerNumber={}",
                room.getRoomId(),
                cuePocketed,
                firstContactType,
                foulMessage,
                ballInHand,
                ballInHandZone,
                nextPlayerNumber);
        return result;
    }

    private void rollbackResolvingRoom(BilliardsRoom room, String reason) {
        log.warn("执行 rollbackResolvingRoom: roomId={}, reason={}, pendingReportSenders={}",
                room.getRoomId(), reason, room.getPendingShotReports().keySet());
        turnTimerService.cancelTimer(room.getRoomId() + SHOT_FINALIZE_TIMER_SUFFIX);
        room.setPendingShotInput(null);
        room.getPendingShotReports().clear();
        room.setStatus(BilliardsRoom.GameStatus.PAUSED);
        if (room.getLastSettledBallState() != null) {
            room.setBallState(room.getLastSettledBallState());
        }
        room.setExpireAt(0);
        roomRepository.save(room);
        messagingTemplate.convertAndSend("/topic/room/" + room.getRoomId(), GameMessage.builder()
                .type(GameMessage.MessageType.ERROR)
                .roomId(room.getRoomId())
                .senderId("SYSTEM")
                .content(reason)
                .build());
        sendRoomSnapshot(room, null);
    }

    private boolean validateShotStart(BilliardsRoom room, String senderId, Map<String, Object> shotMap) {
        if (room.getStatus() != BilliardsRoom.GameStatus.PLAYING) {
            return false;
        }
        if (!senderId.equals(room.getCurrentTurnPlayerId())) {
            return false;
        }
        if (asLong(shotMap.get("turnId")) != room.getTurnId()) {
            return false;
        }
        if (asLong(shotMap.get("stateVersion")) != room.getStateVersion()) {
            return false;
        }
        if (!room.getShotToken().equals(asString(shotMap.get("shotToken")))) {
            return false;
        }
        double powerRatio = asDouble(shotMap.get("powerRatio"));
        if (Double.isNaN(powerRatio) || powerRatio < 0 || powerRatio > 1.0) {
            return false;
        }
        Map<String, Object> cueBallPos = asMap(shotMap.get("cueBallPos"));
        if (room.isBallInHand() && !isCueBallPlacementValid(cueBallPos, room.getBallInHandZone())) {
            return false;
        }
        return true;
    }

    private boolean isCueBallPlacementValid(Map<String, Object> cueBallPos, String zone) {
        double x = asDouble(cueBallPos.get("x"));
        double y = asDouble(cueBallPos.get("y"));
        double halfWidth = TABLE_WIDTH / 2.0 - PLAYABLE_AREA_INSET;
        double halfHeight = TABLE_HEIGHT / 2.0 - PLAYABLE_AREA_INSET;
        if (x < -halfWidth || x > halfWidth || y < -halfHeight || y > halfHeight) {
            return false;
        }
        return !"kitchen".equals(zone) || x <= HEAD_STRING_X;
    }

    private void startTurnTimer(BilliardsRoom room) {
        long now = System.currentTimeMillis();
        long expire = now + TURN_TIME_LIMIT * 1000L;
        room.setStatus(BilliardsRoom.GameStatus.PLAYING);
        room.setTurnStartTime(now);
        room.setExpireAt(expire);
        room.setShotToken(newShotToken());
        roomRepository.save(room);
        turnTimerService.startTimer(room.getRoomId(), TURN_TIME_LIMIT, () -> handleTurnTimeout(room.getRoomId()));
    }

    private void startPeriodicSync(String roomId) {
        turnTimerService.startPeriodicSync(roomId, SYNC_INTERVAL_MS, () ->
                roomRepository.findById(roomId).ifPresent(room -> messagingTemplate.convertAndSend(
                        "/topic/room/" + roomId,
                        GameMessage.builder()
                                .type(GameMessage.MessageType.SYNC_STATE)
                                .roomId(roomId)
                                .senderId("SYSTEM")
                                .content(Map.of(
                                        "room", buildRoomSnapshot(room),
                                        "expireAt", room.getExpireAt(),
                                        "serverTime", System.currentTimeMillis()
                                ))
                                .build()
                )));
    }

    private void handleTurnTimeout(String roomId) {
        roomRepository.findById(roomId).ifPresent(room -> {
            synchronized (room) {
                if (room.getStatus() == BilliardsRoom.GameStatus.RESOLVING) {
                    rollbackResolvingRoom(room, "本杆结算超时，已回退到上一稳定桌面");
                    return;
                }
                if (room.getPlayerIds().size() < 2 || room.getStatus() != BilliardsRoom.GameStatus.PLAYING) return;

                int currentIndex = room.getPlayerIds().indexOf(room.getCurrentTurnPlayerId());
                int nextIndex = (currentIndex + 1) % room.getPlayerIds().size();
                String nextPlayerId = room.getPlayerIds().get(nextIndex);
                room.setCurrentTurnPlayerId(nextPlayerId);
                room.setAwaitingSettledSync(false);
                room.setBallInHand(true);
                room.setBallInHandZone("table");
                startTurnTimer(room);
                roomRepository.save(room);

                messagingTemplate.convertAndSend("/topic/room/" + roomId, GameMessage.builder()
                        .type(GameMessage.MessageType.TURN_TIMEOUT)
                        .roomId(roomId)
                        .senderId("SYSTEM")
                        .content(buildRoomSnapshot(room))
                        .build());
            }
        });
    }

    private void pauseRoomForDisconnect(BilliardsRoom room, String playerId) {
        turnTimerService.cancelTimer(room.getRoomId());
        turnTimerService.cancelTimer(room.getRoomId() + SHOT_FINALIZE_TIMER_SUFFIX);
        room.setStatus(BilliardsRoom.GameStatus.PAUSED);
        room.setExpireAt(0);
        room.setPendingShotInput(null);
        room.getPendingShotReports().clear();
        if (room.getLastSettledBallState() != null) {
            room.setBallState(room.getLastSettledBallState());
        }
        roomRepository.save(room);
        messagingTemplate.convertAndSend("/topic/room/" + room.getRoomId(), GameMessage.builder()
                .type(GameMessage.MessageType.PLAYER_LEFT)
                .roomId(room.getRoomId())
                .senderId(playerId)
                .content(Map.of(
                        "room", buildRoomSnapshot(room),
                        "serverTime", System.currentTimeMillis()
                ))
                .build());
        sendRoomSnapshot(room, null);
    }

    private void resumePausedRoom(BilliardsRoom room) {
        room.setStatus(BilliardsRoom.GameStatus.PLAYING);
        room.setPendingShotInput(null);
        room.getPendingShotReports().clear();
        if (room.getLastSettledBallState() != null) {
            room.setBallState(room.getLastSettledBallState());
        }
        startTurnTimer(room);
        roomRepository.save(room);
        sendRoomSnapshot(room, null);
    }

    private boolean canJoinRequestedRoom(BilliardsRoom room, String requestedRoomId) {
        if (requestedRoomId == null || room.getPlayerIds().size() < 2) {
            return true;
        }
        if (room.getStatus() == BilliardsRoom.GameStatus.PAUSED && room.getPlayerIds().stream().noneMatch(WebSocketEventListener::isPlayerOnline)) {
            resetAbandonedRoomForReuse(room);
            return true;
        }
        return false;
    }

    private void resetAbandonedRoomForReuse(BilliardsRoom room) {
        turnTimerService.cancelTimer(room.getRoomId());
        turnTimerService.cancelTimer(room.getRoomId() + SHOT_FINALIZE_TIMER_SUFFIX);
        turnTimerService.cancelPeriodicSync(room.getRoomId());
        room.getPlayerIds().clear();
        room.getPlayerNames().clear();
        room.getRematchReadyPlayers().clear();
        room.setCurrentTurnPlayerId(null);
        room.setStatus(BilliardsRoom.GameStatus.WAITING);
        room.setTurnStartTime(0);
        room.setExpireAt(0);
        room.setServerTime(0);
        room.setBallState(null);
        room.setLastSettledBallState(null);
        room.setTurnId(1L);
        room.setStateVersion(1L);
        room.setStateHash("INITIAL");
        room.setShotToken(newShotToken());
        room.setBreakShot(true);
        room.setPendingShotInput(null);
        room.getPendingShotReports().clear();
        room.setLastShotId(null);
        room.setLastShotPlayerId(null);
        room.setLastShotStartedAt(0);
        room.setLastShotProtocol(null);
        room.setAwaitingSettledSync(false);
        room.setLastSettledAt(0);
        room.setLastSettledSignature(null);
        room.setBallInHand(false);
        room.setBallInHandZone("table");
        room.setPlayer1Score(0);
        room.setPlayer2Score(0);
        room.setPlayer1Group("OPEN");
        room.setPlayer2Group("OPEN");
        roomRepository.save(room);
        log.info("回收无人在线的暂停房间用于复用: roomId={}", room.getRoomId());
    }

    private void cleanupRoomAfterLeave(BilliardsRoom room) {
        turnTimerService.cancelTimer(room.getRoomId());
        turnTimerService.cancelTimer(room.getRoomId() + SHOT_FINALIZE_TIMER_SUFFIX);
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
                .content(buildRoomSnapshot(room))
                .build());
    }

    private void sendRoomSnapshot(BilliardsRoom room, String targetPlayerId) {
        GameMessage snapshot = GameMessage.builder()
                .type(GameMessage.MessageType.ROOM_SNAPSHOT)
                .roomId(room.getRoomId())
                .senderId("SYSTEM")
                .content(Map.of(
                        "room", buildRoomSnapshot(room),
                        "serverTime", System.currentTimeMillis()
                ))
                .build();
        if (targetPlayerId == null) {
            messagingTemplate.convertAndSend("/topic/room/" + room.getRoomId(), snapshot);
        } else {
            messagingTemplate.convertAndSend("/queue/player/" + targetPlayerId, snapshot);
        }
    }

    private Map<String, Object> buildRoomSnapshot(BilliardsRoom room) {
        Map<String, Object> roomSync = new LinkedHashMap<>();
        roomSync.put("roomId", room.getRoomId());
        roomSync.put("playerIds", room.getPlayerIds());
        roomSync.put("playerNames", room.getPlayerNames());
        roomSync.put("currentTurnPlayerId", room.getCurrentTurnPlayerId());
        roomSync.put("status", room.getStatus());
        roomSync.put("turnStartTime", room.getTurnStartTime());
        roomSync.put("expireAt", room.getExpireAt());
        roomSync.put("ballInHand", room.isBallInHand());
        roomSync.put("ballInHandZone", room.getBallInHandZone());
        roomSync.put("player1Score", room.getPlayer1Score());
        roomSync.put("player2Score", room.getPlayer2Score());
        roomSync.put("player1Group", room.getPlayer1Group());
        roomSync.put("player2Group", room.getPlayer2Group());
        roomSync.put("ballState", room.getBallState());
        roomSync.put("turnId", room.getTurnId());
        roomSync.put("stateVersion", room.getStateVersion());
        roomSync.put("stateHash", room.getStateHash());
        roomSync.put("shotToken", room.getShotToken());
        roomSync.put("isBreakShot", room.isBreakShot());
        return roomSync;
    }

    private Map<String, Object> buildPlayerGroups(BilliardsRoom room) {
        Map<String, Object> groups = new HashMap<>();
        groups.put("1", normalizeGroup(room.getPlayer1Group()));
        groups.put("2", normalizeGroup(room.getPlayer2Group()));
        return groups;
    }

    private Map<String, Object> buildScoreMap(BilliardsRoom room) {
        Map<String, Object> scores = new HashMap<>();
        scores.put("1", room.getPlayer1Score());
        scores.put("2", room.getPlayer2Score());
        return scores;
    }

    private void addScore(BilliardsRoom room, int playerNumber, int delta) {
        if (delta <= 0) return;
        if (playerNumber == 1) {
            room.setPlayer1Score(room.getPlayer1Score() + delta);
        } else {
            room.setPlayer2Score(room.getPlayer2Score() + delta);
        }
    }

    private String normalizeGroup(String group) {
        if (group == null || group.isBlank() || "OPEN".equalsIgnoreCase(group)) {
            return null;
        }
        return group.toLowerCase();
    }

    private int countRemaining(List<Map<String, Object>> balls, String group) {
        if (group == null) return 0;
        return (int) balls.stream()
                .filter(ball -> group.equals(asString(ball.get("type"))))
                .filter(ball -> !asBoolean(ball.get("pocketed")))
                .count();
    }

    private boolean validateBallState(List<Map<String, Object>> balls) {
        if (balls.isEmpty()) return true;
        Set<String> ids = new HashSet<>();
        double halfWidth = TABLE_WIDTH / 2.0 - PLAYABLE_AREA_INSET;
        double halfHeight = TABLE_HEIGHT / 2.0 - PLAYABLE_AREA_INSET;

        for (Map<String, Object> ball : balls) {
            if (!ids.add(asString(ball.get("id")))) {
                return false;
            }
            if (asBoolean(ball.get("pocketed"))) {
                continue;
            }
            double x = asDouble(ball.get("x"));
            double y = asDouble(ball.get("y"));
            if (x < -halfWidth || x > halfWidth || y < -halfHeight || y > halfHeight) {
                return false;
            }
        }

        for (int i = 0; i < balls.size(); i++) {
            Map<String, Object> first = balls.get(i);
            if (asBoolean(first.get("pocketed"))) continue;
            for (int j = i + 1; j < balls.size(); j++) {
                Map<String, Object> second = balls.get(j);
                if (asBoolean(second.get("pocketed"))) continue;
                double dx = asDouble(first.get("x")) - asDouble(second.get("x"));
                double dy = asDouble(first.get("y")) - asDouble(second.get("y"));
                double distSq = dx * dx + dy * dy;
                if (distSq < Math.pow(BALL_RADIUS * 2 - 1.0, 2)) {
                    return false;
                }
            }
        }
        return true;
    }

    private List<Map<String, Object>> normalizeBallState(List<?> rawBalls) {
        if (rawBalls == null) return new ArrayList<>();
        List<Map<String, Object>> normalized = new ArrayList<>();
        for (Object rawBall : rawBalls) {
            Map<String, Object> ball = asMap(rawBall);
            String type = asString(ball.get("type"));
            String label = asString(ball.get("label"));
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("id", (ball.containsKey("id") ? asString(ball.get("id")) : type + ":" + (label == null || label.isBlank() ? type : label)));
            item.put("type", type);
            item.put("label", label);
            item.put("x", quantize(asDouble(ball.get("x"))) / (double) BALL_STATE_PRECISION);
            item.put("y", quantize(asDouble(ball.get("y"))) / (double) BALL_STATE_PRECISION);
            item.put("vx", quantize(asDouble(ball.get("vx"))) / (double) BALL_STATE_PRECISION);
            item.put("vy", quantize(asDouble(ball.get("vy"))) / (double) BALL_STATE_PRECISION);
            item.put("pocketed", asBoolean(ball.get("pocketed")));
            normalized.add(item);
        }
        normalized.sort(Comparator.comparing(ball -> asString(ball.get("id"))));
        return normalized;
    }

    private List<?> extractBallState(Object ballStatePayload) {
        if (ballStatePayload instanceof Map<?, ?> map && map.get("balls") instanceof List<?> balls) {
            return balls;
        }
        if (ballStatePayload instanceof List<?> balls) {
            return balls;
        }
        return new ArrayList<>();
    }

    private String buildStateHash(List<Map<String, Object>> balls) {
        return balls.stream()
                .map(ball -> String.join(":",
                        asString(ball.get("id")),
                        String.valueOf(quantize(asDouble(ball.get("x")))),
                        String.valueOf(quantize(asDouble(ball.get("y")))),
                        String.valueOf(quantize(asDouble(ball.get("vx")))),
                        String.valueOf(quantize(asDouble(ball.get("vy")))),
                        asBoolean(ball.get("pocketed")) ? "1" : "0"))
                .collect(Collectors.joining("|"));
    }

    private void ensureCueBallVisible(List<Map<String, Object>> balls, String ballInHandZone, boolean preserveSubmittedPosition) {
        double halfWidth = TABLE_WIDTH / 2.0 - PLAYABLE_AREA_INSET;
        double halfHeight = TABLE_HEIGHT / 2.0 - PLAYABLE_AREA_INSET;
        double fallbackX = "kitchen".equals(ballInHandZone) ? (double) HEAD_STRING_X : (double) -TABLE_WIDTH / 4;
        double fallbackY = 0.0;
        for (Map<String, Object> ball : balls) {
            if (!"cue".equals(asString(ball.get("type")))) continue;
            ball.put("pocketed", false);
            double x = asDouble(ball.get("x"));
            double y = asDouble(ball.get("y"));
            boolean validPosition = x >= -halfWidth && x <= halfWidth && y >= -halfHeight && y <= halfHeight
                    && (!"kitchen".equals(ballInHandZone) || x <= HEAD_STRING_X);
            if (!preserveSubmittedPosition || !validPosition) {
                ball.put("x", fallbackX);
                ball.put("y", fallbackY);
            }
            ball.put("vx", 0.0);
            ball.put("vy", 0.0);
            return;
        }
    }

    private List<Map<String, Object>> denormalizeBallState(List<Map<String, Object>> balls) {
        return balls.stream().map(ball -> {
            Map<String, Object> copy = new LinkedHashMap<>(ball);
            copy.remove("id");
            return copy;
        }).collect(Collectors.toList());
    }

    private Map<String, Map<String, Object>> indexById(List<Map<String, Object>> balls) {
        return balls.stream().collect(Collectors.toMap(ball -> asString(ball.get("id")), ball -> ball, (a, b) -> a, LinkedHashMap::new));
    }

    private int quantize(double value) {
        return (int) Math.round(value * BALL_STATE_PRECISION);
    }

    private Map<String, Object> asMap(Object value) {
        if (!(value instanceof Map<?, ?> map)) {
            return new LinkedHashMap<>();
        }

        Map<String, Object> normalized = new LinkedHashMap<>();
        for (Map.Entry<?, ?> entry : map.entrySet()) {
            normalized.put(String.valueOf(entry.getKey()), entry.getValue());
        }
        return normalized;
    }

    private List<?> asList(Object value) {
        return value instanceof List<?> list ? list : new ArrayList<>();
    }

    private List<String> normalizeStringList(List<?> value) {
        return value.stream()
                .map(String::valueOf)
                .sorted()
                .collect(Collectors.toList());
    }

    private String asString(Object value) {
        return value == null ? "" : String.valueOf(value);
    }

    private boolean asBoolean(Object value) {
        return value instanceof Boolean bool && bool;
    }

    private int asInt(Object value) {
        return value instanceof Number number ? number.intValue() : 0;
    }

    private long asLong(Object value) {
        return value instanceof Number number ? number.longValue() : 0L;
    }

    private double asDouble(Object value) {
        return value instanceof Number number ? number.doubleValue() : 0.0;
    }

    private String newShotToken() {
        return UUID.randomUUID().toString();
    }

    private String resolveDisplayName(String playerId, String nickname) {
        if (nickname != null && !nickname.isBlank()) return nickname.trim();
        return "玩家-" + (playerId.length() > 4 ? playerId.substring(playerId.length() - 4) : playerId);
    }

    private void sendError(BilliardsRoom room, String targetPlayerId, String code, String message) {
        Map<String, Object> payload = new HashMap<>();
        payload.put("code", code);
        payload.put("message", message);
        payload.put("room", buildRoomSnapshot(room));
        payload.put("serverTime", System.currentTimeMillis());

        GameMessage errorMessage = GameMessage.builder()
                .type(GameMessage.MessageType.ERROR)
                .roomId(room.getRoomId())
                .senderId("SYSTEM")
                .content(payload)
                .build();
        messagingTemplate.convertAndSend("/queue/player/" + targetPlayerId, errorMessage);
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
