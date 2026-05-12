/**
 * @file math.js
 * @description 实用数学库，提供用于物理模拟、碰撞检测和布局计算的 2D 向量操作。
 */

/**
 * 表示一个具有常用数学运算的二维向量（2D Vector）。
 */
export class Vec2 {
  /**
   * 创建一个 Vec2 实例。
   * @param {number} [x=0] - X 坐标。
   * @param {number} [y=0] - Y 坐标。
   */
  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }

  /**
   * 在原向量上加上另一个向量。
   * @param {Vec2} v - 要相加的向量。
   * @returns {Vec2} 返回自身以支持链式调用。
   */
  add(v) {
    // Vec2 设计成原地修改，物理和渲染循环里可以少分配很多临时对象。
    this.x += v.x;
    this.y += v.y;
    return this;
  }

  /**
   * 在原向量上减去另一个向量。
   * @param {Vec2} v - 要相减的向量。
   * @returns {Vec2} 返回自身以支持链式调用。
   */
  sub(v) {
    this.x -= v.x;
    this.y -= v.y;
    return this;
  }

  /**
   * 在原向量上乘以一个标量。
   * @param {number} s - 标量值。
   * @returns {Vec2} 返回自身以支持链式调用。
   */
  mul(s) {
    this.x *= s;
    this.y *= s;
    return this;
  }

  /**
   * 创建当前向量的一个副本。
   * @returns {Vec2} 具有相同坐标的新 Vec2 实例。
   */
  clone() {
    // 只有在确实需要保留旧值时才 clone，避免把所有运算都写成高频新建对象。
    return new Vec2(this.x, this.y);
  }

  /**
   * 计算向量的欧几里得长度（模）。
   * @returns {number} 向量的长度。
   */
  length() {
    return Math.sqrt(this.x * this.x + this.y * this.y);
  }

  /**
   * 在原向量上进行单位化处理（将其长度设为 1）。
   * @returns {Vec2} 返回自身以支持链式调用。
   */
  normalize() {
    const len = this.length();
    if (len > 0) {
      this.x /= len;
      this.y /= len;
    }
    return this;
  }

  /**
   * 计算当前向量与另一个向量的点积（内积）。
   * @param {Vec2} v - 另一个向量。
   * @returns {number} 点积结果。
   */
  dot(v) {
    return this.x * v.x + this.y * v.y;
  }

  /**
   * 计算两个向量（点）之间的欧几里得距离。
   * @param {Vec2} v1 - 第一个向量。
   * @param {Vec2} v2 - 第二个向量。
   * @returns {number} v1 和 v2 之间的距离。
   */
  static distance(v1, v2) {
    // 保留静态版本，方便在只关心两点距离时不必先构造差向量。
    return Math.sqrt((v1.x - v2.x) ** 2 + (v1.y - v2.y) ** 2);
  }
}
