package com.billiards.game.model;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * [描述] 台球房间数据模型
 * 维护对局的实时核心状态，包括玩家信息、当前出杆者、物理球位、比分、球组分配以及游戏进度等。
 */
public class BilliardsRoom {
    /** 房间唯一标识符 (8位短ID) */
    private String roomId;
    
    /** 房间内的玩家ID列表 (通常上限为2人) */
    private List<String> playerIds = new ArrayList<>();
    
    /** 玩家ID到昵称的映射，使用 LinkedHashMap 保持加入顺序 */
    private Map<String, String> playerNames = new LinkedHashMap<>();
    
    /** 当前正在进行出杆操作的玩家ID */
    private String currentTurnPlayerId;
    
    /** 房间当前的游戏状态 (等待中、进行中、已结束) */
    private GameStatus status = GameStatus.WAITING;
    
    /** 当前回合开始的时间戳 (毫秒) */
    private long turnStartTime;
    
    /** 当前回合结束/超时的绝对时间戳 (用于前端倒计时显示) */
    private long expireAt;
    
    /** 服务端当前时间戳 (用于客户端对齐时钟) */
    private long serverTime;
    
    /** 球的物理状态数据 (存储所有球的坐标、速度、是否入袋等，通常为 Map 结构) */
    private Object ballState;
    
    /** 是否处于“自由球”状态 (母球可以被玩家手动移动) */
    private boolean ballInHand = false;
    
    /** 自由球可放置的区域 (如 "table" 全场, "kitchen" 发球区) */
    private String ballInHandZone = "table";
    
    /** 玩家1的累计得分 */
    private int player1Score = 0;
    
    /** 玩家2的累计得分 */
    private int player2Score = 0;
    
    /** 玩家1所属的球组 (OPEN: 未定, SOLIDS: 全色/小花, STRIPES: 花色/大花) */
    private String player1Group = "OPEN"; 
    
    /** 玩家2所属的球组 */
    private String player2Group = "OPEN";
    
    /** 已经发送“再来一局”请求的玩家ID列表 */
    private List<String> rematchReadyPlayers = new ArrayList<>();
    
    /** 房间最大玩家容量限制 */
    private static final int MAX_PLAYERS = 2;

    /**
     * 构造函数
     * 初始化房间时自动生成一个唯一的 8 位短字符串作为 RoomID
     */
    public BilliardsRoom() {
        this.roomId = UUID.randomUUID().toString().substring(0, 8);
    }

    /**
     * 将玩家添加进房间
     * @param playerId 玩家的唯一标识
     * @return 如果加入成功返回 true，如果房间已满或已在房间内返回 false (或重复处理)
     */
    public synchronized boolean addPlayer(String playerId) {
        // 如果玩家已在列表中，视为重连，直接返回成功
        if (playerIds.contains(playerId)) return true;
        
        // 检查房间人数是否已满
        if (playerIds.size() < MAX_PLAYERS) {
            playerIds.add(playerId);
            // 当人满(2人)时，自动将状态切换为正在对局，并随机/顺序指定第一个出杆者
            if (playerIds.size() == MAX_PLAYERS) {
                this.status = GameStatus.PLAYING;
                this.currentTurnPlayerId = playerIds.get(0); 
                this.turnStartTime = System.currentTimeMillis();
            }
            return true;
        }
        return false;
    }

    /**
     * 重置对局状态
     * 用于在一局结束后重新开启下一局。清空比分、球组分配和物理状态，保留玩家。
     */
    public synchronized void resetGame() {
        this.status = GameStatus.PLAYING;
        // 默认让第一名玩家先开球
        this.currentTurnPlayerId = playerIds.get(0); 
        this.turnStartTime = System.currentTimeMillis();
        this.player1Score = 0;
        this.player2Score = 0;
        this.player1Group = "OPEN";
        this.player2Group = "OPEN";
        this.ballState = null;
        this.rematchReadyPlayers.clear();
    }

    // --- 标准 Getter 和 Setter 方法 ---

    public String getRoomId() { return roomId; }
    public void setRoomId(String roomId) { this.roomId = roomId; }

    public List<String> getPlayerIds() { return playerIds; }
    public void setPlayerIds(List<String> playerIds) { this.playerIds = playerIds; }

    public Map<String, String> getPlayerNames() { return playerNames; }
    public void setPlayerNames(Map<String, String> playerNames) { this.playerNames = playerNames; }

    public String getCurrentTurnPlayerId() { return currentTurnPlayerId; }
    public void setCurrentTurnPlayerId(String currentTurnPlayerId) { this.currentTurnPlayerId = currentTurnPlayerId; }

    public GameStatus getStatus() { return status; }
    public void setStatus(GameStatus status) { this.status = status; }

    public long getTurnStartTime() { return turnStartTime; }
    public void setTurnStartTime(long turnStartTime) { this.turnStartTime = turnStartTime; }

    public long getExpireAt() { return expireAt; }
    public void setExpireAt(long expireAt) { this.expireAt = expireAt; }

    public long getServerTime() { return serverTime; }
    public void setServerTime(long serverTime) { this.serverTime = serverTime; }

    public Object getBallState() { return ballState; }
    public void setBallState(Object ballState) { this.ballState = ballState; }

    public boolean isBallInHand() { return ballInHand; }
    public void setBallInHand(boolean ballInHand) { this.ballInHand = ballInHand; }

    public String getBallInHandZone() { return ballInHandZone; }
    public void setBallInHandZone(String ballInHandZone) { this.ballInHandZone = ballInHandZone; }

    public int getPlayer1Score() { return player1Score; }
    public void setPlayer1Score(int player1Score) { this.player1Score = player1Score; }

    public int getPlayer2Score() { return player2Score; }
    public void setPlayer2Score(int player2Score) { this.player2Score = player2Score; }

    public String getPlayer1Group() { return player1Group; }
    public void setPlayer1Group(String player1Group) { this.player1Group = player1Group; }

    public String getPlayer2Group() { return player2Group; }
    public void setPlayer2Group(String player2Group) { this.player2Group = player2Group; }

    public List<String> getRematchReadyPlayers() { return rematchReadyPlayers; }
    public void setRematchReadyPlayers(List<String> rematchReadyPlayers) { this.rematchReadyPlayers = rematchReadyPlayers; }

    /**
     * 游戏状态枚举类
     */
    public enum GameStatus {
        /** 等待玩家加入 */
        WAITING, 
        /** 对局正在进行中 */
        PLAYING, 
        /** 对局已结算完成 */
        FINISHED
    }
}
