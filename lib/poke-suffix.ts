"use client";

// lib/poke-suffix.ts
// 拍一拍后缀：用户侧存在面具（UserIdentity.pokeSuffix），角色侧按「角色」存
// ——一个角色一条，群里拍谁就用谁的那条（同一角色在多个会话里共用同一条）。
// 规则是「后缀属于被拍的人」——A 拍了拍 B，显示的是 B 的后缀。
// 角色本人也能改自己的：模型输出里写 [设置拍一拍:后缀] 即生效
// （摘取在 extractPokeSuffixDirective，落库/生效在 chat-storage）。

import { kvGet, kvSet, registerKvMigration } from "./kv-db";
import { loadCharacters } from "./character-storage";

/** 角色侧后缀：characterId → 后缀 */
const STORAGE_KEY = "ai_phone_character_poke_suffix_v1";
/** 旧版按会话存的后缀：只读兜底，升级前设过的那条还能显示出来 */
const LEGACY_SESSION_STORAGE_KEY = "ai_phone_chat_poke_suffix_v1";
registerKvMigration(STORAGE_KEY);
registerKvMigration(LEGACY_SESSION_STORAGE_KEY);

/** 配置改动后广播，已渲染的气泡据此重算 */
export const POKE_SUFFIX_UPDATED_EVENT = "chat-poke-suffix-updated";

/** 后缀长度上限 */
export const POKE_SUFFIX_MAX_LENGTH = 20;

/** 角色自改拍一拍的指令名（[设置拍一拍:后缀]） */
export const POKE_SUFFIX_DIRECTIVE = "设置拍一拍";
const POKE_SUFFIX_DIRECTIVE_PATTERN = "\\[\\s*设置拍一拍\\s*[：:]\\s*([^\\]\\r\\n]*)\\]";

type PokeSuffixStore = Record<string, string>;

function loadStore(key: string): PokeSuffixStore {
    if (typeof window === "undefined") return {};
    try {
        const raw = kvGet(key);
        if (!raw) return {};
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
        const out: PokeSuffixStore = {};
        for (const [entryKey, value] of Object.entries(parsed as Record<string, unknown>)) {
            if (typeof value === "string" && value.trim()) out[entryKey] = value.trim();
        }
        return out;
    } catch {
        return {};
    }
}

function saveStore(key: string, store: PokeSuffixStore): void {
    if (typeof window === "undefined") return;
    kvSet(key, JSON.stringify(store));
}

export function notifyPokeSuffixChanged(characterId?: string): void {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent(POKE_SUFFIX_UPDATED_EVENT, { detail: { characterId } }));
}

/** 压成单行并截到上限 */
export function normalizePokeSuffix(value: string): string {
    return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, POKE_SUFFIX_MAX_LENGTH);
}

export function loadCharacterPokeSuffix(characterId: string): string {
    if (!characterId) return "";
    return loadStore(STORAGE_KEY)[characterId] || "";
}

/** 写某个角色的后缀。传空串 = 清除 */
export function saveCharacterPokeSuffix(characterId: string, suffix: string): void {
    if (!characterId || typeof window === "undefined") return;
    const store = loadStore(STORAGE_KEY);
    const normalized = normalizePokeSuffix(suffix);
    if (normalized) store[characterId] = normalized;
    else delete store[characterId];
    saveStore(STORAGE_KEY, store);
    notifyPokeSuffixChanged(characterId);
}

/**
 * 旧版按会话读的后缀。只在渲染时当兜底用（老数据没迁到角色上），新数据别写这里。
 * @deprecated 用 loadCharacterPokeSuffix
 */
export function loadSessionPokeSuffix(sessionId: string): string {
    if (!sessionId) return "";
    return loadStore(LEGACY_SESSION_STORAGE_KEY)[sessionId] || "";
}

/**
 * 旧版按会话写的入口，保留只为兼容老调用方。
 * @deprecated 用 saveCharacterPokeSuffix
 */
export function saveSessionPokeSuffix(sessionId: string, suffix: string): void {
    if (!sessionId || typeof window === "undefined") return;
    const store = loadStore(LEGACY_SESSION_STORAGE_KEY);
    const normalized = normalizePokeSuffix(suffix);
    if (normalized) store[sessionId] = normalized;
    else delete store[sessionId];
    saveStore(LEGACY_SESSION_STORAGE_KEY, store);
    notifyPokeSuffixChanged();
}

/** 按角色名去查这个角色的后缀（群聊里拍指定角色时用） */
export function resolveCharacterPokeSuffixByName(name: string): string {
    const value = String(name ?? "").trim();
    if (!value) return "";
    const character = loadCharacters().find(item => item.name === value);
    return character ? loadCharacterPokeSuffix(character.id) : "";
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
    /** 被拍的人是角色时直接给的后缀；不传就按被拍角色的名字去查 */
    characterSuffix?: string;
    /** 旧版按会话存的后缀，兜底用（新数据都存在角色上） */
    sessionSuffix?: string;
};

/** 组装拍一拍整行文案：聊天气泡、会话列表预览共用同一份逻辑 */
export function composePokeLine(input: PokeLineInput): string {
    const base = { role: input.role, userName: input.userName, charName: input.charName };
    const displaySender = resolvePokeDisplayName(input.rawSender || "", { ...base, otherRawName: input.rawTarget });
    const displayTarget = resolvePokeDisplayName(input.rawTarget || "", { ...base, otherRawName: input.rawSender });
    // 后缀属于被拍的人：拍你取面具，拍角色取那个角色的（群聊里名字点名即可）
    const owned = displayTarget === "你"
        ? (input.maskSuffix || "")
        : (input.characterSuffix
            || resolveCharacterPokeSuffixByName(displayTarget)
            || input.sessionSuffix
            || "");
    return formatPokeText(displaySender, displayTarget, owned || input.inlineSuffix || "");
}

/**
 * 从模型输出里摘出 [设置拍一拍:后缀]。
 * 返回值：清洗后的文本 + 该角色要设的后缀（没写指令 = null；写了但内容为空 = 空串，即清除）。
 */
export function extractPokeSuffixDirective(text: string): { text: string; suffix: string | null } {
    const raw = String(text ?? "");
    if (!raw.includes(POKE_SUFFIX_DIRECTIVE)) return { text: raw, suffix: null };

    const matches = [...raw.matchAll(new RegExp(POKE_SUFFIX_DIRECTIVE_PATTERN, "g"))];
    if (matches.length === 0) return { text: raw, suffix: null };

    // 同一条回复里写了多次以最后一条为准
    let suffix = "";
    for (const match of matches) suffix = normalizePokeSuffix(match[1] ?? "");

    const cleaned = raw
        .replace(new RegExp(POKE_SUFFIX_DIRECTIVE_PATTERN, "g"), "")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

    return { text: cleaned, suffix };
}

/** 只把指令摘掉、不改配置：渲染层用来保证指令永远不会漏进气泡 */
export function stripPokeSuffixDirective(text: string): string {
    return extractPokeSuffixDirective(text).text;
}
