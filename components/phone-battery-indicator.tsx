"use client";

import { useBatteryStatus } from "@/lib/use-battery-status";

/** 低于此电量电量格显示黄色（20%）。 */
const LOW_BATTERY = 0.2;
/** 低于此电量电量格显示红色（5%）。 */
const CRITICAL_BATTERY = 0.05;

const COLOR_LOW = "#ffcc00";
const COLOR_CRITICAL = "#ff3b30";
const COLOR_CHARGING = "#34c759";

// 电池几何（沿用原静态图标坐标系）：外壳 26×12，内部可填充区 2 → 21.4。
const FILL_X = 2;
const FILL_MAX_WIDTH = 19.4;
const FILL_MIN_WIDTH = 1;
/** 读不到电量时的静态格宽度，保持改造前的外观。 */
const FILL_FALLBACK_WIDTH = 14;

/**
 * 状态栏电池指示器。外壳与尾巴跟随 --status-bar-color（与信号、WiFi 同色），
 * 只有电量格随状态变色：<20% 黄、<5% 红、充电中绿，其余为同色半透明。
 * 不支持读取电量的环境（iOS Safari / Firefox）回落成改造前一致的静态图标。
 */
export function PhoneBatteryIndicator() {
  const { supported, level, charging } = useBatteryStatus();
  const hasLevel = supported && level !== null;
  const ratio = hasLevel ? Math.min(1, Math.max(0, level)) : 0;

  // 充电高亮优先于低电量
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

  const label = !hasLevel
    ? "电池（当前环境无法读取设备电量）"
    : `电量 ${Math.round(ratio * 100)}%${charging ? "，充电中" : ""}`;

  return (
    <svg
      viewBox="0 0 26 12"
      className="status-battery"
      role="img"
      aria-label={label}
      fill="currentColor"
    >
      <title>{label}</title>
      <rect x="0.5" y="0.5" width="22" height="11" rx="2.6" fill="none" stroke="currentColor" strokeOpacity="0.42" strokeWidth="1" />
      <rect x="22.7" y="4" width="1.8" height="4" rx="0.7" opacity="0.42" />
      <rect
        x={FILL_X}
        y="2"
        width={fillWidth}
        height="8"
        rx="1.5"
        fill={fillColor || "currentColor"}
        opacity={fillColor ? 1 : 0.42}
      />
    </svg>
  );
}
