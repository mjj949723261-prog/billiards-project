package com.billiards.game.repository;

import com.billiards.game.model.BilliardsRoom;
import java.util.Collection;
import java.util.Optional;

/**
 * [描述] 房间存储仓库接口
 * 定义对台球房间数据进行持久化或内存存储的标准方法。
 */
public interface RoomRepository {
    void save(BilliardsRoom room);
    Optional<BilliardsRoom> findById(String roomId);
    Collection<BilliardsRoom> findAll();
    void remove(String roomId);
    Optional<BilliardsRoom> findWaitingRoom();
}
