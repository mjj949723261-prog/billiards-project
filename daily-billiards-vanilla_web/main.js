/**
 * @file main.js
 * @description 台球游戏的入口文件。负责 UI 交互、房间生命周期管理、
 * 网络事件编排以及全局状态初始化。
 */

import { bootstrapGame } from './src/game.js'
import { applyLayoutMode } from './src/layout/mode.js'
import { GameClient } from './src/network/game-client.js'
import { resolveRoomEntry } from './src/network/session-entry.js'
import { AuthService } from './src/network/auth-service.js'
import {
    clearOverlayError,
    showAuthView,
    showGameView,
    showLobbyView,
    showMatchmakingView,
    showOverlay,
    showOverlayError,
} from './src/ui/overlay-views.js'
import { bindAuthActions } from './src/ui/auth-controller.js'
import { bindLobbyActions, renderLobbyProfile } from './src/ui/lobby-controller.js'

/** @global 将 GameClient 挂载到全局窗口对象，方便调试和跨模块访问。 */
window.GameClient = GameClient;

/**
 * 根据窗口尺寸同步布局模式（横屏/竖屏）。
 */
function syncLayoutMode() {
    applyLayoutMode(document, window);
}

function updateGameplayRoomChrome() {
    const networkIndicator = document.getElementById('network-indicator');
    if (networkIndicator) {
        const online = typeof navigator.onLine === 'boolean' ? navigator.onLine : true;
        let state = 'online';
        let label = '网络正常';
        if (!online || GameClient.connectionState === 'idle') {
            state = 'offline';
            label = '网络异常';
        } else if (GameClient.connectionState === 'connecting') {
            state = 'unstable';
            label = '重连中';
        }
        networkIndicator.dataset.state = state;
        networkIndicator.textContent = label;
    }

    const audioButton = document.getElementById('btn-audio-toggle');
    if (audioButton) {
        const enabled = !!window.game?.audio?.enabled;
        audioButton.textContent = enabled ? '音乐开' : '音乐关';
        audioButton.setAttribute('aria-pressed', String(enabled));
        audioButton.classList.toggle('is-off', !enabled);
    }
}

function leaveRoomToLobby() {
    if (window.confirm && !window.confirm('确认返回大厅吗？当前房间将被退出。')) {
        return;
    }
    GameClient.cancelMatchmaking();
    showOverlay();
    showLobbyView();
    clearOverlayError();
    updateGameplayRoomChrome();
}

function startMatchmaking(requestedRoomId = '') {
    const rid = requestedRoomId.trim();
    const authUser = AuthService.getUser();
    const nick = authUser?.nickname || GameClient.nickname || '游客玩家';

    clearOverlayError();
    showMatchmakingView(
        rid ? `正在加入房间 ${rid}...` : '正在寻找对手...',
        rid
            ? {
                title: '正在加入房间',
                badge: '入房中',
                footnote: '连上房间后会自动等待对手就位。',
                roomId: rid,
                state: 'joining-room',
            }
            : {
                title: '正在寻找对手',
                badge: '匹配中',
                footnote: '系统正在为你寻找在线对手。',
                state: 'matching',
            },
    );

    GameClient.connect(nick, () => {
        showMatchmakingView(
            rid ? `正在加入房间 ${rid}...` : '正在寻找对手...',
            rid
                ? {
                    title: '正在加入房间',
                    badge: '入房中',
                    footnote: '连上房间后会自动等待对手就位。',
                    roomId: rid,
                    state: 'joining-room',
                }
                : {
                    title: '正在寻找对手',
                    badge: '匹配中',
                    footnote: '系统正在为你寻找在线对手。',
                    state: 'matching',
                },
        );
    }, rid || null);
}

/**
 * 当收到房间状态更新或游戏开始时，由 GameClient 调用的全局回调。
 * 负责将 UI 从大厅切换到游戏视图，并初始化游戏状态。
 * @param {Object} room - 从服务器接收到的房间数据。
 */
