-- 1. 创建数据库
CREATE DATABASE IF NOT EXISTS billiards CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE billiards;

-- 2. 清理旧表（确保重新初始化）
SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS `match_history`;
DROP TABLE IF EXISTS `user_stats`;
DROP TABLE IF EXISTS `users`;
SET FOREIGN_KEY_CHECKS = 1;

-- 3. 创建用户表
CREATE TABLE `users` (
  `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT '永久唯一ID',
  `username` VARCHAR(32) NOT NULL UNIQUE COMMENT '登录账号',
  `password` VARCHAR(255) NOT NULL COMMENT '加密后的密码',
  `nickname` VARCHAR(32) NOT NULL COMMENT '显示昵称',
  `email` VARCHAR(64) DEFAULT NULL UNIQUE COMMENT '邮箱',
  `avatar_url` VARCHAR(255) DEFAULT NULL COMMENT '头像地址',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4. 创建玩家战绩与积分表
CREATE TABLE `user_stats` (
  `user_id` BIGINT NOT NULL,
  `rank_points` INT DEFAULT 1000 COMMENT '当前段位分 (Elo)',
  `total_games` INT DEFAULT 0 COMMENT '总场次',
  `wins` INT DEFAULT 0 COMMENT '胜场',
  `losses` INT DEFAULT 0 COMMENT '负场',
  `draws` INT DEFAULT 0 COMMENT '平局',
  `peak_points` INT DEFAULT 1000 COMMENT '历史最高分',
  PRIMARY KEY (`user_id`),
  CONSTRAINT `fk_user_stats` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 5. 创建历史战绩表
CREATE TABLE `match_history` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `room_id` VARCHAR(32) NOT NULL COMMENT '当时的房间号',
  `player_a_id` BIGINT NOT NULL,
  `player_b_id` BIGINT NOT NULL,
  `winner_id` BIGINT DEFAULT NULL COMMENT '获胜者ID',
  `match_type` VARCHAR(16) DEFAULT 'CASUAL' COMMENT '类型：RANKED/CASUAL',
  `score_a` INT DEFAULT 0,
  `score_b` INT DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 6. 插入默认用户 (密码均为 123456)
INSERT INTO `users` (id, username, password, nickname, email) VALUES 
(1, 'admin', '$2a$10$8.UnVuG9HHgffUDAlk8qfOuVGkqRzgVymGe07xd00DMxs.TVuHOnu', '系统管理员', 'admin@billiards.com'),
(2, 'player1', '$2a$10$8.UnVuG9HHgffUDAlk8qfOuVGkqRzgVymGe07xd00DMxs.TVuHOnu', '台球高手', 'p1@billiards.com'),
(3, 'player2', '$2a$10$8.UnVuG9HHgffUDAlk8qfOuVGkqRzgVymGe07xd00DMxs.TVuHOnu', '追风少年', 'p2@billiards.com');

-- 7. 初始化默认用户的战绩
INSERT INTO `user_stats` (user_id, rank_points, total_games, wins) VALUES 
(1, 1500, 10, 8),
(2, 1200, 5, 3),
(3, 1100, 2, 1);
