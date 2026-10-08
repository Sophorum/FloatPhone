"use client";

// lib/poke-suffix.ts
// 拍一拍后缀：用户侧存在面具（UserIdentity.pokeSuffix），角色侧按会话存。
// 规则是「后缀属于被拍的人」——A 拍了拍 B，显示的是 B 的后缀。

import { kvGet, kvSet, registerKvMigration } from "./kv-db";

const STORAGE_KEY = "ai_phone_chat_poke_suffix_v1";
registerKvMigration(STORAGE_KEY);

/** 配置改动后广播，已渲染的气泡据此重算 */
export const POKE_SUFFIX_UPDATED_EVENT = "chat-poke-suffix-updated";

/** 后缀长度上限 */
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

/** 压成单行并截到上限 */
export function normalizePokeSuffix(value: string): string {
    return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, POKE_SUFFIX_MAX_LENGTH);
}

export function loadSessionPokeSuffix(sessionId: string): string {
    if (!sessionId) return "";
    return loadStore()[sessionId] || "";
}

/** 传空串 = 清除 */
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
 * 模型可能把后缀写进目标名（"[A 拍了拍 小明 的小肚子]"）。只认空格包围的「的」，
 * 名字里自带「的」但不带空格的（"小明的妈妈"）不动，免得切坏真名字。
 * 剥出来的片段连「的」一起保留，回填时原样还原。
 */
export function splitPokeTarget(raw: string): { name: string; inlineSuffix: string } {
    const trimmed = String(raw ?? "").trim();
    const matched = trimmed.match(/^(.*?)\s+的\s*(.+)$/);
    if (!matched) return { name: trimmed, inlineSuffix: "" };
    const name = matched[1].trim();
    const tail = matched[2].trim();
    if (!name || !tail) return { name: trimmed, inlineSuffix: "" };
    return { name, inlineSuffix: `的${tail}` };
}

type PokeNameContext = {
    /** 这条消息是谁发的：user = 你，assistant = 角色 */
    role: string;
    userName?: string;
    charName?: string;
    /** 对面的原始名字，用来判断「我」指谁 */
    otherRawName?: string;
};

/** 「我」按 role 换算：用户消息里指你，角色输出里指角色自己 */
function resolvePokeDisplayName(raw: string, ctx: PokeNameContext): string {
    const value = String(raw ?? "").trim();
    const userName = (ctx.userName || "").trim();
    const role = (ctx.role || "").toLowerCase();

    if (value === "你" || (userName && value === userName)) return "你";
    if (!value) return role === "user" ? "你" : "对方";

    if (value === "我") {
        if (role === "user") return "你";
        if (role === "assistant" || role === "tool") return (ctx.charName || "").trim() || "对方";
        const other = String(ctx.otherRawName ?? "").trim();
        const otherIsUser = other === "你" || (userName && other === userName);
        return otherIsUser ? ((ctx.charName || "").trim() || "对方") : "你";
    }

    return value;
}

/** A 拍了拍 B <后缀>。后缀原样接上，不补「的」——要「的」请在后缀里自己写。 */
function formatPokeText(sender: string, target: string, suffix: string): string {
    const tail = String(suffix ?? "").replace(/\s+/g, " ").trim();
    return `${sender} 拍了拍 ${target}${tail ? ` ${tail}` : ""}`;
}

export type PokeLineInput = {
    rawSender?: string;
    rawTarget?: string;
    role: string;
    userName?: string;
    charName?: string;
    /** 模型自己写在目标名里的后缀，两处都没配时才用 */
    inlineSuffix?: string;
    /** 被拍的人是你时用的后缀（来自该角色绑定的面具） */
    maskSuffix?: string;
    /** 被拍的人是角色时用的后缀（会话「设置拍一拍」） */
    sessionSuffix?: string;
};

/** 组装拍一拍整行文案：聊天气泡、会话列表预览共用同一份逻辑 */
export function composePokeLine(input: PokeLineInput): string {
    const base = { role: input.role, userName: input.userName, charName: input.charName };
    const displaySender = resolvePokeDisplayName(input.rawSender || "", { ...base, otherRawName: input.rawTarget });
    const displayTarget = resolvePokeDisplayName(input.rawTarget || "", { ...base, otherRawName: input.rawSender });
    const owned = displayTarget === "你" ? (input.maskSuffix || "") : (input.sessionSuffix || "");
    return formatPokeText(displaySender, displayTarget, owned || input.inlineSuffix || "");
}
