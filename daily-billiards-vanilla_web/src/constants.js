/**
 * @file constants.js
 * @description 定义台球游戏的全局物理常量、球桌尺寸、得分规则和时间设置。
 * 该文件作为游戏配置的中心，确保物理模拟和 UI 渲染的一致性。
 */

/** @type {number} 可击球的球桌内沿宽度（像素）。 */
export const TABLE_WIDTH = 820;

/** @type {number} 可击球的球桌内沿高度（像素）。 */
export const TABLE_HEIGHT = 410;

/** @type {number} 球桌边框（库边）的厚度（像素）。 */
export const RAIL_THICKNESS = 34;

/** @type {number} 每个台球的半径（像素）。 */
export const BALL_RADIUS = 14;

/** @type {number} 每个球袋的半径（像素）。 */
export const POCKET_RADIUS = 22;

/** @type {number} 应用于击球力量的缩放系数。 */
export const SHOT_POWER_SCALE = 0.15;

/** @type {number} 每帧应用于球速的全局摩擦力系数。 */
export const FRICTION = 0.994;

/** @type {number} 球撞击库边时的速度保留系数（反弹系数）。 */
export const WALL_BOUNCE = 0.85;

/** @type {number} 两个球碰撞时的速度保留系数。 */
export const BALL_BOUNCE = 0.96;

/** @type {number} 球被视为停止运动的最小速度阈值。 */
export const VELOCITY_THRESHOLD = 0.01;

/** @type {number} 每回合的限制时间（秒）。 */
export const TURN_TIME_LIMIT = 45;

/** @type {number} 球杆可以向后拉伸的最大距离（像素）。 */
export const MAX_PULL_DISTANCE = 150;

/** @type {number} 母球击出瞬间的闪光效果持续时间（秒）。 */
export const RELEASE_FLASH_DURATION = 0.18;

/** @type {number} 进球得分效果的持续时间（秒）。 */
export const POCKET_SCORE_EFFECT_DURATION = 0.42;

/** @type {number} 包含库边在内的球桌逻辑总宽度。 */
export const LOGICAL_WIDTH = TABLE_WIDTH + RAIL_THICKNESS * 2;

/** @type {number} 包含库边在内的球桌逻辑总高度。 */
export const LOGICAL_HEIGHT = TABLE_HEIGHT + RAIL_THICKNESS * 2;

/** @type {number} 竖屏布局模式下的逻辑总宽度。 */
export const PORTRAIT_LOGICAL_WIDTH = TABLE_HEIGHT + RAIL_THICKNESS * 2;

/** @type {number} 竖屏布局模式下的逻辑总高度。 */
export const PORTRAIT_LOGICAL_HEIGHT = TABLE_WIDTH + RAIL_THICKNESS * 2;

/** @type {number} 开球线（Head String）的 X 坐标（母球在开球时放置的界限）。 */
export const HEAD_STRING_X = -TABLE_WIDTH / 4;
