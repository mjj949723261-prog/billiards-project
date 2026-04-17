package com.billiards.game.repository;

import com.billiards.game.entity.User;
import org.apache.ibatis.annotations.*;

import java.util.Optional;

/**
 * [描述] 用户账号数据映射层 (MyBatis)
 * 采用原生 SQL 实现，方便后续根据业务进行复杂的查询优化。
 */
@Mapper
public interface UserMapper {

    @Select("SELECT * FROM users WHERE username = #{username}")
    User findByUsername(String username);

    @Select("SELECT * FROM users WHERE id = #{id}")
    User findById(Long id);

    @Select("SELECT COUNT(*) > 0 FROM users WHERE username = #{username}")
    boolean existsByUsername(String username);

    @Select("SELECT COUNT(*) > 0 FROM users WHERE email = #{email}")
    boolean existsByEmail(String email);

    @Insert("INSERT INTO users(username, password, nickname, email, created_at) " +
            "VALUES(#{username}, #{password}, #{nickname}, #{email}, NOW())")
    @Options(useGeneratedKeys = true, keyProperty = "id")
    int insert(User user);
}
