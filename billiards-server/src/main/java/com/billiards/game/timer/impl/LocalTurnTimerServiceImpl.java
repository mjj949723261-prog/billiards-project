package com.billiards.game.timer.impl;

import com.billiards.game.timer.TurnTimerService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;
import org.springframework.stereotype.Service;

import java.util.Date;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ScheduledFuture;

/**
 * [描述] 基于 Spring 调度器的计时服务实现
 * 利用 ThreadPoolTaskScheduler 管理每个房间的独立异步任务，确保倒计时和状态同步的精确性与隔离性。
 */
@Service
public class LocalTurnTimerServiceImpl implements TurnTimerService {

    /** 注入 Spring 容器配置好的线程池任务调度器，用于执行延时和定时任务 */
    @Autowired
    private ThreadPoolTaskScheduler taskScheduler;

    /** 
     * 存储每个房间正在运行的“回合倒计时”任务句柄 (ScheduledFuture)
     * Key: 房间ID
     * Value: 任务引用，用于后续手动取消任务
     */
    private final Map<String, ScheduledFuture<?>> timers = new ConcurrentHashMap<>();
    
    /** 
     * 存储每个房间正在运行的“周期性状态同步”任务句柄
     * Key: 房间ID
     * Value: 任务引用，用于停止高频心跳广播
     */
    private final Map<String, ScheduledFuture<?>> syncTasks = new ConcurrentHashMap<>();

    /**
     * 为指定房间启动一个单次执行的倒计时任务（回合限时）
     * @param roomId 房间ID
     * @param seconds 倒计时秒数
     * @param onTimeout 倒计时结束（超时）后要执行的回调逻辑
     */
    @Override
    public void startTimer(String roomId, int seconds, Runnable onTimeout) {
        // 开启新计时前，先尝试取消该房间可能已存在的旧计时器
        cancelTimer(roomId);
        
        // 计算触发时间并调度任务
        ScheduledFuture<?> future = taskScheduler.schedule(onTimeout, 
            new Date(System.currentTimeMillis() + seconds * 1000L));
        
        // 存入 Map 以便管理
        timers.put(roomId, future);
    }

    /**
     * 立即取消指定房间的回合倒计时任务
     * 通常在玩家于限时内完成击球操作时调用
     * @param roomId 房间ID
     */
    @Override
    public void cancelTimer(String roomId) {
        ScheduledFuture<?> future = timers.remove(roomId);
        if (future != null) {
            // 参数 false 表示不强制中断正在执行的任务，仅取消排队任务
            future.cancel(false);
        }
    }

    /**
     * 启动针对房间的高频周期性同步广播
     * @param roomId 房间ID
     * @param intervalMs 广播频率 (毫秒)
     * @param onSync 执行广播的具体逻辑
     */
    @Override
    public void startPeriodicSync(String roomId, long intervalMs, Runnable onSync) {
        // 同样先清理旧的同步任务，防止同一个房间开启多个心跳
        cancelPeriodicSync(roomId);
        
        // 以固定频率执行同步广播
        ScheduledFuture<?> future = taskScheduler.scheduleAtFixedRate(onSync, intervalMs);
        syncTasks.put(roomId, future);
    }

    /**
     * 停止指定房间的周期性同步广播
     * 通常在房间解散或玩家全部离开时调用，节省服务器资源
     * @param roomId 房间ID
     */
    @Override
    public void cancelPeriodicSync(String roomId) {
        ScheduledFuture<?> future = syncTasks.remove(roomId);
        if (future != null) {
            future.cancel(false);
        }
    }
}