window.handleGameStart = (room) => {
    if (!room) return;
    
    // 彻底修复：从所有可能的位置提取状态
    const roomObj = room.room || (room.content && room.content.room) || room;
    let rawStatus = room.status || roomObj.status || (room.content && room.content.status) || '';
    const status = rawStatus.toString().toUpperCase();
    
    console.log('[RoomSync] Received Status:', status);

    // 获取 URL 参数
    const urlParams = new URLSearchParams(window.location.search);
    const hideTopView = urlParams.get('hideTopView') === '1';
    
    const isActiveRoomStatus = status === 'PLAYING' || status === 'RESOLVING' || status === 'PAUSED'

    // 核心保护：只有对局相关状态才允许进入游戏画面
    if (!isActiveRoomStatus && !hideTopView) {
        console.log('[UI] Room is not in PLAYING state. Keeping matchmaking panel visible.');
        
    showOverlay();
        
        showMatchmakingView('已进入房间，正在等待对手。', {
            title: '等待对手加入',
            badge: '已进房',
            footnote: '分享房间号给好友，对方进入后将自动开局。',
            roomId: roomObj.roomId || roomObj.id || room.roomId || '',
            state: 'waiting-opponent',
            cancelLabel: '返回大厅',
        });
        
        const rid = roomObj.roomId || roomObj.id || room.roomId;
        return;
    }

    // 只有状态明确为 PLAYING 时，才允许关闭遮罩并初始化/开始游戏
    console.log('[UI] Status is PLAYING. Transitioning to Game View.');
    showGameView();

    // --- 核心修复：只有在 PLAYING 时才初始化游戏，防止 WAITING 时 Canvas 背景露出 ---
    const roomData = room.room || (room.content && room.content.room) || room;
    const isPlaying = isActiveRoomStatus;
    const msgType = room._msgType; // 之前在 GameClient.js 中注入的标记
    const isFreshGameStart = msgType === 'GAME_START';
    const hasRemoteBallState = !!(roomData.ballState);
    const isLocalNewSession = !window.game || (window.game.balls.length <= 1);

    if (!window.game) {
        window.game = bootstrapGame();
    }
    updateGameplayRoomChrome();
    
    // 核心修复：只有在确实没有远程存档，且是新开局或本地全新会话时才 init()
    // 如果有远程 ballState，严禁 init() 重新摆球
    if (isPlaying && !hasRemoteBallState && (isLocalNewSession || isFreshGameStart)) {
        window.game.init();
    }

    // 记录上一次的状态用于判断变迁
    const oldStatus = window._lastStatus || 'WAITING';
    window._lastStatus = status;

    // 重置重连/再来一局按钮状态
    const btnRematch = document.getElementById('btn-rematch');
    if (btnRematch && isPlaying) {
        btnRematch.innerText = '再来一局';
        btnRematch.disabled = false;
    }

    // 稳健获取玩家 ID
    const pIds = roomData.playerIds || [];
    const p1Id = pIds.length > 0 ? pIds[0] : null;
    window.game.playerIdByNumber = {
        1: p1Id,
        2: pIds.length > 1 ? pIds[1] : null,
    };
    
    GameClient.playerNames = roomData.playerNames || {};
    GameClient.playerIndex = (GameClient.playerId === p1Id) ? 1 : 2;
    window.game.playerIndex = GameClient.playerIndex;
    window.game.currentPlayer = (roomData.currentTurnPlayerId === p1Id) ? 1 : 2;
    GameClient.isMyTurn = (roomData.currentTurnPlayerId === GameClient.playerId);
    window.game.roomPhase = roomData.status || status || window.game.roomPhase
    window.game.turnId = roomData.turnId ?? window.game.turnId
    window.game.stateVersion = roomData.stateVersion ?? window.game.stateVersion
    window.game.shotToken = roomData.shotToken ?? window.game.shotToken
    window.game.stateHash = roomData.stateHash || window.game.stateHash
    
    // 恢复状态 (如果是本地刷新加载)
    if (isPlaying && (isLocalNewSession || isFreshGameStart)) {
        if (roomData.player1Group) window.game.playerGroups[1] = (roomData.player1Group === 'OPEN' ? null : roomData.player1Group);
        if (roomData.player2Group) window.game.playerGroups[2] = (roomData.player2Group === 'OPEN' ? null : roomData.player2Group);
        if (roomData.player1Score !== undefined) window.game.scores[1] = roomData.player1Score;
        if (roomData.player2Score !== undefined) window.game.scores[2] = roomData.player2Score;
        
        if (roomData.ballInHand !== undefined) {
            window.game.ballInHand = roomData.ballInHand;
            window.game.ballInHandZone = roomData.ballInHandZone || 'table';
            window.game.placingCue = roomData.ballInHand;
        }

        if (roomData.ballState) {
            const restoredSnapshot = Array.isArray(roomData.ballState) ? { balls: roomData.ballState } : roomData.ballState;
            window.game.applyGameStateSnapshot(restoredSnapshot);
            window.game.isBreakShot = false;
        }
    }

    window.game.shotActive = status === 'RESOLVING';
    window.game.awaitingShotResult = status === 'RESOLVING';
    window.game.showRemoteCue = false;
    window.game.pullDistance = 0;
    window.game.isDragging = false;
    
    const serverTime = room.serverTime || Date.now();
    const expireAt = room.expireAt || (serverTime + 45000);
    window.game.syncTimer(roomData.turnStartTime, expireAt, serverTime);
    
    // --- 提示语逻辑修复：使用原始消息类型和会话标记 ---
    let entryMsg = "";
    
    if (isPlaying) {
        if (status === 'PAUSED') {
            entryMsg = '对局已暂停，等待玩家恢复'
        } else if (status === 'RESOLVING') {
            entryMsg = '本杆结算中'
        } else if (msgType === 'GAME_START') {
            // 场景 A: 人数凑齐，系统广播对局开始
            // 只有当前页面还没提示过“比赛开始”时才显示（防止广播和个人消息冲突）
            if (!window._matchStartedMsgShown) {
                entryMsg = GameClient.isMyTurn ? "比赛开始，轮到你开球" : "比赛开始，对方先开球";
                window._matchStartedMsgShown = true;
            }
        } else if (msgType === 'JOIN') {
            // 场景 B: 我主动加入（刷新页面），且服务器说状态已经是 PLAYING
            entryMsg = "欢迎回来";
            window._matchStartedMsgShown = true; // 既然已经进来了，就不再显示开局提示
        } else {
            // 场景 C: 已经在对局中，收到其他人的状态更新（可能是对手刷新回来）
            const now = Date.now();
            if (window._matchStartedMsgShown && (!window._lastOpponentBackTime || now - window._lastOpponentBackTime > 5000)) {
                if (!window.game.isMoving()) {
                    entryMsg = "对手已重新连接";
                    window._lastOpponentBackTime = now;
                }
            }
        }
    }

    if (entryMsg) window.game.setStatusMessage(entryMsg, 3000);
    window.game.updateUI();
};

