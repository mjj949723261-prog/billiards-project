package com.billiards.game.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;

/**
 * [描述] 任务调度器配置类
 * 为游戏中的异步定时任务（如回合倒计时、周期性状态同步）提供线程池支持，确保高性能的任务调度。
 */
@Configuration
public class SchedulerConfig {

    @Bean
    public ThreadPoolTaskScheduler taskScheduler() {
        ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
        scheduler.setPoolSize(5); 
        scheduler.setThreadNamePrefix("BilliardsTimer-");
        return scheduler;
    }
}
