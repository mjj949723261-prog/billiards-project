/**
 * @file ball.js
 * @description 表示一个台球实体。处理物理状态更新、用于渲染的 3D 旋转跟踪，
 * 以及球体颜色和类型属性。
 */

import { BALL_RADIUS, FRICTION, VELOCITY_THRESHOLD } from '../constants.js';
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
    /** @type {Vec2} 球的位置坐标。 */
    this.pos = new Vec2(x, y);
    /** @type {Vec2} 球的速度向量。 */
    this.vel = new Vec2(0, 0);
    /** @type {string} 球的显示颜色。 */
    this.color = color;
    /** @type {string} 球的类型。 */
    this.type = type;
    /** @type {string} 球的标签。 */
    this.label = label;
    /** @type {boolean} 是否已入袋。 */
    this.pocketed = false;
    /** @type {Float32Array} 跟踪球体在 3D 空间中的旋转矩阵。 */
    // 初始化旋转：绕 Y 轴旋转 -90 度，使局部 X 轴（数字面）指向观察者
    this.rotMat = mat3RotateColMajor(0, 1, 0, -Math.PI / 2);
    
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
  update(dtScale = 1) {
    if (this.pocketed) return;
    const speed = this.vel.length();
    this.pos.add(this.vel.clone().mul(dtScale));

    // 根据移动距离和方向更新 3D 旋转矩阵
    if (speed > 0.01) {
      const angle = (speed * dtScale) / BALL_RADIUS;
      const axisX = -this.vel.y / speed;
      const axisY = this.vel.x / speed;
      const rot = mat3RotateColMajor(axisX, axisY, 0, -angle);
      this.rotMat = mat3Multiply(rot, this.rotMat);
    }

    // 优化后的单一摩擦力模型
    // 1. 基础阻力
    this.vel.mul(Math.pow(0.992, dtScale)); 

    // 2. 线性减速（模拟真实滚动摩擦直到完全静止）
    if (speed > 0) {
        const linearDecel = 0.005; 
        const drop = Math.min(speed, linearDecel * dtScale);
        const ratio = (speed - drop) / speed;
        this.vel.mul(ratio);
    }

    // 3. 静止阈值处理
    if (this.vel.length() < VELOCITY_THRESHOLD) {
        this.vel = new Vec2(0, 0);
    }
  }
}
