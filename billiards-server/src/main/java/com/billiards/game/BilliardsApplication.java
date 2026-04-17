package com.billiards.game;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * [描述] 台球游戏后端服务入口类
 * 负责启动 Spring Boot 框架，初始化整个应用的上下文环境。
 */
@SpringBootApplication
public class BilliardsApplication {
    public static void main(String[] args) {
        SpringApplication.run(BilliardsApplication.class, args);
    }
}
