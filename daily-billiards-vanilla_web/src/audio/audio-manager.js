/**
 * @file audio-manager.js
 * @description 使用 Web Audio API 管理游戏音频。
 * 包括用于球体碰撞、击球、入袋和 UI 事件的过程式音效生成。
 */

/**
 * 负责处理所有音频合成和播放的类。
 */
export class AudioManager {
  /**
   * 初始化音频管理器，设置默认状态。
   */
  constructor() {
    /** @type {AudioContext|null} Web Audio API 上下文。 */
    this.context = null;
    /** @type {GainNode|null} 主音量控制节点。 */
    this.masterGain = null;
    /** @type {boolean} 音频功能是否可用并启用。 */
    this.enabled = true;
    /** @type {boolean} 音频上下文是否已由用户交互解锁。 */
    this.unlocked = false;
    /** @type {Promise|null} 解锁过程中的 Promise 引用。 */
    this.unlockPromise = null;
    /** @type {number} 上一次球碰撞音效播放的时间戳。 */
    this.lastCollisionAt = 0;
    /** @type {number} 上一次撞库音效播放的时间戳。 */
    this.lastRailAt = 0;
    /** @type {number} 上一次进球音效播放的时间戳。 */
    this.lastPocketAt = 0;
  }

  /**
   * 确保 AudioContext 已初始化并返回它。
   * @param {boolean} [createIfNeeded=false] - 如果不存在是否创建新上下文。
   * @returns {AudioContext|null} 活动的 AudioContext，如果禁用或不支持则返回 null。
   */
  ensureContext(createIfNeeded = false) {
    if (!this.enabled) return null;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      this.enabled = false;
      return null;
    }
    if (!this.context) {
      if (!createIfNeeded) return null;
      this.context = new AudioContextClass();
      this.masterGain = this.context.createGain();
      this.masterGain.gain.value = 0.9;
      this.masterGain.connect(this.context.destination);
    }
    return this.context;
  }

  /**
   * 解锁 AudioContext（通常需要用户首次点击或触摸后调用）。
   * @returns {Promise<boolean>} 如果解锁成功则解析为 true 的 Promise。
   */
  unlock() {
    const ctx = this.ensureContext(true);
    if (!ctx) return Promise.resolve(false);
    if (this.unlocked && ctx.state === 'running') return Promise.resolve(true);
    // 浏览器通常要求首次真实手势后才能启用音频，这里把并发解锁合并成一次，
    // 避免一次点击触发多个 UI 入口时重复 resume/context warm-up。
    if (this.unlockPromise) return this.unlockPromise;

    const resumePromise =
      ctx.state === 'suspended' ? ctx.resume().catch(() => {}) : Promise.resolve();

    this.unlockPromise = Promise.resolve(resumePromise)
      .then(() => {
        const buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(this.masterGain);
        source.start(0);
        this.unlocked = ctx.state === 'running';
        this.unlockPromise = null;
        return this.unlocked;
      })
      .catch(() => {
        this.unlockPromise = null;
        this.unlocked = false;
        return false;
      });

    return this.unlockPromise;
  }

  /**
   * 基于幅度包络播放合成音效。
   * @param {Object} options - 音效合成选项。
   * @param {number} [options.frequency=440] - 基础频率 (Hz)。
   * @param {string} [options.type='sine'] - 振荡器类型 ('sine', 'square', 'sawtooth', 'triangle')。
   * @param {number} [options.duration=0.08] - 音效的主持续时间（秒）。
   * @param {number} [options.volume=0.5] - 峰值音量。
   * @param {number} [options.attack=0.005] - 攻击（Attack）时间（秒）。
   * @param {number} [options.release=0.08] - 释放（Release）时间（秒）。
   * @param {number} [options.detune=0] - 细微调音偏移量（音分）。
   * @param {Object} [options.filter=null] - 可选的二阶滤波器配置。
   * @param {boolean} [options.noise=false] - 是否生成白噪声而非振荡器音。
   */
  playEnvelope({
    frequency = 440,
    type = 'sine',
    duration = 0.08,
    volume = 0.5,
    attack = 0.005,
    release = 0.08,
    detune = 0,
    filter = null,
    noise = false
  }) {
    if (!this.unlocked) return;
    const ctx = this.ensureContext(false);
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    // 所有过程式音效最终都会落到这个基础包络上，具体的击球/碰撞/入袋只是参数预设。

    let source;
    if (noise) {
      const bufferSize = ctx.sampleRate * (duration + release);
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      source = ctx.createBufferSource();
      source.buffer = buffer;
    } else {
      const oscillator = ctx.createOscillator();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, now);
      oscillator.detune.setValueAtTime(detune, now);
      source = oscillator;
    }

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(volume, now + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration + release);

    let lastNode = source;
    if (filter) {
      const biquad = ctx.createBiquadFilter();
      biquad.type = filter.type;
      biquad.frequency.setValueAtTime(filter.frequency, now);
      if (filter.releaseFreq) {
          biquad.frequency.exponentialRampToValueAtTime(filter.releaseFreq, now + duration + release);
      }
      biquad.Q.setValueAtTime(filter.q || 1, now);
      source.connect(biquad);
      lastNode = biquad;
    }

    lastNode.connect(gain);
    gain.connect(this.masterGain);

    source.start(now);
    if (!noise) source.stop(now + duration + release + 0.02);
  }

  /**
   * 播放球杆击打母球的声音。
   * @param {number} powerRatio - 击球力度比例 (0 到 1)。
   */
  playShot(powerRatio) {
    // 击球声：木质撞击 + 轻微白噪声
    this.playEnvelope({
      frequency: 120 + powerRatio * 100,
      type: 'triangle',
      duration: 0.02,
      volume: 0.8 + powerRatio * 0.4,
      attack: 0.001,
      release: 0.05,
      filter: { type: 'lowpass', frequency: 1200, releaseFreq: 200 }
    });
    this.playEnvelope({
      noise: true,
      duration: 0.01,
      volume: 0.1 + powerRatio * 0.2,
      attack: 0.001,
      release: 0.02,
      filter: { type: 'bandpass', frequency: 2000, q: 5 }
    });
  }

  /**
   * 播放球与球碰撞的声音。
   * @param {number} [intensity=0.4] - 撞击强度 (0 到 1)。
   */
  playBallCollision(intensity = 0.4) {
    const now = performance.now();
    // 连续碰撞在同一帧内可能触发很多次，做节流是为了避免耳朵里变成噪音墙。
    if (now - this.lastCollisionAt < 30) return;
    this.lastCollisionAt = now;

    // 球碰撞声：高频清脆撞击
    this.playEnvelope({
      frequency: 600 + intensity * 400,
      type: 'sine',
      duration: 0.01,
      volume: 0.4 + intensity * 0.3,
      attack: 0.001,
      release: 0.03,
      filter: { type: 'highpass', frequency: 800 }
    });
  }

  /**
   * 播放球与库边碰撞的声音。
   * @param {number} [intensity=0.35] - 撞击强度 (0 到 1)。
   */
  playRailHit(intensity = 0.35) {
    const now = performance.now();
    // 撞库和球碰撞都会在密集运动时频繁出现，单独限流可以保留反馈而不至于炸音。
    if (now - this.lastRailAt < 40) return;
    this.lastRailAt = now;

    // 撞库声：低沉的闷响
    this.playEnvelope({
      frequency: 80 + intensity * 60,
      type: 'triangle',
      duration: 0.04,
      volume: 0.5 + intensity * 0.3,
      attack: 0.002,
      release: 0.1,
      filter: { type: 'lowpass', frequency: 400, releaseFreq: 50 }
    });
  }

  /**
   * 播放球掉入球袋的声音。
   */
  playPocket() {
    const now = performance.now();
    // 入袋声保留更长的冷却，避免母球和目标球连环落袋时叠出失真的长尾。
    if (now - this.lastPocketAt < 80) return;
    this.lastPocketAt = now;
    this.playEnvelope({
      frequency: 220,
      type: 'sine',
      duration: 0.08,
      volume: 0.42,
      attack: 0.003,
      release: 0.12,
      detune: -40,
      filter: { type: 'lowpass', frequency: 520 },
    });
    this.playEnvelope({
      frequency: 330,
      type: 'triangle',
      duration: 0.06,
      volume: 0.26,
      attack: 0.002,
      release: 0.1,
      detune: 10,
      filter: { type: 'lowpass', frequency: 700 },
    });
  }

  /**
   * 播放犯规提示音。
   */
  playFoul() {
    this.playEnvelope({
      frequency: 180,
      type: 'sawtooth',
      duration: 0.12,
      volume: 0.38,
      attack: 0.002,
      release: 0.16,
      detune: -120,
      filter: { type: 'lowpass', frequency: 420 },
    });
  }

  /**
   * 播放游戏获胜提示音。
   */
  playWin() {
    this.playEnvelope({
      frequency: 520,
      type: 'triangle',
      duration: 0.1,
      volume: 0.4,
      attack: 0.003,
      release: 0.12,
      filter: { type: 'lowpass', frequency: 1200 },
    });
    this.playEnvelope({
      frequency: 660,
      type: 'triangle',
      duration: 0.14,
      volume: 0.32,
      attack: 0.01,
      release: 0.14,
      filter: { type: 'lowpass', frequency: 1500 },
    });
  }
}
