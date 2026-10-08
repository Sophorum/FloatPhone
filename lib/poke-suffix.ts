"use client";

// lib/poke-suffix.ts
// 「拍一拍」后缀的两处配置入口 + 名字换算：
//   用户侧（面具）：设置 → 用户身份卡片里的 pokeSuffix，跟着角色绑定的面具走；
//   角色侧：会话「聊天信息 → 设置拍一拍」，按会话存。
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

// ── 展示名换算 ──────────────────────────────────────────
// 「我」在两边的含义正好相反：用户消息里「我」= 你，角色输出里「我」= 角色自己。
// 所以换算必须带 role，否则角色写的「我 拍了拍 你」会被显示成「你 拍了拍 你」。

export type PokeNameContext = {
    /** 这条消息是谁发的：user = 你，assistant = 角色 */
    role: string;
    userName?: string;
    charName?: string;
};

export function resolvePokeDisplayName(
    raw: string,
    ctx: PokeNameContext & { otherRawName?: string },
): string {
    const value = String(raw ?? "").trim();
    const userName = (ctx.userName || "").trim();
    const role = (ctx.role || "").toLowerCase();

    // 「你」和用户的真名永远是用户
    if (value === "你" || (userName && value === userName)) return "你";
    if (!value) return role === "user" ? "你" : "对方";

    if (value === "我") {
        if (role === "user") return "你";
        if (role === "assistant" || role === "tool") return (ctx.charName || "").trim() || "对方";
        // 身份不明的来源（system 等）：看对面是谁——
        // 对面是你，那「我」只能是角色；否则「我」就是发起动作的你（界面生成的拍一拍）。
        const other = String(ctx.otherRawName ?? "").trim();
        const otherIsUser = other === "你" || (userName && other === userName);
        return otherIsUser ? ((ctx.charName || "").trim() || "对方") : "你";
    }

    return value;
}

export type PokeLineInput = {
    rawSender?: string;
    rawTarget?: string;
    role: string;
    userName?: string;
    charName?: string;
    /** 模型自己写死在目标名里的后缀：两处都没配置时才用它兜底 */
    inlineSuffix?: string;
    /** 被拍的人是你时用的后缀（由调用方按角色绑定的面具解析后传入） */
    maskSuffix?: string;
    /** 被拍的人是角色时用的后缀（会话「设置拍一拍」） */
    sessionSuffix?: string;
};

/** 拍一拍那行小字的文案：A 拍了拍 B 的 <后缀> */
export function formatPokeText(sender: string, target: string, suffix: string): string {
    const tail = normalizePokeSuffix(suffix);
    return `${sender} 拍了拍 ${target}${tail ? ` 的 ${tail}` : ""}`;
}

/**
 * 组装拍一拍整行文案：名字按角色侧/用户侧分别换算，后缀按「被拍的人」归属取用。
 * 聊天气泡与会话列表预览共用这一份逻辑，避免两处显示不一致。
 */
export function composePokeLine(input: PokeLineInput): string {
    const ctx: PokeNameContext = {
        role: input.role,
        userName: input.userName,
        charName: input.charName,
    };
    const displaySender = resolvePokeDisplayName(input.rawSender || "", { ...ctx, otherRawName: input.rawTarget });
    const displayTarget = resolvePokeDisplayName(input.rawTarget || "", { ...ctx, otherRawName: input.rawSender });
    const owned = displayTarget === "你"
        ? input.maskSuffix || ""
        : input.sessionSuffix || "";
    return formatPokeText(displaySender, displayTarget, owned || input.inlineSuffix || "");
}
