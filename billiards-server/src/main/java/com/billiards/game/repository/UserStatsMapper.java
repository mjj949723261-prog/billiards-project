package com.billiards.game.repository;

import com.billiards.game.entity.UserStats;
import org.apache.ibatis.annotations.*;

/**
 * [描述] 玩家战绩统计映射层 (MyBatis)
 * 实现胜负场次累加和积分变动。
 */
@Mapper
public interface UserStatsMapper {

    @Select("SELECT * FROM user_stats WHERE user_id = #{userId}")
    UserStats findByUserId(Long userId);

    @Insert("INSERT INTO user_stats(user_id, rank_points, peak_points) " +
            "VALUES(#{userId}, 1000, 1000)")
    int insert(Long userId);

    /**
     * 更新战绩：胜场 +1，场次 +1，积分增加
     */
    @Update("UPDATE user_stats SET wins = wins + 1, total_games = total_games + 1, " +
            "rank_points = rank_points + #{points}, peak_points = GREATEST(peak_points, rank_points + #{points}) " +
            "WHERE user_id = #{userId}")
    int addWin(@Param("userId") Long userId, @Param("points") int points);

    /**
     * 更新战绩：败场 +1，场次 +1，积分扣除 (最低 0)
     */
    @Update("UPDATE user_stats SET losses = losses + 1, total_games = total_games + 1, " +
            "rank_points = GREATEST(0, rank_points - #{points}) " +
            "WHERE user_id = #{userId}")
    int addLoss(@Param("userId") Long userId, @Param("points") int points);
}
