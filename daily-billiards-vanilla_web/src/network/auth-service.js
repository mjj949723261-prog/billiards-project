/**
 * @file auth-service.js
 * @description 处理用户注册、登录、登出以及身份令牌的管理。
 */

import { resolveServerOrigin } from './game-client.js?v=20260509_room_join_snapshot_fix';

const TOKEN_KEY = 'billiards_jwt_token';
const USER_KEY = 'billiards_user_info';

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

const localStore = typeof globalThis.localStorage !== 'undefined'
    ? globalThis.localStorage
    : createMemoryStorage();

const sessionStore = typeof globalThis.sessionStorage !== 'undefined'
    ? globalThis.sessionStorage
    : createMemoryStorage();

export const AuthService = {
    /**
     * 用户登录
     * @param {string} username 
     * @param {string} password 
     * @returns {Promise<Object>} 登录结果
     */
    async login(username, password) {
        const response = await fetch(`${resolveServerOrigin()}/api/auth/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || '登录失败');
        }

        const data = await response.json();
        this.saveSession(data);
        return data;
    },

    /**
     * 用户注册
     * @param {Object} userData {username, password, nickname, email}
     * @returns {Promise<Object>} 注册结果
     */
    async register(userData) {
        const response = await fetch(`${resolveServerOrigin()}/api/auth/register`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(userData)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || '注册失败');
        }

        return await response.json();
    },

    /**
     * 保存会话信息到 localStorage
     * @param {Object} authData 
     */
    saveSession(authData) {
        // 登录态放 localStorage，保证刷新或重新打开后还能恢复账号玩家身份；
        // 游客 playerId 则仍交给 sessionStorage，避免访客状态无限长期滞留。
        localStore.setItem(TOKEN_KEY, authData.token);
        localStore.setItem(USER_KEY, JSON.stringify({
            id: authData.id,
            username: authData.username,
            nickname: authData.nickname,
            email: authData.email
        }));
    },

    /**
     * 退出登录，清理本地存储
     */
    logout() {
        localStore.removeItem(TOKEN_KEY);
        localStore.removeItem(USER_KEY);
        // 退出账号时顺带清游客会话，避免账号/游客身份在同一设备上串线。
        sessionStore.removeItem('billiards_player_id');
        sessionStore.removeItem('billiards_nickname');
    },

    /**
     * 获取当前 JWT 令牌
     * @returns {string|null}
     */
    getToken() {
        return localStore.getItem(TOKEN_KEY);
    },

    /**
     * 获取当前用户信息
     * @returns {Object|null}
     */
    getUser() {
        const userStr = localStore.getItem(USER_KEY);
        return userStr ? JSON.parse(userStr) : null;
    },

    /**
     * 检查是否已登录
     * @returns {boolean}
     */
    isLoggedIn() {
        return !!this.getToken();
    },

    /**
     * 封装带 Token 的 fetch 请求
     * @param {string} url 
     * @param {Object} options 
     */
    async authenticatedFetch(url, options = {}) {
        const token = this.getToken();
        const headers = options.headers || {};
        
        // 统一从这里补 Authorization，避免各业务模块自己拼 JWT 头而出现漏传。
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        return fetch(url, {
            ...options,
            headers
        });
    }
};
