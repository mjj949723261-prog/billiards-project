package com.billiards.game.model;

/**
 * [描述] 游戏交互消息类
 * 定义 WebSocket 通信的标准协议格式，封装消息类型、发送者、房间及内容正文，并提供链式构建器。
 */
public class GameMessage {
    private MessageType type;
    private String senderId;
    private String roomId;
    private Object content;

    public GameMessage() {}

    public GameMessage(MessageType type, String senderId, String roomId, Object content) {
        this.type = type;
        this.senderId = senderId;
        this.roomId = roomId;
        this.content = content;
    }

    public static Builder builder() {
        return new Builder();
    }

    public static class Builder {
        private MessageType type;
        private String senderId;
        private String roomId;
        private Object content;

        public Builder type(MessageType type) { this.type = type; return this; }
        public Builder senderId(String senderId) { this.senderId = senderId; return this; }
        public Builder roomId(String roomId) { this.roomId = roomId; return this; }
        public Builder content(Object content) { this.content = content; return this; }
        
        public GameMessage build() {
            return new GameMessage(type, senderId, roomId, content);
        }
    }

    public MessageType getType() { return type; }
    public void setType(MessageType type) { this.type = type; }
    public String getSenderId() { return senderId; }
    public void setSenderId(String senderId) { this.senderId = senderId; }
    public String getRoomId() { return roomId; }
    public void setRoomId(String roomId) { this.roomId = roomId; }
    public Object getContent() { return content; }
    public void setContent(Object content) { this.content = content; }

    public enum MessageType {
        JOIN, GAME_START, SHOOT, AIM, SYNC_STATE, TURN_TIMEOUT, CHAT, ERROR, LEAVE, REMATCH, PLAYER_LEFT, PLAYER_RECONNECTED
    }
}
