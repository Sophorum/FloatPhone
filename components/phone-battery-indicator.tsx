"use client";

import { useBatteryStatus } from "@/lib/use-battery-status";

/** 低于此电量电量格显示黄色（20%）。 */
const LOW_BATTERY = 0.2;
/** 低于此电量电量格显示红色（5%）。 */
const CRITICAL_BATTERY = 0.05;

/** 低电量黄 / 危急红 / 充电绿，与安卓原生状态栏观感一致。 */
const COLOR_LOW = "#ffcc00";
const COLOR_CRITICAL = "#ff3b30";
const COLOR_CHARGING = "#34c759";

// 电池几何（沿用原静态图标坐标系）：外壳 26×12，内部可填充区 2 → 21.4。
const FILL_X = 2;
const FILL_MAX_WIDTH = 19.4;
const FILL_MIN_WIDTH = 1;
/** 读不到电量时的静态格宽度，保持改造前的外观。 */
const FILL_FALLBACK_WIDTH = 14;
/** 数字的垂直/水平中心：外壳中心偏左一点，避开右侧电池尾巴。 */
const NUM_X = 11.4;
const NUM_Y = 6;

/**
 * 桌面状态栏右侧的电池指示器。
 *
 * 视觉分工（只有电量格会变色）：
 *   外壳 / 电池尾巴 / 数字 → currentColor，跟信号、WiFi 图标完全同一套颜色，
 *   由 --status-bar-color 自动适应明暗背景；
 *   电量格 → <20% 黄、<5% 红、充电中绿，其余情况也是 currentColor 半透明。
 * 电量数字嵌在电池中间（安卓原生布局）。
 * 环境不支持读取电量时（iOS Safari / Firefox）不显示数字，回落成与改造前一致的静态图标。
 */
export function PhoneBatteryIndicator() {
  const { supported, level, charging } = useBatteryStatus();
  const hasLevel = supported && level !== null;
  const ratio = hasLevel ? Math.min(1, Math.max(0, level)) : 0;
  const percent = hasLevel ? Math.round(ratio * 100) : null;

  // 充电高亮优先于低电量：插着电时「在充电」是更需要被看见的信息。
  const fillColor = !hasLevel
    ? null
    : charging
      ? COLOR_CHARGING
      : ratio < CRITICAL_BATTERY
        ? COLOR_CRITICAL
        : ratio < LOW_BATTERY
          ? COLOR_LOW
          : null;

  const fillWidth = hasLevel
    ? Math.max(FILL_MIN_WIDTH, FILL_MAX_WIDTH * ratio)
    : FILL_FALLBACK_WIDTH;

  const label =
    percent === null
      ? "电池（当前环境无法读取设备电量）"
      : `电量 ${percent}%${charging ? "，充电中" : ""}`;

  return (
    <svg
      viewBox="0 0 26 12"
      className="status-battery"
      role="img"
      aria-label={label}
      fill="currentColor"
    >
      <title>{label}</title>
      {/* 外壳与尾巴：固定 currentColor，不随电量变色 */}
      <rect x="0.5" y="0.5" width="22" height="11" rx="2.6" fill="none" stroke="currentColor" strokeOpacity="0.42" strokeWidth="1" />
      <rect x="22.7" y="4" width="1.8" height="4" rx="0.7" opacity="0.42" />
      {/* 电量格：唯一随电量/充电变色的部分。
          常态用半透明 currentColor，压在它上面的数字（全不透明）才看得清。 */}
      <rect
        x={FILL_X}
        y="2"
        width={fillWidth}
        height="8"
        rx="1.5"
        fill={fillColor || "currentColor"}
        opacity={fillColor ? 1 : 0.42}
      />
      {percent !== null ? (
        <text
          x={NUM_X}
          y={NUM_Y}
          textAnchor="middle"
          dominantBaseline="central"
          className="status-battery-num"
          fill="currentColor"
        >
          {percent}
        </text>
      ) : null}
    </svg>
  );
}
