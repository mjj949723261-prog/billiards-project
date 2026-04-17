package com.billiards.game.entity;

/**
 * [描述] 玩家战绩统计与积分 (POJO)
 */
public class UserStats {
    private Long userId;
    private int rankPoints = 1000;
    private int totalGames = 0;
    private int wins = 0;
    private int losses = 0;
    private int draws = 0;
    private int peakPoints = 1000;

    public UserStats() {}

    public UserStats(Long userId) {
        this.userId = userId;
    }

    public void addWin() {
        this.wins++;
        this.totalGames++;
        this.rankPoints += 25;
    }

    public void addLoss() {
        this.losses++;
        this.totalGames++;
        this.rankPoints = Math.max(0, this.rankPoints - 20);
    }

    // Getters and Setters
    public Long getUserId() { return userId; }
    public void setUserId(Long userId) { this.userId = userId; }

    public int getRankPoints() { return rankPoints; }
    public void setRankPoints(int rankPoints) { this.rankPoints = rankPoints; }

    public int getTotalGames() { return totalGames; }
    public void setTotalGames(int totalGames) { this.totalGames = totalGames; }

    public int getWins() { return wins; }
    public void setWins(int wins) { this.wins = wins; }

    public int getLosses() { return losses; }
    public void setLosses(int losses) { this.losses = losses; }

    public int getDraws() { return draws; }
    public void setDraws(int draws) { this.draws = draws; }

    public int getPeakPoints() { return peakPoints; }
    public void setPeakPoints(int peakPoints) { this.peakPoints = peakPoints; }
}
