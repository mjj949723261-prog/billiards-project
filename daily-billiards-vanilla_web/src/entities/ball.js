/**
 * @file ball.js
 * @description 表示一个台球实体。处理物理状态更新、用于渲染的 3D 旋转跟踪，
 * 以及球体颜色和类型属性。
 */

import { BALL_RADIUS, FRICTION, VELOCITY_THRESHOLD } from '../constants.js?v=20260429-room-entry-fix';
import { Vec2 } from '../math.js';

/**
 * 返回一个 3x3 单位矩阵。
 * @returns {Float32Array} 列主序（Column-major）的 3x3 单位矩阵。
 */
function mat3Identity() {
    return new Float32Array([1,0,0, 0,1,0, 0,0,1]);
}

/**
 * 两个 3x3 矩阵相乘。
 * @param {Float32Array} a - 第一个矩阵。
 * @param {Float32Array} b - 第二个矩阵。
 * @returns {Float32Array} 结果 3x3 矩阵。
 */
function mat3Multiply(a, b) {
    const out = new Float32Array(9);
    const a00 = a[0], a01 = a[1], a02 = a[2];
    const a10 = a[3], a11 = a[4], a12 = a[5];
    const a20 = a[6], a21 = a[7], a22 = a[8];

    const b00 = b[0], b01 = b[1], b02 = b[2];
    const b10 = b[3], b11 = b[4], b12 = b[5];
    const b20 = b[6], b21 = b[7], b22 = b[8];

    out[0] = b00 * a00 + b01 * a10 + b02 * a20;
    out[1] = b00 * a01 + b01 * a11 + b02 * a21;
    out[2] = b00 * a02 + b01 * a12 + b02 * a22;

    out[3] = b10 * a00 + b11 * a10 + b12 * a20;
    out[4] = b10 * a01 + b11 * a11 + b12 * a21;
    out[5] = b10 * a02 + b11 * a12 + b12 * a22;

    out[6] = b20 * a00 + b21 * a10 + b22 * a20;
    out[7] = b20 * a01 + b21 * a11 + b22 * a21;
    out[8] = b20 * a02 + b21 * a12 + b22 * a22;
    return out;
}

/**
 * 为给定的轴和角度创建一个 3x3 旋转矩阵（原始实现）。
 * @ignore
 */
function mat3Rotate(axisX, axisY, axisZ, angle) {
    const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
    const x = axisX, y = axisY, z = axisZ;
    return new Float32Array([
        t*x*x + c,   t*x*y + s*z, t*x*z - s*y,
        t*x*y - s*z, t*y*y + c,   t*y*z + s*x,
        t*x*z + s*y, t*y*z - s*x, t*z*z + c
    ].map((v, i, a) => {
        // 将原有的行主序逻辑转换为列主序输出
        const row = Math.floor(i / 3);
        const col = i % 3;
        return v; 
    }));
}

/**
 * 以列主序（Column-major）为给定的轴和角度创建一个 3x3 旋转矩阵。
 * @param {number} axisX - 旋转轴的 X 分量。
 * @param {number} axisY - 旋转轴的 Y 分量。
 * @param {number} axisZ - 旋转轴的 Z 分量。
 * @param {number} angle - 旋转角度（弧度）。
 * @returns {Float32Array} 3x3 旋转矩阵。
 */
function mat3RotateColMajor(axisX, axisY, axisZ, angle) {
    const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
    const x = axisX, y = axisY, z = axisZ;
    const out = new Float32Array(9);
    out[0] = x * x * t + c;
    out[1] = y * x * t + z * s;
    out[2] = z * x * t - y * s;
    out[3] = x * y * t - z * s;
    out[4] = y * y * t + c;
    out[5] = z * y * t + x * s;
    out[6] = x * z * t + y * s;
    out[7] = y * z * t - x * s;
    out[8] = z * z * t + c;
    return out;
}

/**
 * 对 3x3 矩阵进行正交规范化（Gram-Schmidt 过程）。
 * 确保旋转矩阵在插值后依然满足 SO(3) 约束。
 * @param {Float32Array} m - 待处理的 3x3 矩阵。
 * @returns {Float32Array} 处理后的矩阵。
 */
function mat3Normalize(m) {
    // 列向量 v1, v2, v3
    let v1 = {x: m[0], y: m[1], z: m[2]};
    let v2 = {x: m[3], y: m[4], z: m[5]};
    
    // Normalize v1
    let l1 = Math.sqrt(v1.x*v1.x + v1.y*v1.y + v1.z*v1.z);
    if (l1 < 1e-6) return m; // 防止除零
    v1.x /= l1; v1.y /= l1; v1.z /= l1;
    
    // Make v2 orthogonal to v1
    let dot12 = v1.x*v2.x + v1.y*v2.y + v1.z*v2.z;
    v2.x -= dot12 * v1.x; v2.y -= dot12 * v1.y; v2.z -= dot12 * v1.z;
    
    // Normalize v2
    let l2 = Math.sqrt(v2.x*v2.x + v2.y*v2.y + v2.z*v2.z);
    if (l2 < 1e-6) return m;
    v2.x /= l2; v2.y /= l2; v2.z /= l2;
    
    // v3 = v1 x v2
    let v3 = {
        x: v1.y * v2.z - v1.z * v2.y,
        y: v1.z * v2.x - v1.x * v2.z,
        z: v1.x * v2.y - v1.y * v2.x
    };
    
    m[0] = v1.x; m[1] = v1.y; m[2] = v1.z;
    m[3] = v2.x; m[4] = v2.y; m[5] = v2.z;
    m[6] = v3.x; m[7] = v3.y; m[8] = v3.z;
    return m;
}

