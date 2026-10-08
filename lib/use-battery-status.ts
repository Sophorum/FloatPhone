"use client";

import { useEffect, useState } from "react";

export type BatteryStatus = {
  /** 当前环境是否支持 Battery Status API（安卓 Chrome/Edge 支持；iOS Safari 与 Firefox 不支持）。 */
  supported: boolean;
  /** 0~1 的电量；null = 尚未读到（含不支持的环境）。 */
  level: number | null;
  charging: boolean;
};

/** BatteryManager 的最小结构（TS 的 lib.dom 未内置该类型）。 */
type BatteryManagerLike = {
  charging: boolean;
  level: number;
  addEventListener: (type: "levelchange" | "chargingchange", listener: () => void) => void;
  removeEventListener: (type: "levelchange" | "chargingchange", listener: () => void) => void;
};

const UNKNOWN: BatteryStatus = { supported: false, level: null, charging: false };

/**
 * 读取宿主设备的真实电池状态（电量 + 充电中）。
 * 依赖 navigator.getBattery()，必须运行在安全上下文（https / localhost / 已安装 PWA）。
 * 不支持该 API 的环境（iOS Safari、Firefox）返回 supported:false，由调用方决定降级外观。
 */
export function useBatteryStatus(): BatteryStatus {
  const [status, setStatus] = useState<BatteryStatus>(UNKNOWN);

  useEffect(() => {
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryManagerLike> };
    if (typeof nav.getBattery !== "function") {
      setStatus(UNKNOWN);
      return;
    }

    let disposed = false;
    let battery: BatteryManagerLike | null = null;

    const sync = () => {
      if (disposed || !battery) return;
      const level = Number(battery.level);
      setStatus({
        supported: true,
        level: Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : null,
        charging: Boolean(battery.charging),
      });
    };

    nav
      .getBattery()
      .then((manager) => {
        if (disposed) return;
        battery = manager;
        sync();
        manager.addEventListener("levelchange", sync);
        manager.addEventListener("chargingchange", sync);
      })
      .catch(() => {
        if (!disposed) setStatus(UNKNOWN);
      });

    return () => {
      disposed = true;
      battery?.removeEventListener("levelchange", sync);
      battery?.removeEventListener("chargingchange", sync);
    };
  }, []);

  return status;
}
