/**
 * @file game-client.js
 * @description 使用 STOMP 和 SockJS 的 WebSocket 客户端，用于实时多人游戏协调。
 * 处理加入房间、瞄准同步、执行击球以及游戏状态快照同步。
 */

/**
 * 为没有 localStorage 的环境创建一个简单的内存存储回退方案。
 * @returns {Object} 类似 storage 的对象。
 */
function createMemoryStorage() {
    const memory = new Map();
    return {
        getItem(key) {
            return memory.has(key) ? memory.get(key) : null;
        },
        setItem(key, value) {
            memory.set(key, String(value));
        },
        removeItem(key) {
            memory.delete(key);
        }
    };
}

/** @type {Storage} 用于持久化玩家和房间数据的存储机制。 */
const storage = typeof globalThis.localStorage !== 'undefined'
    ? globalThis.localStorage
    : createMemoryStorage();

/**
 * 解析后端服务器的基础 URL。
 * @returns {string} 服务器源 URL。
 */
export function resolveServerOrigin() {
    if (typeof window === 'undefined' || !window.location) {
        return 'http://127.0.0.1:8080';
    }

    if (window.BILLIARDS_SERVER_ORIGIN) {
        return window.BILLIARDS_SERVER_ORIGIN;
    }

    const { protocol, hostname } = window.location;
    const serverHostname = hostname || '127.0.0.1';
    return `${protocol}//${serverHostname}:8080`;
}

import { AuthService } from './auth-service.js';

/**
 * 所有网络通信的单例客户端对象。
 */