/**
 * 表示球桌上的单个台球。
 */
export class Ball {
  /**
   * 创建一个 Ball 实例。
   * @param {number} x - 初始 X 坐标。
   * @param {number} y - 初始 Y 坐标。
   * @param {string} color - 十六进制颜色字符串。
   * @param {string} [type='solid'] - 球类型（'solid' 实色, 'stripe' 花色, 'eight' 黑八, 'cue' 母球）。
   * @param {string} [label=''] - 显示标签（如球号）。
   */
  constructor(x, y, color, type = 'solid', label = '') {
    /** @type {Vec2} 物理层位置。 */
    this.physicsPos = new Vec2(x, y);
    /** @type {Vec2} 物理层速度。 */
    this.physicsVel = new Vec2(0, 0);
    /** @type {string} 球的显示颜色。 */
    this.color = color;
    /** @type {string} 球的类型。 */
    this.type = type;
    /** @type {string} 球的标签。 */
    this.label = label;
    /** @type {boolean} 是否已入袋。 */
    this.pocketed = false;
    /** @type {Float32Array} 物理层旋转矩阵。 */
    this.physicsRot = mat3RotateColMajor(0, 1, 0, -Math.PI / 2);
    /** @type {Vec2} 渲染层位置。 */
    this.renderPos = this.physicsPos.clone();
    /** @type {Float32Array} 渲染层旋转矩阵。 */
    this.renderRot = new Float32Array(this.physicsRot);

    Object.defineProperties(this, {
      pos: {
        get: () => this.physicsPos,
        set: (value) => { this.physicsPos = value; },
      },
      vel: {
        get: () => this.physicsVel,
        set: (value) => { this.physicsVel = value; },
      },
      rotMat: {
        get: () => this.physicsRot,
        set: (value) => { this.physicsRot = value; },
      },
    });
    
    let hex = color;
    if (hex.startsWith('#')) hex = hex.slice(1);
    let intVal = parseInt(hex, 16);
    /** @type {Float32Array} 球体颜色的 RGB 分量（0.0 - 1.0）。 */
    this.colorRgb = new Float32Array([
        ((intVal >> 16) & 0xFF) / 255.0,
        ((intVal >> 8) & 0xFF) / 255.0,
        (intVal & 0xFF) / 255.0
    ]);
    if (this.type === 'cue') this.colorRgb = new Float32Array([1,1,1]);
  }

  /**
   * 更新下一帧球的位置、速度和旋转状态。
   * 应用摩擦力，并在速度低于阈值时使球停止运动。
   */
  update(dt = 1) {
    if (this.pocketed) return;
    const speed = this.physicsVel.length();
    this.physicsPos.add(this.physicsVel.clone().mul(dt));

    // 根据移动距离和方向更新 3D 旋转矩阵
    if (speed > 0.01) {
      const angle = (speed * dt) / BALL_RADIUS;
      const axisX = -this.physicsVel.y / speed;
      const axisY = this.physicsVel.x / speed;
      const rot = mat3RotateColMajor(axisX, axisY, 0, -angle);
      this.physicsRot = mat3Multiply(rot, this.physicsRot);
    }

    // 优化后的单一摩擦力模型
    // 1. 基础阻力
    this.physicsVel.mul(Math.pow(0.992, dt)); 

    // 2. 线性减速（模拟真实滚动摩擦直到完全静止）
    if (speed > 0) {
        const linearDecel = 0.005 * dt; 
        const drop = Math.min(speed, linearDecel);
        const ratio = (speed - drop) / speed;
        this.physicsVel.mul(ratio);
    }

    // 3. 静止阈值处理
    if (this.physicsVel.length() < VELOCITY_THRESHOLD) {
        this.physicsVel.x = 0;
        this.physicsVel.y = 0;
    }
  }

  /**
   * 让渲染层状态平滑追赶物理层状态。
   * @param {number} dt - 帧间隔时间（秒）。
   */
  updateRender(dt = 1 / 60) {
    const k = 18.0;
    const smoothFactor = 1.0 - Math.exp(-k * Math.max(0, dt));

    if (this.pocketed) {
      this.renderPos.x = this.physicsPos.x;
      this.renderPos.y = this.physicsPos.y;
      this.renderRot.set(this.physicsRot);
      return;
    }

    this.renderPos.x += (this.physicsPos.x - this.renderPos.x) * smoothFactor;
    this.renderPos.y += (this.physicsPos.y - this.renderPos.y) * smoothFactor;

    // 旋转矩阵平滑插值并正交规范化
    for (let i = 0; i < 9; i++) {
      this.renderRot[i] += (this.physicsRot[i] - this.renderRot[i]) * smoothFactor;
    }
    mat3Normalize(this.renderRot);
  }

  /**
   * 立即同步渲染层到物理层，用于停球后避免缓慢追赶。
   */
  syncPhysicsToRender() {
    this.renderPos.x = this.physicsPos.x;
    this.renderPos.y = this.physicsPos.y;
    this.renderRot.set(this.physicsRot);
  }
}
