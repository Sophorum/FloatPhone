"use client";

// lib/group-title.ts
// 群成员「专属头衔」：存在会话上（ChatSession.groupTitles），一个群一套
// ——同一角色在不同群的群名片本来就可以不一样。
// 显示规则：有专属头衔时显示它，否则显示默认身份（群主/管理员）。
// 角色侧可以写 [设置群头衔:目标角色:头衔] 改头衔（仅群主/管理员有效）：
// 解析在本模块，落库/生效在 chat-storage 的保存路径（那里才知道是谁发的）。

import { loadCharacters } from "./character-storage";
import type { ChatSession } from "./chat-storage";

/** 头衔长度上限（6 字以内） */
export const GROUP_TITLE_MAX_LENGTH = 6;

/** 模型指令名：[设置群头衔:目标角色:头衔] */
export const GROUP_TITLE_DIRECTIVE = "设置群头衔";

/**
 * 成员 key 里的「用户本人」，与 group-admin 的 GROUP_SELF_KEY 同值。
 * 这里刻意不 import group-admin：group-admin 依赖 chat-storage，而 chat-storage
 * 又要 import 本模块，绕一圈会把循环依赖引进来。
 */
export const GROUP_TITLE_SELF_KEY = "self";

const DIRECTIVE_RE_SOURCE = "\\[\\s*设置群头衔\\s*[：:]\\s*([^\\]：:\\r\\n]{0,40})?\\s*(?:[：:]\\s*([^\\]\\r\\n]{0,40})?)?\\s*\\]";

/** 压成单行并截到上限 */
export function normalizeGroupTitle(value: string): string {
    return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, GROUP_TITLE_MAX_LENGTH);
}

export function getGroupTitle(session: ChatSession | null | undefined, key: string | null | undefined): string {
    if (!session || !key) return "";
    return session.groupTitles?.[key] || "";
}

/** 生成写进会话的头衔更新片段（调用方负责持久化）。传空串 = 恢复默认头衔。 */
export function buildGroupTitleUpdate(session: ChatSession, key: string, title: string): Partial<ChatSession> {
    const titles = { ...(session.groupTitles || {}) };
    const normalized = normalizeGroupTitle(title);
    if (normalized) titles[key] = normalized;
    else delete titles[key];
    return { groupTitles: titles };
}

// ── 身份与权限 ─────────────────────────────────────────
// 与 group-admin 的 getGroupOwnerKey / getGroupRole 同源，抄一份是为了避免循环依赖。

function groupOwnerKey(session: ChatSession): string {
    if (session.groupOwnerId) return session.groupOwnerId;
    if (session.isSpectator) return session.participantIds?.[0] || GROUP_TITLE_SELF_KEY;
    return GROUP_TITLE_SELF_KEY;
}

/** 0=群主 1=管理员 2=普通成员 */
function groupRoleRank(session: ChatSession, key: string): number {
    if (groupOwnerKey(session) === key) return 0;
    if ((session.groupAdminIds || []).includes(key)) return 1;
    return 2;
}

/** 谁能改谁的头衔：群主改所有人（含自己）；管理员改自己与普通成员；普通成员不能改。 */
export function canSetGroupTitle(session: ChatSession, actorKey: string, targetKey: string): boolean {
    if (!actorKey || !targetKey) return false;
    const actorRank = groupRoleRank(session, actorKey);
    if (actorRank === 2) return false;
    if (actorKey === targetKey) return true;
    if (actorRank === 0) return true;
    return groupRoleRank(session, targetKey) === 2;
}

// ── 文案 ───────────────────────────────────────────────

/** 系统通知里的自然语言（UI 显示用；用户名字由预览层换成「你」） */
export function formatGroupTitleNoticeText(actorName: string, targetName: string, title: string): string {
    const value = normalizeGroupTitle(title);
    const same = actorName === targetName;
    if (!value) return same ? `${actorName}恢复了自己的默认头衔` : `${actorName}恢复了${targetName}的默认头衔`;
    return same ? `${actorName}把自己的头衔改成了「${value}」` : `${actorName}把${targetName}的头衔改成了「${value}」`;
}