/**
 * 处理远程瞄准事件的全局回调。
 * 更新游戏视觉效果，显示对手正在瞄准的位置。
 * @param {Object} data - 瞄准数据（aimAngle, pullDistance）。
 */
window.handleRemoteAim = (data) => {
    if (window.game) {
        window.game.handleRemoteAim(data.aimAngle, data.pullDistance);
    }
};

/**
 * 处理远程击球事件的全局回调。
 * 根据对手的瞄准和力度执行击球逻辑。
 * @param {Object} data - 击球数据（aimAngle, powerRatio）。
 */
window.handleRemoteShoot = (data) => {
    if (window.game) {
        // 执行远程击球逻辑
        window.game.executeRemoteShoot(data.aimAngle, data.powerRatio);
    }
};

window.handleShotStartAccepted = (payload, senderId) => {
    if (!window.game) return
    const shot = payload.shot || payload
    const room = payload.room || {}
    window.game.roomPhase = room.status || 'RESOLVING'
    window.game.turnId = shot.turnId ?? window.game.turnId
    window.game.stateVersion = shot.stateVersion ?? window.game.stateVersion
    window.game.shotToken = shot.shotToken ?? window.game.shotToken
    window.game.isTurnLocked = true

    const isOwnOptimisticShot = senderId === GameClient.playerId
    if (!isOwnOptimisticShot) {
        window.game.executeAcceptedShotInput(shot)
    } else if (window.game.pendingShotRequest) {
        window.game.pendingShotRequest = null
    }
    window.game.updateUI()
}

window.handleShotResult = (payload) => {
    if (!window.game) return
    const room = payload.room || {}
    const playerIds = room.playerIds || []
    if (playerIds.length > 0) {
        window.game.playerIdByNumber = {
            1: playerIds[0] || null,
            2: playerIds[1] || null,
        }
    }
    GameClient.playerNames = room.playerNames || GameClient.playerNames || {}
    GameClient.isMyTurn = room.currentTurnPlayerId === GameClient.playerId
    const currentPlayer = playerIds.indexOf(room.currentTurnPlayerId) + 1
    window.game.applyShotResult({
        turnId: payload.turnId,
        nextTurnId: payload.nextTurnId,
        stateVersion: payload.stateVersion,
        nextShotToken: payload.nextShotToken,
        stateHash: payload.stateHash,
        roomPhase: room.status || 'PLAYING',
        currentPlayer: currentPlayer > 0 ? currentPlayer : window.game.currentPlayer,
        ballInHand: payload.ballInHand,
        ballInHandZone: payload.ballInHandZone,
        playerGroups: payload.playerGroups,
        scores: payload.scores,
        finalBallState: payload.finalBallState,
        isBreakShot: payload.isBreakShot,
        statusMessage: payload.statusMessage,
        statusRemainingMs: payload.statusRemainingMs,
      })
    const expireAt = payload.expireAt || room.expireAt
    const serverTime = payload.serverTime || Date.now()
    if (expireAt) {
        window.game.syncTimer(room.turnStartTime || 0, expireAt, serverTime)
    }
    window.game.isTurnLocked = false
}

