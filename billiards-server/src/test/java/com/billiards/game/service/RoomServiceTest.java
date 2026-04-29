package com.billiards.game.service;

import com.billiards.game.model.BilliardsRoom;
import com.billiards.game.repository.RoomRepository;
import com.billiards.game.timer.TurnTimerService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.MockitoAnnotations;
import org.springframework.messaging.simp.SimpMessagingTemplate;

import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;
import static org.junit.jupiter.api.Assertions.*;

/**
 * RoomService 单元测试类
 * 验证房间加入、断开、再来一局等核心业务逻辑
 */
class RoomServiceTest {

    @Mock
    private SimpMessagingTemplate messagingTemplate;

    @Mock
    private RoomRepository roomRepository;

    @Mock
    private TurnTimerService turnTimerService;

    @InjectMocks
    private RoomService roomService;

    @BeforeEach
    void setUp() {
        // 初始化 Mockito 注解
        MockitoAnnotations.openMocks(this);
    }

    /**
     * 测试玩家掉线时，是否能正确从房间中移除（在非对局状态下）
     */
    @Test
    void disconnectRemovesPlayerFromRoom() {
        BilliardsRoom room = new BilliardsRoom();
        room.setStatus(BilliardsRoom.GameStatus.WAITING);
        room.getPlayerIds().add("p1");
        room.getPlayerIds().add("p2");

        // 模拟仓库返回该房间
        when(roomRepository.findAll()).thenReturn(java.util.List.of(room));

        roomService.handleDisconnect("p1");

        // 验证玩家已从列表中移除
        assertFalse(room.getPlayerIds().contains("p1"));
        // 验证房间状态被保存
        verify(roomRepository, atLeastOnce()).save(room);
    }

    /**
     * 测试“再来一局”逻辑
     * 验证当两名玩家都准备好时，是否重置了游戏并重新开启了计时器
     */
    @Test
    void rematchClearsPreviousRoomTimerBeforeSchedulingNewOne() {
        BilliardsRoom room = new BilliardsRoom();
        room.setRoomId("ROOM1");
        room.getPlayerIds().add("p1");
        room.getPlayerIds().add("p2");
        room.setStatus(BilliardsRoom.GameStatus.PLAYING);
        room.getRematchReadyPlayers().add("p2");

        when(roomRepository.findById("ROOM1")).thenReturn(Optional.of(room));

        roomService.processRematch("p1", "ROOM1");

        // 验证是否调用了取消旧计时器的方法
        verify(turnTimerService).cancelTimer("ROOM1");
        // 验证是否开启了新的一局计时
        verify(turnTimerService, atLeastOnce()).startTimer(eq("ROOM1"), anyInt(), any());
        // 验证比分是否重置
        assertEquals(0, room.getPlayer1Score());
    }

    /**
     * 测试当房间已满（2人）时，第3名玩家尝试加入应被拒绝
     */
    @Test
    void joiningFullRequestedRoomKeepsRoomAtTwoPlayers() {
        BilliardsRoom room = new BilliardsRoom();
        room.setRoomId("ROOM1234");
        room.getPlayerIds().add("p1");
        room.getPlayerIds().add("p2");
        room.setStatus(BilliardsRoom.GameStatus.PLAYING);

        when(roomRepository.findById("ROOM1234")).thenReturn(Optional.of(room));
        when(roomRepository.findAll()).thenReturn(java.util.List.of(room));

        roomService.processJoin("p3", "ROOM1234", "访客");

        // 验证第3人未被加入
        assertFalse(room.getPlayerIds().contains("p3"));
        assertEquals(2, room.getPlayerIds().size());
        // 验证发送了错误消息给玩家 p3
        verify(messagingTemplate).convertAndSend(eq("/queue/player/p3"), (Object) any());
    }

