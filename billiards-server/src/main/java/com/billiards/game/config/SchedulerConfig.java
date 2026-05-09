package com.billiards.game.config;

import com.billiards.game.model.BilliardsRoom;
import com.billiards.game.service.RoomService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;

import java.util.List;
import java.util.stream.Collectors;

/**
 * [描述] 定时任务配置
 * 负责定期清理长期废弃的 PAUSED 房间，释放资源供新玩家使用
 */
@Configuration
@EnableScheduling
public class SchedulerConfig {

    private static final Logger log = LoggerFactory.getLogger(SchedulerConfig.class);

    // 房间被视为废弃的阈值：5分钟
    private static final long ABANDONED_THRESHOLD_MS = 5 * 60 * 1000L;

    @Autowired
    private ObjectProvider<RoomService> roomServiceProvider;

    @Bean
    public ThreadPoolTaskScheduler taskScheduler() {
        ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
        scheduler.setPoolSize(5);
        scheduler.setThreadNamePrefix("BilliardsTimer-");
        return scheduler;
    }

    /**
     * 每5分钟执行一次，清理废弃的 PAUSED 房间
     * 条件：房间状态为 PAUSED 且所有玩家都不在线，且已暂停超过5分钟
     */
    @Scheduled(fixedDelay = 5 * 60 * 1000L, initialDelay = 60 * 1000L)
    public void cleanupAbandonedRooms() {
        try {
            RoomService roomService = roomServiceProvider.getIfAvailable();
            if (roomService == null) {
                log.debug("Cleanup scheduler: RoomService is not ready");
                return;
            }

            List<BilliardsRoom> abandonedRooms = roomService.findAbandonedPausedRooms(ABANDONED_THRESHOLD_MS);
            
            if (abandonedRooms.isEmpty()) {
                log.debug("Cleanup scheduler: no abandoned rooms found");
                return;
            }
            
            log.info("Cleanup scheduler: found {} abandoned room(s) to reset: {}", 
                    abandonedRooms.size(),
                    abandonedRooms.stream().map(BilliardsRoom::getRoomId).collect(Collectors.toList()));
            
            for (BilliardsRoom room : abandonedRooms) {
                roomService.resetAbandonedRoomForReuse(room);
            }
            
            log.info("Cleanup scheduler: successfully reset {} abandoned room(s)", abandonedRooms.size());
        } catch (Exception e) {
            log.error("Error during abandoned room cleanup", e);
        }
    }
}