window.handleRoomSnapshot = (payload) => {
    if (!window.game) {
        window.game = bootstrapGame();
    }
    const room = payload.room || payload
    window.handleGameStart({ ...room, room, status: room.status || payload.status, _msgType: 'ROOM_SNAPSHOT' })
    if (room.ballState) {
        const restoredSnapshot = Array.isArray(room.ballState) ? { balls: room.ballState } : room.ballState
        window.game.applyGameStateSnapshot({ ...payload, ...restoredSnapshot, forceBusinessUpdate: true })
    }
}

/**
 * 处理远程状态同步的全局回调。
 * 将状态快照应用到本地游戏实例。
 * @param {Object} stateData - 游戏状态快照。
 */
window.handleRemoteStateSync = (stateData) => {
    if (window.game) {
        window.game.applyGameStateSnapshot(stateData);
    }
};

/**
 * 处理再来一局状态更新的全局回调。
 * @param {string} status - 再来一局的状态（例如：'READY'）。
 */
window.handleRemoteRematch = (status) => {
    if (status === 'READY') {
        if (window.game) window.game.setStatusMessage('对方已准备好再来一局', 3000);
    }
};

/**
 * 处理回合切换事件的全局回调。
 * 重置本地击球状态并更新回合指示器。
 * @param {Object} data - 回合切换数据。
 */
window.handleTurnSwitch = (data) => {
    if (window.game) {
        const roomData = data.room || data;
        const p1Id = roomData.playerIds[0];
        window.game.playerIdByNumber = {
            1: roomData.playerIds[0] || null,
            2: roomData.playerIds[1] || null,
        };
        GameClient.playerNames = roomData.playerNames || GameClient.playerNames || {};
        window.game.playerIndex = GameClient.playerIndex;
        window.game.currentPlayer = (roomData.currentTurnPlayerId === p1Id) ? 1 : 2;
        GameClient.isMyTurn = (roomData.currentTurnPlayerId === GameClient.playerId);
        window.game.roomPhase = roomData.status || 'PLAYING'
        window.game.turnId = roomData.turnId ?? window.game.turnId
        window.game.stateVersion = roomData.stateVersion ?? window.game.stateVersion
        window.game.shotToken = roomData.shotToken ?? window.game.shotToken
        
        // 关键修复：重置所有锁定标志，确保新玩家可以操作
        window.game.shotActive = false;
        window.game.showRemoteCue = false;
        window.game.pullDistance = 0;
        window.game.isDragging = false;
        window.game.isTurnLocked = false;
        
        // 同步计时器 (防止 serverTime 缺失导致倒计时消失)
        if (roomData.turnStartTime) {
            const expireAt = data.expireAt || roomData.expireAt;
            const serverTime = data.serverTime || roomData.serverTime || Date.now();
            window.game.syncTimer(roomData.turnStartTime, expireAt, serverTime);
        }
        
        window.game.updateUI();
        window.game.setStatusMessage(GameClient.isMyTurn ? "轮到你击球" : "对手正在击球", 2000);
    }
};

/**
 * 处理常规连接错误的全局回调。
 * @param {string} message - 错误消息内容。
 */
window.handleConnectionError = (message) => {
    GameClient.cancelMatchmaking();
    showLobbyView();
    const errorMessage = message || '连接游戏服务器失败，请确保后端服务已启动';
    showMatchmakingView(errorMessage, {
        title: '连接失败',
        badge: '异常',
        footnote: '你可以返回大厅后再次尝试。',
        state: 'error',
        cancelLabel: '返回大厅',
    });
    showOverlayError(errorMessage);
    alert(errorMessage);
};

/**
 * 处理房间特定错误的全局回调。
 * @param {string} message - 错误消息内容。
 */
window.handleRoomError = (message) => {
    GameClient.cancelMatchmaking();
    showLobbyView();
    const errorMessage = message || '加入房间失败';
    showMatchmakingView(errorMessage, {
        title: '加入失败',
        badge: '异常',
        footnote: '请确认房间号后重新尝试。',
        state: 'error',
        cancelLabel: '返回大厅',
    });
    showOverlayError(errorMessage);
    alert(errorMessage);
};

// 绑定 UI 事件
syncLayoutMode();
window.addEventListener('resize', syncLayoutMode);