    /**
     * 测试加入房间时，玩家昵称是否被正确解析并存储
     */
    @Test
    void joinStoresPlayerNicknameInRoomState() {
        BilliardsRoom room = new BilliardsRoom();
        room.setRoomId("ROOM1234");
        
        when(roomRepository.findById("ROOM1234")).thenReturn(Optional.of(room));
        when(roomRepository.findAll()).thenReturn(new ArrayList<>());

        roomService.processJoin("p1", "ROOM1234", "小明");

        // 验证昵称已存入映射
        assertEquals("小明", room.getPlayerNames().get("p1"));
    }

    @Test
    @SuppressWarnings("unchecked")
    void adjudicateShotRespawnsCueBallWhenFoulGrantsBallInHand() throws Exception {
        BilliardsRoom room = new BilliardsRoom();
        room.setRoomId("ROOM1");
        room.getPlayerIds().add("p1");
        room.getPlayerIds().add("p2");
        room.setStatus(BilliardsRoom.GameStatus.PLAYING);
        room.setCurrentTurnPlayerId("p1");
        room.setBreakShot(false);
        room.setTurnId(7L);
        room.setStateVersion(11L);
        room.setPlayer1Group("OPEN");
        room.setPlayer2Group("OPEN");

        List<Map<String, Object>> settledState = List.of(
                ball("cue", "cue", 24.0, 0.0, 0.0, 0.0, false),
                ball("1", "solid", 140.0, 0.0, 0.0, 0.0, false));
        room.setLastSettledBallState(settledState);

        List<Map<String, Object>> reportedFinalState = List.of(
                ball("cue", "cue", 360.0, 160.0, 0.0, 0.0, true),
                ball("1", "solid", 140.0, 0.0, 0.0, 0.0, false));

        Method buildStateHash = RoomService.class.getDeclaredMethod("buildStateHash", List.class);
        buildStateHash.setAccessible(true);
        String reportedHash = (String) buildStateHash.invoke(roomService, reportedFinalState);

        Map<String, Object> report = new LinkedHashMap<>();
        report.put("finalBallState", reportedFinalState);
        report.put("finalStateHash", reportedHash);
        report.put("railContacts", 1);
        report.put("firstContactBallId", "1");

        Method adjudicateShot = RoomService.class.getDeclaredMethod("adjudicateShot", BilliardsRoom.class, Map.class);
        adjudicateShot.setAccessible(true);
        Map<String, Object> result = (Map<String, Object>) adjudicateShot.invoke(roomService, room, report);

        assertNotNull(result);
        assertEquals(true, result.get("ballInHand"));
        assertEquals("table", result.get("ballInHandZone"));

        List<Map<String, Object>> finalBallState = (List<Map<String, Object>>) result.get("finalBallState");
        Map<String, Object> cueBall = finalBallState.stream()
                .filter(ball -> "cue".equals(ball.get("type")))
                .findFirst()
                .orElseThrow();

        assertEquals(false, cueBall.get("pocketed"));
        assertEquals(-205.0, ((Number) cueBall.get("x")).doubleValue());
        assertEquals(0.0, ((Number) cueBall.get("y")).doubleValue());
        assertEquals(0.0, ((Number) cueBall.get("vx")).doubleValue());
        assertEquals(0.0, ((Number) cueBall.get("vy")).doubleValue());

        List<Map<String, Object>> expectedResolvedState = List.of(
                ball("cue", "cue", -205.0, 0.0, 0.0, 0.0, false),
                ball("1", "solid", 140.0, 0.0, 0.0, 0.0, false));
        String expectedHash = (String) buildStateHash.invoke(roomService, expectedResolvedState);
        assertEquals(expectedHash, result.get("stateHash"));
    }

    private static Map<String, Object> ball(String id, String type, double x, double y, double vx, double vy, boolean pocketed) {
        Map<String, Object> ball = new LinkedHashMap<>();
        ball.put("id", id);
        ball.put("type", type);
        ball.put("x", x);
        ball.put("y", y);
        ball.put("vx", vx);
        ball.put("vy", vy);
        ball.put("pocketed", pocketed);
        return ball;
    }
}