export const GameClient = {
    /** @type {Object|null} STOMP over WebSocket 客户端实例。 */
    stompClient: null,
    /** @type {Object|null} 当前房间消息的订阅对象。 */
    roomSubscription: null,
    /** @type {string} 当前连接状态 ('idle', 'connecting', 'connected')。 */
    connectionState: 'idle',
    /** @type {string} 当前玩家的唯一持久化 ID。 */
    get playerId() {
        // 如果已登录，优先使用用户 ID；否则使用随机 ID（仅用于游客或未登录状态）
        const user = AuthService.getUser();
        if (user) {
            return 'u_' + user.id;
        }

        let id = sessionStorage.getItem('billiards_player_id');
        if (!id) {
            id = 'guest_' + Math.random().toString(36).substr(2, 9);
            sessionStorage.setItem('billiards_player_id', id);
        }
        return id;
    },
    /** @type {string|null} 当前所在的房间 ID。 */
    roomId: null,
    /** @type {string} 玩家显示的昵称。 */
    get nickname() {
        const user = AuthService.getUser();
        if (user) return user.nickname;
        return sessionStorage.getItem('billiards_nickname') || '';
    },
    set nickname(val) {
        sessionStorage.setItem('billiards_nickname', val);
    },
    /** @type {Object<string, string>} 玩家 ID 到昵称的映射。 */
    playerNames: {},
    /** @type {boolean} 当前是否轮到本客户端击球。 */
    isMyTurn: false,
    /** @type {boolean} 是否启用轻量裁决协议。 */
    lightweightAuthorityEnabled: true,
    /** @type {string} 当前房间阶段。 */
    roomPhase: 'WAITING',

    /**
     * 检查是否缺少全局依赖项 (SockJS, Stomp)。
     * @returns {string[]} 缺少的依赖项名称列表。
     */
    getMissingRealtimeDependencies() {
        const missing = [];
        if (typeof globalThis.SockJS === 'undefined') missing.push('SockJS');
        if (typeof globalThis.Stomp === 'undefined') missing.push('Stomp');
        return missing;
    },

    /**
     * 连接到服务器并加入房间。
     * @param {string} nickname - 玩家昵称。
     * @param {Function} [onConnected] - 连接成功后执行的回调。
     * @param {string|null} [requestedRoomId=null] - 请求加入的特定房间 ID。
     */
    connect(nickname, onConnected, requestedRoomId = null) {
        if (this.connectionState === 'connecting' || this.connectionState === 'connected') {
            return;
        }

        const missingDependencies = this.getMissingRealtimeDependencies();
        if (missingDependencies.length > 0) {
            const reason = `联机依赖加载失败：${missingDependencies.join(', ')}`;
            if (window.handleConnectionError) {
                window.handleConnectionError(reason);
                return;
            }
            throw new Error(reason);
        }

        this.nickname = nickname;
        this.connectionState = 'connecting';

        const socket = new SockJS(`${resolveServerOrigin()}/game-socket`);
        this.stompClient = Stomp.over(socket);
        this.stompClient.debug = (msg) => console.log('[STOMP] ' + msg);

        // 构建 STOMP 连接头部，包含 JWT (如果已登录)
        const headers = {};
        const token = AuthService.getToken();
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        this.stompClient.connect(headers, () => {
            console.log('Connected to server with PlayerID:', this.playerId);
            this.connectionState = 'connected';

            // 显式房间号入房时，先订阅房间 topic，避免个人队列回包偶发缺失时卡在“入房中”。
            if (requestedRoomId) {
                this.roomId = requestedRoomId;
                storage.setItem('billiards_room_id', this.roomId);
                this.subscribeToRoom(this.roomId);
            }

            // 订阅个人消息队列，用于接收房间分配等信息
            this.stompClient.subscribe('/queue/player/' + this.playerId, (sdkEvent) => {
                const msg = JSON.parse(sdkEvent.body);
                console.log('Received Personal Message:', msg.type);
                if (msg.type === 'JOIN') {
                    this.roomId = msg.roomId;
                    storage.setItem('billiards_room_id', this.roomId);
                    console.log('Joined Room:', this.roomId);
                    this.subscribeToRoom(this.roomId);
                    
                    // 统一通过 onMessageReceived 处理，保持消息处理一致性
                    this.onMessageReceived(msg);
                }
            });

            // 发送加入房间请求
            this.stompClient.send("/app/game.join", {}, JSON.stringify({
                type: 'JOIN',
                senderId: this.playerId,
                roomId: requestedRoomId,
                content: { nickname: this.nickname }
            }));

            if (onConnected) onConnected();
        }, (error) => {
            this.connectionState = 'idle';
            this.roomId = null;
            this.isMyTurn = false;
            this.cleanupConnection();
            if (window.handleConnectionError) {
                const message = error?.message || error?.toString?.() || '连接游戏服务器失败';
                window.handleConnectionError(message);
                return;
            }
            alert('连接游戏服务器失败，请确保后端服务已启动');
        });
    },

    /**
     * 断开与服务器的连接并清理订阅。
     */
    cleanupConnection() {
        if (this.roomSubscription) {
            this.roomSubscription.unsubscribe();
            this.roomSubscription = null;
        }

        if (this.stompClient) {
            try {
                if (this.stompClient.connected) {
                    this.stompClient.disconnect(() => {});
                }
            } catch (error) {
                console.warn('disconnect failed', error);
            }
            this.stompClient = null;
        }
    },

    /**
     * 取消当前的匹配或会话并重置客户端状态。
     */
    cancelMatchmaking() {
        this.connectionState = 'idle';
        this.isMyTurn = false;
        this.roomId = null;
        storage.removeItem('billiards_room_id');
        this.cleanupConnection();
    },

    /**
     * 订阅特定房间的 Topic 以接收游戏事件。
     * @param {string} roomId - 房间 ID。
     */
    subscribeToRoom(roomId) {
        if (this.roomSubscription) {
            this.roomSubscription.unsubscribe();
        }
        this.roomSubscription = this.stompClient.subscribe('/topic/room/' + roomId, (sdkEvent) => {
            this.onMessageReceived(JSON.parse(sdkEvent.body));
        });
    },

    /**
     * 将接收到的 WebSocket 消息路由到全局处理程序。
     * @param {Object} msg - 解析后的 JSON 消息对象。
     */
    onMessageReceived(msg) {
        console.log('Received Message:', msg.type);
        switch(msg.type) {
            case 'JOIN':
                if (msg.content && window.handleGameStart) {
                    const data = msg.content;
                    const roomObj = data.room || data;
                    const finalRoomId = msg.roomId || roomObj.roomId || roomObj.id;
                    this.isMyTurn = (roomObj.currentTurnPlayerId === this.playerId);
                    this.roomPhase = roomObj.status || this.roomPhase;
                    
                    const mergedRoom = { ...roomObj, ...data, roomId: finalRoomId, _msgType: 'JOIN' };
                    window.handleGameStart(mergedRoom);
                }
                break;
            case 'GAME_START':
                {
                    const data = msg.content;
                    const roomObj = data.room || data;
                    const finalRoomId = msg.roomId || roomObj.roomId || roomObj.id;
                    this.playerNames = roomObj.playerNames || this.playerNames || {};
                    this.isMyTurn = (roomObj.currentTurnPlayerId === this.playerId);
                    this.roomPhase = roomObj.status || this.roomPhase;
                    
                    const mergedRoom = { ...roomObj, ...data, roomId: finalRoomId, _msgType: 'GAME_START' };
                    if (window.handleGameStart) window.handleGameStart(mergedRoom);
                }
                break;
            case 'AIM':
                if (msg.senderId !== this.playerId && window.handleRemoteAim) {
                    window.handleRemoteAim(msg.content);
                }
                break;
            case 'SHOT_START_ACCEPTED':
                if (msg.content) {
                    const roomObj = msg.content.room || {};
                    this.roomPhase = roomObj.status || 'RESOLVING';
                    if (window.handleShotStartAccepted) {
                        window.handleShotStartAccepted(msg.content, msg.senderId);
                    }
                }
                break;
            case 'SHOT_RESULT':
                if (msg.content) {
                    const roomObj = msg.content.room || {};
                    this.roomPhase = roomObj.status || 'PLAYING';
                    this.isMyTurn = roomObj.currentTurnPlayerId === this.playerId;
                    if (window.handleShotResult) {
                        window.handleShotResult(msg.content);
                    }
                }
                break;
            case 'ROOM_SNAPSHOT':
                if (msg.content && window.handleRoomSnapshot) {
                    const roomObj = msg.content.room || {};
                    this.roomPhase = roomObj.status || this.roomPhase;
                    this.isMyTurn = roomObj.currentTurnPlayerId === this.playerId;
                    window.handleRoomSnapshot(msg.content);
                }
                break;
            case 'SYNC_STATE':
                // 只有当不是我的回合时，才接受来自他人的位置同步（防止本地抖动）
                if (msg.senderId !== this.playerId && window.handleRemoteStateSync) {
                    const isSystem = msg.senderId === 'SYSTEM';
                    if (!isSystem || !this.isMyTurn) {
                        window.handleRemoteStateSync(msg.content);
                    }
                }
                // 计时器同步逻辑，所有人都要对齐时间
                // 修复：兼容后端发送的轻量级同步，并强制通过 room 对象纠偏 currentPlayerId
                if (msg.senderId === 'SYSTEM' && msg.content && window.game) {
                    const data = msg.content;
                    const roomObj = data.room || {};
                    const expireAt = data.expireAt || roomObj.expireAt;
                    const serverTime = data.serverTime || roomObj.serverTime;
                    this.roomPhase = roomObj.status || this.roomPhase;
                    
                    // 核心逻辑：强制同步当前出杆者，解决“倒计时归零不换人”的 UI 延迟或状态不一致问题
                    if (roomObj.currentTurnPlayerId) {
                        this.isMyTurn = (roomObj.currentTurnPlayerId === this.playerId);
                        
                        // 寻找对应玩家 ID 的本地玩家索引 (1 或 2)
                        const pIds = roomObj.playerIds || [];
                        const pIndex = pIds.indexOf(roomObj.currentTurnPlayerId) + 1;
                        
                        // 修复：增加防抖和状态保护
                        // 如果本地已经由于倒计时归零锁定了回合，而服务器发来的还是旧玩家，我们选择“抗命”，直到服务器发来正确的新玩家
                        const isSwitchingOnServer = (pIndex !== window.game.currentPlayer);
                        const isWaitingForServerCorrectSwitch = (window.game.isTurnLocked && !isSwitchingOnServer);

                        if (pIndex > 0 && isSwitchingOnServer && !isWaitingForServerCorrectSwitch) {
                            console.log(`[SYNC] 服务器确认切换出杆者: ${window.game.currentPlayer} -> ${pIndex}`);
                            
                            window.game.currentPlayer = pIndex;
                            window.game.isTurnLocked = false; // 解除时间到锁死
                            window.game.shotActive = false;   // 解除击球运动中锁死
                            window.game.isDragging = false;   // 清理拖拽状态
                            window.game.pullDistance = 0;     // 清理拉杆距离
                            window.game.statusMessage = "";   // 清理过时的提示
                            
                            window.game.updateUI(); // 触发 UI 渲染更新
                        }
                    }

                    if (expireAt !== undefined) {
                        window.game.syncTimer(roomObj.turnStartTime || 0, expireAt, serverTime);
                    }
                }
                break;
            case 'REMATCH':
                if (msg.senderId !== this.playerId && window.handleRemoteRematch) {
                    window.handleRemoteRematch(msg.content);
                }
                break;
            case 'CHAT':
                if (msg.senderId !== this.playerId && window.handleRemoteChat) {
                    window.handleRemoteChat(msg.content, msg.senderId);
                }
                break;
            case 'TURN_TIMEOUT':
                {
                    const data = msg.content;
                    const room = data.room || data;
                    this.playerNames = room.playerNames || this.playerNames || {};
                    this.isMyTurn = (room.currentTurnPlayerId === this.playerId);
                    this.roomPhase = room.status || 'PLAYING';
                    if (window.handleTurnSwitch) window.handleTurnSwitch(data);
                }
                break;
            case 'PLAYER_LEFT':
                if (msg.content?.room?.status) {
                    this.roomPhase = msg.content.room.status;
                }
                if (msg.senderId !== this.playerId && window.game) {
                    window.game.setStatusMessage('对手已断开连接', 5000);
                }
                break;
            case 'PLAYER_RECONNECTED':
                if (msg.senderId !== this.playerId && window.game) {
                    window.game.setStatusMessage('对手已重新连接', 3000);
                }
                break;
            case 'ERROR':
                if (window.handleRoomError) {
                    window.handleRoomError(msg.content);
                }
                break;
        }
    },

    /**
     * 向服务器发送击球事件。
     * @param {Object} shootData - 击球参数（瞄准角度、力度比例）。
     */
    sendShoot(shootData) {
        if (!this.stompClient || !this.roomId) return;
        this.stompClient.send("/app/game.shoot", {}, JSON.stringify({
            type: 'SHOOT',
            senderId: this.playerId,
            roomId: this.roomId,
            content: shootData
        }));
    },

    sendShotStartRequest(shotData) {
        if (!this.stompClient || !this.roomId) return;
        this.stompClient.send("/app/game.shotStart", {}, JSON.stringify({
            type: 'SHOT_START_REQUEST',
            senderId: this.playerId,
            roomId: this.roomId,
            content: shotData,
        }));
    },

    sendShotEndReport(reportData) {
        if (!this.stompClient || !this.roomId) return;
        this.stompClient.send("/app/game.shotEnd", {}, JSON.stringify({
            type: 'SHOT_END_REPORT',
            senderId: this.playerId,
            roomId: this.roomId,
            content: reportData,
        }));
    },

    /**
     * 向服务器发送瞄准同步事件。
     * @param {Object} aimData - 当前瞄准参数（瞄准角度、拉杆距离）。
     */
    sendAim(aimData) {
        if (!this.stompClient || !this.roomId) return;
        this.stompClient.send("/app/game.aim", {}, JSON.stringify({
            type: 'AIM',
            senderId: this.playerId,
            roomId: this.roomId,
            content: aimData
        }));
    },

    /**
     * 发送完整的游戏状态快照以进行同步。
     * @param {Object} gameStateData - 台球位置及其他状态的快照。
     */
    sendSync(gameStateData) {
        if (!this.stompClient || !this.roomId) return;
        this.stompClient.send("/app/game.sync", {}, JSON.stringify({
            type: 'SYNC_STATE',
            senderId: this.playerId,
            roomId: this.roomId,
            content: gameStateData
        }));
    },

    /**
     * 发送在同一房间内开始新对局的请求（再来一局）。
     */
    sendRematch() {
        if (!this.stompClient || !this.roomId) return;
        this.stompClient.send("/app/game.rematch", {}, JSON.stringify({
            type: 'REMATCH',
            senderId: this.playerId,
            roomId: this.roomId,
            content: "READY"
        }));
    },

    /**
     * 向房间发送文本聊天消息。
     * @param {string} text - 聊天消息内容。
     */
    sendChat(text) {
        if (!this.stompClient || !this.roomId) return;
        this.stompClient.send("/app/game.chat", {}, JSON.stringify({
            type: 'CHAT',
            senderId: this.playerId,
            roomId: this.roomId,
            content: text
        }));
    },

    usesLightweightAuthority() {
        return this.lightweightAuthorityEnabled;
    }
};