/**
 * 更新身份面板的显示状态（登录前 vs 登录后）
 */
function updateAuthUI() {
    const roomFromUrl = new URLSearchParams(window.location.search).get('room');
    if (AuthService.isLoggedIn()) {
        renderLobbyProfile(AuthService.getUser());
        showLobbyView();
    } else if (roomFromUrl) {
        renderLobbyProfile({ nickname: '游客玩家', username: 'guest' });
        showLobbyView();
    } else {
        showAuthView();
        document.getElementById('login-form').classList.remove('hidden');
        document.getElementById('register-form').classList.add('hidden');
        document.getElementById('auth-tabs').classList.remove('hidden');
        // 重置 Tab
        document.getElementById('tab-login').classList.add('active');
        document.getElementById('tab-register').classList.remove('active');
    }
}

bindAuthActions({
    onLoggedIn(user) {
        renderLobbyProfile(user);
        showLobbyView();
    },
    onGuestMode(user) {
        renderLobbyProfile(user);
        showLobbyView();
    },
    showError: showOverlayError,
    clearError: clearOverlayError,
});

bindLobbyActions({
    onPrimaryMatch() {
        startMatchmaking('');
    },
    onJoinRoom(roomId) {
        if (!roomId) {
            showOverlayError('请输入房间号后再加入');
            document.getElementById('room-id-input').focus();
            return;
        }
        startMatchmaking(roomId);
    },
    onLogout() {
        AuthService.logout();
        updateAuthUI();
    },
});

// 初始化时检查登录状态
updateAuthUI();
updateGameplayRoomChrome();

document.getElementById('btn-rematch').addEventListener('click', () => {
    GameClient.sendRematch();
    document.getElementById('btn-rematch').innerText = '等待对方...';
    document.getElementById('btn-rematch').disabled = true;
});

document.getElementById('btn-cancel').addEventListener('click', () => {
    GameClient.cancelMatchmaking();
    updateAuthUI();
    clearOverlayError();
});

document.getElementById('btn-match-back').addEventListener('click', () => {
    GameClient.cancelMatchmaking();
    updateAuthUI();
    clearOverlayError();
});

document.getElementById('btn-leave-room')?.addEventListener('click', () => {
    leaveRoomToLobby();
});

document.getElementById('btn-audio-toggle')?.addEventListener('click', () => {
    if (!window.game?.audio) return;
    window.game.audio.enabled = !window.game.audio.enabled;
    if (window.game.audio.masterGain) {
        window.game.audio.masterGain.gain.value = window.game.audio.enabled ? 0.9 : 0;
    }
    updateGameplayRoomChrome();
});

document.getElementById('btn-copy-room').addEventListener('click', async () => {
    const roomId = document.getElementById('room-id-val').innerText.trim();
    if (!roomId) return;
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(roomId);
        }
        document.getElementById('matchmaking-footnote').innerText = '房间号已复制，发给好友就能进房。';
    } catch (error) {
        document.getElementById('matchmaking-footnote').innerText = '复制失败，请手动告诉好友房间号。';
    }
});

// 预填昵称与自动重连/URL 加入
const urlParams = new URLSearchParams(window.location.search);
const devView = urlParams.get('dev');
const roomFromUrl = urlParams.get('room');
const lastRoomId = localStorage.getItem('billiards_room_id');
const roomEntry = resolveRoomEntry(roomFromUrl, lastRoomId);

if (devView === 'play') {
    showGameView();
    if (!window.game) {
        window.game = bootstrapGame();
    }
    window.game.updateUI();
    updateGameplayRoomChrome();
}

window.addEventListener('online', updateGameplayRoomChrome);
window.addEventListener('offline', updateGameplayRoomChrome);

if (!roomFromUrl && roomEntry.suggestedRoomId) {
    document.getElementById('room-id-input').value = roomEntry.suggestedRoomId;
}

if (roomEntry.autoJoinRoomId) {
    const targetRoom = roomEntry.autoJoinRoomId;
    clearOverlayError();
    showMatchmakingView(`正在进入房间 ${targetRoom}...`, {
        title: '正在加入房间',
        badge: '入房中',
        footnote: '连接成功后会自动显示房间状态。',
        roomId: targetRoom,
        state: 'joining-room',
    });
    
    // 如果是从 URL 加入且没昵称，随机一个
    const finalNick = AuthService.getUser()?.nickname || GameClient.nickname || `玩家${Math.floor(Math.random()*1000)}`;
    
    GameClient.connect(finalNick, () => {
        console.log('Connecting to room:', targetRoom);
    }, targetRoom);
}
