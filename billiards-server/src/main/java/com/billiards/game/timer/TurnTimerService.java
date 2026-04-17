package com.billiards.game.timer;

/**
 * [描述] 游戏计时服务接口
 * 定义回合计时控制和高频状态同步的标准化操作接口。
 */
public interface TurnTimerService {
    void startTimer(String roomId, int seconds, Runnable onTimeout);
    void cancelTimer(String roomId);
    void startPeriodicSync(String roomId, long intervalMs, Runnable onSync);
    void cancelPeriodicSync(String roomId);
}
