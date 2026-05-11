/**
 * @file main.js
 * @description 台球游戏的入口文件。负责 UI 交互、房间生命周期管理、
 * 网络事件编排以及全局状态初始化。
 */

import { bootstrapGame } from './src/game.js?v=20260511_aim_wheel_texture_direction_fix'
import { applyLayoutMode } from './src/layout/mode.js'
import { GameClient } from './src/network/game-client.js?v=20260509_room_join_snapshot_fix'
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

const UI_DEBUG_FLAGS = (() => {
    const hash = window.location?.hash || ''
    const search = window.location?.search || ''
    const storageDebug = typeof window.localStorage !== 'undefined'
        ? window.localStorage.getItem('billiards_debug') || ''
        : ''
    const source = `${hash} ${search} ${storageDebug}`.toLowerCase()
    return {
        roomFlow: source.includes('debug-room'),
        syncFlow: source.includes('debug-sync'),
    }
})()

function uiDebugLog(channel, ...args) {
    if (!UI_DEBUG_FLAGS[channel]) return
    console.log(...args)
}

function logCueRespawnFlow(stage, payload = {}) {
    console.log(`[CueRespawnFlow] ${stage}`, payload)
}

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

        if (!online) {
            state = 'offline';
            label = '网络断开';
        } else if (GameClient.connectionState === 'idle' && GameClient.reconnectAttempts > 0) {
            state = 'unstable';
            label = `重连中 (${GameClient.reconnectAttempts}/${GameClient.maxReconnectAttempts})`;
        } else if (GameClient.connectionState === 'connecting') {
            state = 'unstable';
            label = '连接中';
        } else if (GameClient.connectionState === 'idle') {
            state = 'offline';
            label = '未连接';
        }

        networkIndicator.dataset.state = state;
        networkIndicator.textContent = label;
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
    
    // 统一提取房间对象和消息上下文，避免 WAITING/JOIN 阶段引用未初始化变量。
    const roomObj = room.room || (room.content && room.content.room) || room;
    const roomData = roomObj;
    const msgType = room._msgType || room.type || '';
    const rawStatus = room.status || roomObj.status || (room.content && room.content.status) || '';
    const status = rawStatus.toString().toUpperCase();
    const roomId = roomData.roomId || roomData.id || room.roomId || '';
    const isActiveRoomStatus = status === 'PLAYING' || status === 'RESOLVING' || status === 'PAUSED';
    
    uiDebugLog('roomFlow', '[UI] handleGameStart status', {
        status,
        msgType,
        roomId,
        playerIds: roomData.playerIds || [],
        playerCount: Array.isArray(roomData.playerIds) ? roomData.playerIds.length : 0,
        currentTurnPlayerId: roomData.currentTurnPlayerId,
        ballInHand: roomData.ballInHand,
        ballInHandZone: roomData.ballInHandZone,
    });

    // 获取 URL 参数
    const urlParams = new URLSearchParams(window.location.search);
    const hideTopView = urlParams.get('hideTopView') === '1';

    // 核心保护：只有对局相关状态才允许进入游戏画面
    if (!isActiveRoomStatus && !hideTopView) {
        uiDebugLog('roomFlow', '[UI] Keep matchmaking view because room is not active', { status, roomId });
        updateGameplayRoomChrome();
        showOverlay();
        showMatchmakingView('已进入房间，正在等待对手。', {
            title: '等待对手加入',
            badge: '已进房',
            footnote: '分享房间号给好友，对方进入后将自动开局。',
            roomId,
            state: 'waiting-opponent',
            cancelLabel: '返回大厅',
        });
        return;
    }

    // 只有状态明确为 PLAYING 时，才允许关闭遮罩并初始化/开始游戏
    uiDebugLog('roomFlow', '[UI] Transition to game view', { status, roomId });
    showGameView();

    // --- 核心修复：只有在 PLAYING 时才初始化游戏，防止 WAITING 时 Canvas 背景露出 ---
    const isPlaying = isActiveRoomStatus;
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

        if (roomData.lastShotId) window.game.lastAppliedShotId = roomData.lastShotId;
        if (roomData.lastShotPlayerId) window.game.lastKnownShotPlayerId = roomData.lastShotPlayerId;
        if (roomData.lastShotProtocol) window.game.lastKnownShotProtocol = roomData.lastShotProtocol;
        if (roomData.lastShotStartedAt) window.game.lastKnownShotStartedAt = roomData.lastShotStartedAt;
        if (roomData.lastSettledSignature) window.game.lastSettledSignature = roomData.lastSettledSignature;

        if (roomData.ballState) {
            const restoredSnapshot = Array.isArray(roomData.ballState) ? { balls: roomData.ballState } : roomData.ballState;
            window.game.applyGameStateSnapshot(restoredSnapshot);
            window.game.awaitingSettledSync = roomData.awaitingSettledSync === true
                ? true
                : window.game.hasSnapshotMotion(restoredSnapshot);
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
 * 根据对手广播的击球初始条件重放本次出杆。
 * @param {Object} data - 击球初始条件。
 */
window.handleRemoteShoot = (data) => {
    if (window.game) {
        window.game.executeRemoteShoot(data);
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
    logCueRespawnFlow('handleShotStartAccepted.received', {
        senderId,
        localPlayerId: GameClient.playerId,
        isOwnOptimisticShot,
        roomStatus: room.status || '',
        shotId: shot.shotId || '',
        turnId: shot.turnId,
        stateVersion: shot.stateVersion,
        shotToken: shot.shotToken || '',
        cueBallX: shot.cueBallX,
        cueBallY: shot.cueBallY,
        aimAngle: shot.aimAngle,
        powerRatio: shot.powerRatio,
    })
    if (!isOwnOptimisticShot) {
        window.game.executeAcceptedShotInput(shot)
    } else {
        window.game.executeAcceptedShotInput(shot)
        window.game.reconcileAcceptedShot(shot)
        window.game.pendingShotRequest = null
    }
    window.game.updateUI()
}

window.handleShotResult = (payload) => {
    if (!window.game) return
    const room = payload.room || {}
    const playerIds = room.playerIds || []
    const cueBall = Array.isArray(payload.finalBallState)
        ? payload.finalBallState.find(ball => ball?.type === 'cue')
        : null
    if (payload.ballInHand || payload.statusMessage?.includes('白球落袋') || cueBall?.pocketed) {
        logCueRespawnFlow('handleShotResult.received', {
            statusMessage: payload.statusMessage || '',
            payloadBallInHand: payload.ballInHand,
            payloadBallInHandZone: payload.ballInHandZone,
            roomBallInHand: room.ballInHand,
            roomBallInHandZone: room.ballInHandZone,
            cueBall,
        })
    }
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
    const roomCueBall = Array.isArray(room.ballState)
        ? room.ballState.find(ball => ball?.type === 'cue')
        : Array.isArray(room.ballState?.balls)
            ? room.ballState.balls.find(ball => ball?.type === 'cue')
            : null
    if (room.ballInHand || roomCueBall?.pocketed) {
        logCueRespawnFlow('handleRoomSnapshot.received', {
            roomBallInHand: room.ballInHand,
            roomBallInHandZone: room.ballInHandZone,
            cueBall: roomCueBall,
            status: room.status,
            turnId: room.turnId,
            stateVersion: room.stateVersion,
        })
    }
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
        const roomCueBall = Array.isArray(stateData?.room?.ballState)
            ? stateData.room.ballState.find(ball => ball?.type === 'cue')
            : Array.isArray(stateData?.room?.ballState?.balls)
                ? stateData.room.ballState.balls.find(ball => ball?.type === 'cue')
                : null
        const directCueBall = Array.isArray(stateData?.balls)
            ? stateData.balls.find(ball => ball?.type === 'cue')
            : null
        if (stateData?.ballInHand === true || stateData?.room?.ballInHand === true || roomCueBall?.pocketed || directCueBall?.pocketed) {
            logCueRespawnFlow('handleRemoteStateSync.received', {
                syncKind: stateData?.syncKind || '',
                authoritative: stateData?.authoritative === true,
                ballInHand: stateData?.ballInHand ?? stateData?.room?.ballInHand ?? null,
                ballInHandZone: stateData?.ballInHandZone || stateData?.room?.ballInHandZone || '',
                roomCueBall,
                directCueBall,
                currentTurnPlayerId: stateData?.room?.currentTurnPlayerId || '',
            })
        }
        uiDebugLog('syncFlow', '[UI] apply remote state sync', {
            syncKind: stateData?.syncKind || 'unknown',
            authoritative: stateData?.authoritative === true,
            ballInHand: stateData?.ballInHand ?? stateData?.room?.ballInHand ?? null,
            ballInHandZone: stateData?.ballInHandZone || stateData?.room?.ballInHandZone || '',
            currentTurnPlayerId: stateData?.room?.currentTurnPlayerId || '',
        });
        const isAuthoritativeSettled = stateData?.authoritative === true && stateData?.syncKind === 'authoritative-settled';
        const localSettledSignature = isAuthoritativeSettled && typeof window.game.createSettledSignature === 'function'
            ? window.game.createSettledSignature()
            : null;
        const remoteSettledSignature = typeof stateData?.lastSettledSignature === 'string' && stateData.lastSettledSignature
            ? stateData.lastSettledSignature
            : stateData?.room?.lastSettledSignature;

        window.game.applyGameStateSnapshot(stateData);

        if (remoteSettledSignature) {
            const driftDetected = !!(localSettledSignature && remoteSettledSignature && localSettledSignature !== remoteSettledSignature);
            window.game.lastSettledSignature = remoteSettledSignature;
            if (driftDetected) {
                window.game.isDragging = false;
                window.game.pullDistance = 0;
                window.game.showRemoteCue = false;
                window.game.setStatusMessage('球桌状态已按房间权威结果校正', 2200);
                window.game.updateUI();
            }
        }
    }
};

/**
 * 处理服务端拒绝本地 settled 对账的回调。
 * 这类拒绝是非致命的，说明客户端本地视角已经落后，应继续等待权威状态。
 * @param {Object} payload - 服务端返回的拒绝信息。
 */
window.handleSyncRejected = (payload) => {
    if (!window.game) return;
    if (payload?.activeShotId) {
        window.game.lastAppliedShotId = payload.activeShotId;
    }
    if (payload?.room?.lastShotPlayerId) window.game.lastKnownShotPlayerId = payload.room.lastShotPlayerId;
    if (payload?.room?.lastShotProtocol) window.game.lastKnownShotProtocol = payload.room.lastShotProtocol;
    if (payload?.room?.lastShotStartedAt) window.game.lastKnownShotStartedAt = payload.room.lastShotStartedAt;
    if (typeof payload?.room?.lastSettledSignature === 'string' && payload.room.lastSettledSignature) {
        window.game.lastSettledSignature = payload.room.lastSettledSignature;
    }

    const authoritativeSnapshot = payload?.authoritativeSnapshot;
    if (authoritativeSnapshot) {
        window.game.applyGameStateSnapshot(authoritativeSnapshot);
    }

    window.game.awaitingSettledSync = payload?.room?.awaitingSettledSync === true;
    window.game.isDragging = false;
    window.game.pullDistance = 0;
    window.game.showRemoteCue = false;
    window.game.setStatusMessage(
        authoritativeSnapshot ? '已回补房间权威状态' : '本地对账已过期，正在等待房间权威状态',
        2200,
    );
    window.game.updateUI();
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
        window.game.awaitingSettledSync = false;
        
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
    const payload = (message && typeof message === 'object') ? message : null;
    const errorMessage = payload?.message || message || '加入房间失败';
    const errorCode = payload?.code || '';
    const isShotStartRejected = errorCode === 'SHOT_START_REJECTED' || errorMessage.includes('当前不能出杆');
    const isShotRollback = errorMessage.includes('本杆');
    const isInGameSoftError = !!window.game && (isShotStartRejected || isShotRollback);

    if (isInGameSoftError) {
        if (payload?.room) {
            const room = payload.room;
            window.game.roomPhase = room.status || 'PLAYING';
            window.game.turnId = room.turnId ?? window.game.turnId;
            window.game.stateVersion = room.stateVersion ?? window.game.stateVersion;
            window.game.shotToken = room.shotToken ?? window.game.shotToken;
            window.game.stateHash = room.stateHash || window.game.stateHash;
        }
        window.game.rollbackToSettledSnapshot(errorMessage);
        window.game.showRemoteCue = false;
        window.game.isTurnLocked = false;
        window.game.updateUI();
        return;
    }

    GameClient.cancelMatchmaking();
    showLobbyView();
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

document.getElementById('btn-settings')?.addEventListener('click', () => {
    if (window.game?.setStatusMessage) {
        window.game.setStatusMessage('设置面板开发中，后续可在这里切音乐', 1800);
    }
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

window.addEventListener('online', () => {
    updateGameplayRoomChrome();
    // 网络恢复时，如果有保存的连接参数且当前未连接，尝试重连
    if (GameClient.lastConnectionParams && GameClient.connectionState === 'idle') {
        console.log('[Network] Network restored, attempting reconnect...');
        const { nickname, onConnected, requestedRoomId } = GameClient.lastConnectionParams;
        GameClient.reconnectAttempts = 0;  // 重置重连计数
        GameClient.connect(nickname, onConnected, requestedRoomId);
    }
});

window.addEventListener('offline', () => {
    updateGameplayRoomChrome();
    console.log('[Network] Network lost');
});

// 禁止手机侧滑返回手势（但不影响游戏控制区域）
let touchStartX = 0;
let touchStartY = 0;
let touchStartTarget = null;

document.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    touchStartTarget = e.target;
}, { passive: false });

document.addEventListener('touchmove', (e) => {
    // 检查是否在游戏控制区域内（力度条、滚轮、画布）
    const isInGameControl =
        touchStartTarget?.closest('#power-strip') ||
        touchStartTarget?.closest('#aim-wheel') ||
        touchStartTarget?.closest('.control-column-left') ||
        touchStartTarget?.closest('.control-column-right') ||
        touchStartTarget?.closest('#game-canvas');

    // 如果在游戏控制区域内，不阻止滑动
    if (isInGameControl) {
        return;
    }

    const touchCurrentX = e.touches[0].clientX;
    const touchCurrentY = e.touches[0].clientY;
    const deltaX = touchCurrentX - touchStartX;
    const deltaY = touchCurrentY - touchStartY;

    // 如果是水平滑动（侧滑手势），阻止默认行为
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 10) {
        // 特别是从屏幕边缘开始的滑动（侧滑返回手势）
        if (touchStartX < 50 || touchStartX > window.innerWidth - 50) {
            if (e.cancelable) {
                e.preventDefault();
            }
        }
    }
}, { passive: false });

// 全局防止文本选中（针对 iOS WKWebView 的额外保护）
const preventTextSelection = (e) => {
    try {
        const selection = window.getSelection?.();
        if (selection && selection.rangeCount > 0) {
            selection.removeAllRanges();
            if (selection.empty) selection.empty();
        }
        if (document.selection) {
            document.selection.empty();
        }
    } catch (err) {
        // 忽略选择清理错误
    }
};

// 监听选择变化事件
document.addEventListener('selectionchange', preventTextSelection, { passive: true });

// 定期清理选择（针对某些 iOS 版本的额外保护）
setInterval(preventTextSelection, 300);

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
        uiDebugLog('roomFlow', '[UI] Connecting to room', { roomId: targetRoom });
    }, targetRoom);
}
