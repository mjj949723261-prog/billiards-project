package com.billiards.game.repository.impl;

import com.billiards.game.model.BilliardsRoom;
import com.billiards.game.repository.RoomRepository;
import org.springframework.stereotype.Repository;

import java.util.Collection;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/**
 * [描述] 房间仓库本地内存实现
 * 使用线程安全的 ConcurrentHashMap 在服务器内存中高效维护所有活跃房间的实时状态。
 */
@Repository
public class LocalRoomRepositoryImpl implements RoomRepository {

    /** 
     * 存放所有活跃房间的内存映射表
     * Key: 房间ID (RoomID)
     * Value: 房间实体对象 (BilliardsRoom)
     * 使用 ConcurrentHashMap 确保多线程环境下（多个 WebSocket 会话同时操作）的线程安全性。
     */
    private final Map<String, BilliardsRoom> rooms = new ConcurrentHashMap<>();

    @Override
    public void save(BilliardsRoom room) {
        // 将房间存入映射表，如果 ID 已存在则覆盖更新
        rooms.put(room.getRoomId(), room);
    }

    @Override
    public Optional<BilliardsRoom> findById(String roomId) {
        // 根据房间 ID 获取房间对象，并包装在 Optional 中以处理空值
        return Optional.ofNullable(rooms.get(roomId));
    }

    @Override
    public Collection<BilliardsRoom> findAll() {
        // 返回当前内存中所有房间的集合视图
        return rooms.values();
    }

    @Override
    public void remove(String roomId) {
        // 根据 ID 从内存中彻底移除房间（通常在房间解散或玩家全部离开时调用）
        rooms.remove(roomId);
    }

    @Override
    public Optional<BilliardsRoom> findWaitingRoom() {
        // 流式筛选：寻找第一个状态为 WAITING (等待玩家加入) 的房间
        return rooms.values().stream()
                .filter(r -> r.getStatus() == BilliardsRoom.GameStatus.WAITING)
                .findFirst();
    }
}