/** 进提示词历史用的协议标签（与建设期 AI 输出的格式一致） */
export function formatGroupTitleBracketText(actorName: string, targetName: string, title: string): string {
    const value = normalizeGroupTitle(title);
    const same = actorName === targetName;
    if (!value) return same ? `[${actorName}恢复了自己的默认头衔]` : `[${actorName}恢复了${targetName}的默认头衔]`;
    return same ? `[${actorName}把自己的头衔设为了${value}]` : `[${actorName}将${targetName}的头衔设为了${value}]`;
}

// ── 模型指令 ───────────────────────────────────────────

export type GroupTitleDirectiveChange = {
    /** 指令里写的目标角色名（可能是「我」「你」或角色名） */
    targetName: string;
    /** 目标头衔；空串 = 恢复默认头衔 */
    title: string;
    /** 命中的原文，用来给同一条回复做去重 */
    raw: string;
};

/**
 * 摘出 [设置群头衔:目标角色:头衔]。
 * 同一条回复里写多次以最后一条为准；只写一段（[设置群头衔:小明]）视为恢复小明的默认头衔。
 */
export function extractGroupTitleDirective(text: string): { text: string; change: GroupTitleDirectiveChange | null } {
    const raw = String(text ?? "");
    if (!raw.includes(GROUP_TITLE_DIRECTIVE)) return { text: raw, change: null };

    let change: GroupTitleDirectiveChange | null = null;
    const scan = new RegExp(DIRECTIVE_RE_SOURCE, "g");
    let match: RegExpExecArray | null;
    while ((match = scan.exec(raw)) !== null) {
        change = {
            targetName: (match[1] || "").trim(),
            title: normalizeGroupTitle(match[2] || ""),
            raw: match[0],
        };
    }
    if (!change) return { text: raw, change: null };

    const cleaned = raw
        .replace(new RegExp(DIRECTIVE_RE_SOURCE, "g"), "")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    return { text: cleaned, change };
}

/** 只把指令摘掉、不判定权限：渲染层用来保证指令永远不会漏进气泡 */
export function stripGroupTitleDirective(text: string): string {
    return extractGroupTitleDirective(text).text;
}

export type GroupTitleResolution =
    | { ok: true; targetKey: string; title: string }
    | { ok: false; reason: string };

/** 把指令里的目标名字解析成成员 key，并校验执行人权限 */
export function resolveGroupTitleChange(input: {
    session: ChatSession;
    actorKey?: string;
    userName?: string;
    targetName: string;
    title: string;
}): GroupTitleResolution {
    const { session, actorKey } = input;
    if (!session.isGroup) return { ok: false, reason: "不是群聊" };
    if (!actorKey) return { ok: false, reason: "没有发出人" };

    const title = normalizeGroupTitle(input.title);
    const rawTarget = (input.targetName || "").trim();
    const userName = (input.userName || "").trim();

    let targetKey: string;
    if (!rawTarget || rawTarget === "我" || rawTarget === "自己") {
        targetKey = actorKey;
    } else if (rawTarget === "你" || (userName && rawTarget === userName)) {
        targetKey = GROUP_TITLE_SELF_KEY;
    } else {
        const characters = loadCharacters();
        const target = (session.participantIds || [])
            .map(id => characters.find(c => c.id === id))
            .find(c => c && c.name === rawTarget);
        if (!target) return { ok: false, reason: `「${rawTarget}」不在群里` };
        targetKey = target.id;
    }

    if (!canSetGroupTitle(session, actorKey, targetKey)) {
        return { ok: false, reason: "没有权限修改这个头衔" };
    }
    return { ok: true, targetKey, title };
}
