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

import java.util.ArrayList;
import java.util.Comparator;
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
                startPeriodicSync(room.getRoomId());
                notifyGameStart(room);
                sendRoomSnapshot(room, null);
            } else if (room.getStatus() == BilliardsRoom.GameStatus.PAUSED) {
                resumePausedRoom(room);
            } else if (room.getStatus() == BilliardsRoom.GameStatus.PLAYING || room.getStatus() == BilliardsRoom.GameStatus.RESOLVING) {
                sendRoomSnapshot(room, playerId);
            }
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
            Map<String, Object> shotMap = asMap(content);
            if (!validateShotStart(room, senderId, shotMap)) {
                sendError(roomId, senderId, "当前不能出杆");
                return;
            }

            room.setStatus(BilliardsRoom.GameStatus.RESOLVING);
            room.setPendingShotInput(shotMap);
            room.getPendingShotReports().clear();
            turnTimerService.cancelTimer(roomId);
            room.setExpireAt(0);
            roomRepository.save(room);

            Map<String, Object> payload = new HashMap<>();
            payload.put("shot", shotMap);
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

    public synchronized void processShotEndReport(String roomId, String senderId, Object content) {
        roomRepository.findById(roomId).ifPresent(room -> {
            if (room.getStatus() != BilliardsRoom.GameStatus.RESOLVING) {
                return;
            }
            Map<String, Object> report = asMap(content);
            if (report.isEmpty()) {
                return;
            }
            room.getPendingShotReports().put(senderId, report);
            roomRepository.save(room);

            if (room.getPendingShotReports().size() >= 2) {
                turnTimerService.cancelTimer(roomId + SHOT_FINALIZE_TIMER_SUFFIX);
                finalizeShotFromAvailableReports(roomId);
            } else {
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

    /**
     * 兼容保留：只允许白球在手阶段的 live 摆放预览和稳定快照恢复。
     */
    public synchronized void syncRoomState(String roomId, String senderId, Object content) {
        roomRepository.findById(roomId).ifPresent(room -> {
            if (senderId != null && !senderId.equals(room.getCurrentTurnPlayerId())) {
                return;
            }

            Map<String, Object> contentMap = asMap(content);
            boolean isLive = asBoolean(contentMap.get("isLive"));
            boolean ballInHand = asBoolean(contentMap.get("ballInHand"));

            if (isLive && ballInHand) {
                room.setBallState(content);
                room.setBallInHand(true);
                room.setBallInHandZone(asString(contentMap.getOrDefault("ballInHandZone", "table")));
                roomRepository.save(room);
                return;
            }

            if (!isLive && ballInHand) {
                room.setBallState(content);
                room.setLastSettledBallState(content);
                room.setStateHash(asString(contentMap.getOrDefault("stateHash", room.getStateHash())));
                roomRepository.save(room);
            }
        });
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
                    return;
                }

                Map<String, Object> chosenReport = chooseReport(room);
                if (chosenReport == null) {
                    rollbackResolvingRoom(room, "本杆结果冲突，已回退到上一稳定桌面");
                    return;
                }

                Map<String, Object> result = adjudicateShot(room, chosenReport);
                if (result == null) {
                    rollbackResolvingRoom(room, "本杆结果未通过轻量校验");
                    return;
                }

                room.setPendingShotInput(null);
                room.getPendingShotReports().clear();
                turnTimerService.cancelTimer(roomId + SHOT_FINALIZE_TIMER_SUFFIX);
                roomRepository.save(room);

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
            return null;
        }
        if (room.getPendingShotReports().size() == 1) {
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

        if (reportsCompatible(first, second)) {
            return first;
        }
        return null;
    }

    private boolean reportsCompatible(Map<String, Object> first, Map<String, Object> second) {
        return asString(first.get("firstContactBallId")).equals(asString(second.get("firstContactBallId")))
                && asBoolean(first.get("cuePocketed")) == asBoolean(second.get("cuePocketed"))
                && asBoolean(first.get("eightPocketed")) == asBoolean(second.get("eightPocketed"))
                && asInt(first.get("railContacts")) == asInt(second.get("railContacts"))
                && asString(first.get("finalStateHash")).equals(asString(second.get("finalStateHash")));
    }

    private Map<String, Object> adjudicateShot(BilliardsRoom room, Map<String, Object> report) {
        List<Map<String, Object>> finalBallState = normalizeBallState(asList(report.get("finalBallState")));
        if (!validateBallState(finalBallState)) {
            return null;
        }

        List<Map<String, Object>> preBallState = normalizeBallState(extractBallState(room.getLastSettledBallState()));
        if (!preBallState.isEmpty() && preBallState.size() != finalBallState.size()) {
            return null;
        }

        String calculatedHash = buildStateHash(finalBallState);
        if (!calculatedHash.equals(asString(report.get("finalStateHash")))) {
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
        return result;
    }

    private void rollbackResolvingRoom(BilliardsRoom room, String reason) {
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
                if (room.getPlayerIds().size() < 2 || room.getStatus() != BilliardsRoom.GameStatus.PLAYING) return;

                int currentIndex = room.getPlayerIds().indexOf(room.getCurrentTurnPlayerId());
                int nextIndex = (currentIndex + 1) % room.getPlayerIds().size();
                String nextPlayerId = room.getPlayerIds().get(nextIndex);
                room.setCurrentTurnPlayerId(nextPlayerId);
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
        return value instanceof Map<?, ?> map
                ? map.entrySet().stream().collect(Collectors.toMap(
                        entry -> String.valueOf(entry.getKey()),
                        Map.Entry::getValue,
                        (first, second) -> second,
                        LinkedHashMap::new))
                : new LinkedHashMap<>();
    }

    private List<?> asList(Object value) {
        return value instanceof List<?> list ? list : new ArrayList<>();
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

    private void sendError(String roomId, String targetPlayerId, String message) {
        GameMessage errorMessage = GameMessage.builder()
                .type(GameMessage.MessageType.ERROR)
                .roomId(roomId)
                .senderId("SYSTEM")
                .content(message)
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
