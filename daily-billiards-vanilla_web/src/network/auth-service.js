/**
 * @file auth-service.js
 * @description 处理用户注册、登录、登出以及身份令牌的管理。
 */

import { resolveServerOrigin } from './game-client.js';

const TOKEN_KEY = 'billiards_jwt_token';
const USER_KEY = 'billiards_user_info';

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
        localStorage.setItem(TOKEN_KEY, authData.token);
        localStorage.setItem(USER_KEY, JSON.stringify({
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
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        sessionStorage.removeItem('billiards_player_id');
        sessionStorage.removeItem('billiards_nickname');
    },

    /**
     * 获取当前 JWT 令牌
     * @returns {string|null}
     */
    getToken() {
        return localStorage.getItem(TOKEN_KEY);
    },

    /**
     * 获取当前用户信息
     * @returns {Object|null}
     */
    getUser() {
        const userStr = localStorage.getItem(USER_KEY);
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
        
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        return fetch(url, {
            ...options,
            headers
        });
    }
};
