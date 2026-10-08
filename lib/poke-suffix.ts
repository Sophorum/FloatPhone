"use client";

// lib/poke-suffix.ts
// 「拍一拍」后缀的两处配置入口：
//   1. 用户侧（面具）：设置 → 用户身份卡片里的 pokeSuffix，跟着角色绑定的面具走；
//   2. 角色侧：会话「聊天信息 → 设置拍一拍」，按会话存。
//
// 微信的规则是「后缀属于被拍的人」——A 拍了拍 B，显示的是 B 的后缀。
// 后缀在渲染时现场解析、不写进消息记录：改完配置连历史消息都跟着变，
// 不会出现「只有新消息生效、旧气泡还挂着老后缀」。

import { kvGet, kvSet, registerKvMigration } from "./kv-db";

const STORAGE_KEY = "ai_phone_chat_poke_suffix_v1";
registerKvMigration(STORAGE_KEY);

/** 配置改动后广播：已打开的聊天气泡据此重算（面具与会话两处共用） */
export const POKE_SUFFIX_UPDATED_EVENT = "chat-poke-suffix-updated";

/** 后缀长度上限。太长会把那行居中的小字挤到换行。 */
export const POKE_SUFFIX_MAX_LENGTH = 20;

/** sessionId → 角色侧后缀 */
type PokeSuffixStore = Record<string, string>;

function loadStore(): PokeSuffixStore {
    if (typeof window === "undefined") return {};
    try {
        const raw = kvGet(STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
        const out: PokeSuffixStore = {};
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
            if (typeof value === "string" && value.trim()) out[key] = value.trim();
        }
        return out;
    } catch {
        return {};
    }
}

function saveStore(store: PokeSuffixStore): void {
    if (typeof window === "undefined") return;
    kvSet(STORAGE_KEY, JSON.stringify(store));
}

export function notifyPokeSuffixChanged(sessionId?: string): void {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent(POKE_SUFFIX_UPDATED_EVENT, { detail: { sessionId } }));
}

/** 归一化：拍一拍是单行小字，压掉换行与多余空格并截到上限 */
export function normalizePokeSuffix(value: string): string {
    return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, POKE_SUFFIX_MAX_LENGTH);
}

/** 读某个会话的角色侧后缀 */
export function loadSessionPokeSuffix(sessionId: string): string {
    if (!sessionId) return "";
    return loadStore()[sessionId] || "";
}

/** 写某个会话的角色侧后缀；传空串 = 清除 */
export function saveSessionPokeSuffix(sessionId: string, suffix: string): void {
    if (!sessionId || typeof window === "undefined") return;
    const store = loadStore();
    const normalized = normalizePokeSuffix(suffix);
    if (normalized) store[sessionId] = normalized;
    else delete store[sessionId];
    saveStore(store);
    notifyPokeSuffixChanged(sessionId);
}

/**
 * 模型有时不守规矩，直接把后缀写进目标名（"[A 拍了拍 小明 的小肚子]"）。
 * 只剥「空格包围的 的」——名字里带「的」但没加空格的情况（"小明的妈妈"）原样保留，
 * 免得把真名字切坏。
 */
export function splitPokeTarget(raw: string): { name: string; inlineSuffix: string } {
    const trimmed = String(raw ?? "").trim();
    const matched = trimmed.match(/^(.*?)\s+的\s*(.+)$/);
    if (!matched) return { name: trimmed, inlineSuffix: "" };
    const name = matched[1].trim();
    const inlineSuffix = matched[2].trim();
    if (!name || !inlineSuffix) return { name: trimmed, inlineSuffix: "" };
    return { name, inlineSuffix };
}

/** 拍一拍那行小字的文案：A 拍了拍 B 的 <后缀> */
export function formatPokeText(sender: string, target: string, suffix: string): string {
    const tail = normalizePokeSuffix(suffix);
    return `${sender} 拍了拍 ${target}${tail ? ` 的 ${tail}` : ""}`;
}

/**
 * 「这个名字指的是不是用户」：AI 可能写真实名字，也可能写「你 / 我」。
 * 用户侧后缀要在这几种写法下都能命中。
 */
export function isUserPokeName(name: string, userName?: string): boolean {
    const value = String(name ?? "").trim();
    if (!value) return false;
    if (userName && value === userName.trim()) return true;
    return value === "你" || value === "我";
}
