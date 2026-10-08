"use client";

import type { CSSProperties } from "react";

import { useBatteryStatus } from "@/lib/use-battery-status";

/** 低于此电量显示黄色（20%）。 */
const LOW_BATTERY = 0.2;
/** 低于此电量显示红色（5%）。 */
const CRITICAL_BATTERY = 0.05;

/** 低电量黄 / 危急红 / 充电绿，与安卓原生状态栏观感一致。 */
const COLOR_LOW = "#ffcc00";
const COLOR_CRITICAL = "#ff3b30";
const COLOR_CHARGING = "#34c759";

// 电池图标几何（沿用原静态图标的坐标系）：外壳 26×12，内部可填充区 2 → 21.4。
const FILL_X = 2;
const FILL_MAX_WIDTH = 19.4;
const FILL_MIN_WIDTH = 1;
/** 读不到电量时的静态填充宽度，保持改造前的外观。 */
const FILL_FALLBACK_WIDTH = 14;

/**
 * 桌面状态栏右侧的电池指示器。
 * 显示宿主设备真实电量百分比，并按电量/充电状态着色；环境不支持读取时静默降级为静态图标。
 */
export function PhoneBatteryIndicator() {
  const { supported, level, charging } = useBatteryStatus();
  const hasLevel = supported && level !== null;
  const percent = hasLevel ? Math.round(Math.min(1, Math.max(0, level)) * 100) : null;

  // 充电高亮优先于低电量：插着电时"在充电"是更需要被看见的信息。
  const accent = !hasLevel
    ? null
    : charging
      ? COLOR_CHARGING
      : level < CRITICAL_BATTERY
        ? COLOR_CRITICAL
        : level < LOW_BATTERY
          ? COLOR_LOW
          : null; // null = 跟随 --status-bar-color，自动适应明暗壁纸

  const accentStyle: CSSProperties | undefined = accent ? { color: accent } : undefined;
  const fillWidth = hasLevel
    ? Math.max(FILL_MIN_WIDTH, FILL_MAX_WIDTH * Math.min(1, Math.max(0, level)))
    : FILL_FALLBACK_WIDTH;

  const label =
    percent === null
      ? "电池（当前环境无法读取设备电量）"
      : `电量 ${percent}%${charging ? "，充电中" : ""}`;

  return (
    <span className="status-battery-group" title={label}>
      {percent !== null ? (
        <span className="status-battery-text" style={accentStyle}>
          {percent}
        </span>
      ) : null}
      <svg viewBox="0 0 26 12" className="status-battery" fill="currentColor" style={accentStyle} aria-hidden>
        <rect x="0.5" y="0.5" width="22" height="11" rx="2.6" fill="none" stroke="currentColor" strokeOpacity="0.42" strokeWidth="1" />
        <rect x="22.7" y="4" width="1.8" height="4" rx="0.7" opacity="0.42" />
        <rect x={FILL_X} y="2" width={fillWidth} height="8" rx="1.5" />
      </svg>
    </span>
  );
}
