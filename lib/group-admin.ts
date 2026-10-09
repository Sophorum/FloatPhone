// lib/group-admin.ts
// Group admin roles: owner / admin / member, mute state, permission checks,
// action application and the {{groupRoster}} prompt macro.
// Member keys: "self" = the user, otherwise characterId.

import { ChatSession, loadChatSessions, saveChatSessions } from "./chat-storage";
import { loadCharacters } from "./character-storage";
import {
    buildGroupTitleUpdate,
    formatGroupTitleBracketText,
    formatGroupTitleNoticeText,
    getGroupTitle,
} from "./group-title";

export const GROUP_SELF_KEY = "self";

export type GroupAdminAction =
    | "transfer_owner"
    | "set_admin"
    | "unset_admin"
    | "kick"
    | "invite"
    | "mute"
    | "unmute"
    | "set_title";

export type GroupRole = "owner" | "admin" | "member";

// ── Roles ──────────────────────────────────────────────

export function getGroupOwnerKey(session: ChatSession): string {
    if (session.groupOwnerId) return session.groupOwnerId;
    // Legacy groups (created before roles existed): the user is the owner.
    // Spectator groups without an explicit owner: first member owns the group.
    if (session.isSpectator) return session.participantIds?.[0] || GROUP_SELF_KEY;
    return GROUP_SELF_KEY;
}

export function getGroupRole(session: ChatSession, key: string): GroupRole {
    if (getGroupOwnerKey(session) === key) return "owner";
    if ((session.groupAdminIds || []).includes(key)) return "admin";
    return "member";
}

/** Is this key currently part of the group? ("self" counts unless spectator) */
export function isGroupMemberKey(session: ChatSession, key: string): boolean {
    if (key === GROUP_SELF_KEY) return !session.isSpectator;
    return (session.participantIds || []).includes(key);
}

// ── Mute state ─────────────────────────────────────────

export function getGroupMuteRemainingMs(session: ChatSession, key: string, now?: number): number {
    const until = session.groupMutes?.[key];
    if (!until) return 0;
    const ms = new Date(until).getTime() - (now ?? Date.now());
    return Number.isFinite(ms) && ms > 0 ? ms : 0;
}

export function isGroupMuted(session: ChatSession, key: string, now?: number): boolean {
    return getGroupMuteRemainingMs(session, key, now) > 0;
}

export function formatMuteDurationLabel(minutes: number): string {
    if (minutes % 1440 === 0 && minutes >= 1440) return `${minutes / 1440}天`;
    if (minutes % 60 === 0 && minutes >= 60) return `${minutes / 60}小时`;
    return `${minutes}分钟`;
}

export function formatMuteRemainingLabel(ms: number): string {
    const totalMinutes = Math.ceil(ms / 60000);
    if (totalMinutes >= 1440) return `${Math.ceil(totalMinutes / 1440)}天`;
    if (totalMinutes >= 60) return `${Math.ceil(totalMinutes / 60)}小时`;
    return `${Math.max(totalMinutes, 1)}分钟`;
}

// ── Permission matrix ──────────────────────────────────

/**
 * Whether `actorKey` may perform `action` on `targetKey`.
 * Rules mirror WeChat: owner may do everything; admins may kick/invite/mute
 * plain members only; nobody targets the owner; admins don't target admins.
 * Characters may not target the user unless the session opts in.
 */
export function canGroupAdminAct(
    session: ChatSession,
    actorKey: string,
    action: GroupAdminAction,
    targetKey: string,
): boolean {
    if (!actorKey || !targetKey) return false;
    if (!isGroupMemberKey(session, actorKey)) return false;
    const actorRole = getGroupRole(session, actorKey);
    if (actorRole === "member") return false;
    // 改自己的头衔也是合法操作，所以 set_title 不受「不能对自己动手」这条限制
    if (actorKey === targetKey && action !== "unmute" && action !== "set_title") return false;

    // Characters targeting the user: kicking is never allowed (the session
    // can't lose its user), muting requires the opt-in switch; handing the
    // user ownership/admin is harmless and follows the normal matrix.
    if (targetKey === GROUP_SELF_KEY && actorKey !== GROUP_SELF_KEY) {
        if (action === "kick") return false;
        if (action === "mute" && session.allowAdminActionsOnUser !== true) return false;
    }

    switch (action) {
        case "transfer_owner":
        case "set_admin":
        case "unset_admin": {
            if (actorRole !== "owner") return false;
            if (!isGroupMemberKey(session, targetKey)) return false;
            const targetRole = getGroupRole(session, targetKey);
            if (action === "set_admin") return targetRole === "member";
            if (action === "unset_admin") return targetRole === "admin";
            return true; // transfer_owner: any member/admin target
        }
        case "kick":
        case "mute": {
            if (!isGroupMemberKey(session, targetKey)) return false;
            const targetRole = getGroupRole(session, targetKey);
            if (targetRole === "owner") return false;
            if (actorRole === "admin" && targetRole === "admin") return false;
            if (action === "mute" && isGroupMuted(session, targetKey)) return false;
            return true;
        }
        case "unmute": {
            if (!isGroupMuted(session, targetKey)) return false;
            const targetRole = getGroupRole(session, targetKey);
            if (actorRole === "admin" && targetRole === "admin" && actorKey !== targetKey) return false;
            return true;
        }
        case "set_title": {
            // 专属头衔：群主可改所有人（含自己）；管理员可改自己与普通成员，
            // 动不了群主与其他管理员；普通成员在函数开头已经被挡掉。
            if (!isGroupMemberKey(session, targetKey)) return false;
            if (actorKey === targetKey) return true;
            if (actorRole === "owner") return true;
            return getGroupRole(session, targetKey) === "member";
        }
        case "invite": {
            // Target must be an existing character not already in the group
            if (targetKey === GROUP_SELF_KEY) return false;
            if ((session.participantIds || []).includes(targetKey)) return false;
            return true;
        }
        default:
            return false;
    }
}

// ── Name resolution ────────────────────────────────────

/** Resolve a display name from AI output to a member key. Returns null if unknown. */
export function resolveGroupMemberKeyByName(
    session: ChatSession,
    name: string,
    userName: string,
    options?: { includeOutsiders?: boolean },
): string | null {
    const trimmed = name.trim();
    if (!trimmed) return null;
    if (trimmed === userName || trimmed === "你") return GROUP_SELF_KEY;
    const chars = loadCharacters();
    const inGroup = (session.participantIds || [])
        .map(id => chars.find(c => c.id === id))
        .find(c => c && c.name === trimmed);
    if (inGroup) return inGroup.id;
    if (options?.includeOutsiders) {
        const outsider = chars.find(c => c.name === trimmed);
        if (outsider) return outsider.id;
    }
    return null;
}

export function getGroupMemberDisplayName(key: string, userName: string): string {
    if (key === GROUP_SELF_KEY) return userName;
    const char = loadCharacters().find(c => c.id === key);
    return char?.name || "未知";
}

// ── Notice text (third person; the UI converts the user's name to 你) ──

export function buildGroupAdminNoticeText(
    action: GroupAdminAction,
    actorName: string,
    targetName: string,
    muteMinutes?: number,
    title?: string,
): string {
    switch (action) {
        case "set_title": return formatGroupTitleNoticeText(actorName, targetName, title || "");
        case "transfer_owner":
            if (actorName === targetName) return `${actorName}收回了群主身份`;
            return `${actorName}将群主转让给了${targetName}`;
        case "set_admin": return `${actorName}将${targetName}设为了管理员`;
        case "unset_admin": return `${actorName}取消了${targetName}的管理员`;
        case "kick": return `${actorName}将${targetName}移出了群聊`;
        case "invite": return `${actorName}邀请${targetName}加入了群聊`;
        case "mute": return `${actorName}将${targetName}禁言${formatMuteDurationLabel(muteMinutes || 10)}`;
        case "unmute": return `${actorName}解除了${targetName}的禁言`;
    }
}

/**
 * Canonical protocol tag for prompt history — same bracket format the AI is
 * taught to output, so user actions and AI actions read identically in context
 * (mirrors how [A领取了B的红包] / call tags replay through history).
 */
export function buildGroupAdminBracketText(
    action: GroupAdminAction,
    actorName: string,
    targetName: string,
    muteMinutes?: number,
    title?: string,
): string {
    switch (action) {
        case "set_title": return formatGroupTitleBracketText(actorName, targetName, title || "");
        case "transfer_owner":
            // 上帝按钮收回群主：非协议动作，写成事实陈述即可
            if (actorName === targetName) return `[${actorName}收回了群主身份]`;
            return `[${actorName}将群主转让给了${targetName}]`;
        case "set_admin": return `[${actorName}将${targetName}设为了管理员]`;
        case "unset_admin": return `[${actorName}取消了${targetName}的管理员]`;
        case "kick": return `[${actorName}将${targetName}移出了群聊]`;
        case "invite": return `[${actorName}邀请${targetName}加入了群聊]`;
        case "mute": return `[${actorName}禁言了${targetName}:${formatMuteDurationLabel(muteMinutes || 10)}]`;
        case "unmute": return `[${actorName}解除了${targetName}的禁言]`;
    }
}

// ── Action application ─────────────────────────────────

/**
 * Apply a permitted admin action to the persisted session.
 * Does NOT check permission — call canGroupAdminAct first.
 * Returns the updated fields (also merged into the passed session object).
 */
export function applyGroupAdminAction(
    session: ChatSession,
    action: GroupAdminAction,
    actorKey: string,
    targetKey: string,
    muteMinutes?: number,
    title?: string,
): Partial<ChatSession> {
    const updates: Partial<ChatSession> = {};
    switch (action) {
        case "set_title": {
            // 传空串 = 恢复默认头衔（删掉这条，界面回落到群主/管理员默认徽标）
            Object.assign(updates, buildGroupTitleUpdate(session, targetKey, title || ""));
            break;
        }
        case "transfer_owner": {
            updates.groupOwnerId = targetKey;
            // New owner leaves the admin list; ex-owner becomes a plain member
            updates.groupAdminIds = (session.groupAdminIds || []).filter(id => id !== targetKey);
            break;
        }
        case "set_admin": {
            const admins = new Set(session.groupAdminIds || []);
            admins.add(targetKey);
            updates.groupAdminIds = [...admins];
            break;
        }
        case "unset_admin": {
            updates.groupAdminIds = (session.groupAdminIds || []).filter(id => id !== targetKey);
            break;
        }
        case "kick": {
            if (targetKey !== GROUP_SELF_KEY) {
                updates.participantIds = (session.participantIds || []).filter(id => id !== targetKey);
            }
            updates.groupAdminIds = (session.groupAdminIds || []).filter(id => id !== targetKey);
            if (session.groupMutes?.[targetKey]) {
                const mutes = { ...session.groupMutes };
                delete mutes[targetKey];
                updates.groupMutes = mutes;
            }
            break;
        }
        case "invite": {
            const ids = session.participantIds || [];
            if (!ids.includes(targetKey)) updates.participantIds = [...ids, targetKey];
            break;
        }
        case "mute": {
            const until = new Date(Date.now() + (muteMinutes || 10) * 60000).toISOString();
            updates.groupMutes = { ...(session.groupMutes || {}), [targetKey]: until };
            break;
        }
        case "unmute": {
            const mutes = { ...(session.groupMutes || {}) };
            delete mutes[targetKey];
            updates.groupMutes = mutes;
            break;
        }
    }

    const sessions = loadChatSessions();
    const idx = sessions.findIndex(s => s.id === session.id);
    if (idx !== -1) {
        sessions[idx] = { ...sessions[idx], ...updates };
        saveChatSessions(sessions);
    }
    Object.assign(session, updates);
    return updates;
}

/** Drop expired mute entries from storage (passive expiry). */
export function pruneExpiredGroupMutes(session: ChatSession): void {
    const mutes = session.groupMutes;
    if (!mutes) return;
    const now = Date.now();
    const active: Record<string, string> = {};
    let changed = false;
    for (const [key, until] of Object.entries(mutes)) {
        const ms = new Date(until).getTime() - now;
        if (Number.isFinite(ms) && ms > 0) active[key] = until;
        else changed = true;
    }
    if (!changed) return;
    const sessions = loadChatSessions();
    const idx = sessions.findIndex(s => s.id === session.id);
    if (idx !== -1) {
        sessions[idx] = { ...sessions[idx], groupMutes: active };
        saveChatSessions(sessions);
    }
    session.groupMutes = active;
}

// ── {{groupRoster}} macro ──────────────────────────────

/**
 * Build the roster block injected via the {{groupRoster}} preset macro.
 * Pure data: who owns the group, who administrates, who is muted.
 */
export function buildGroupRosterMacro(
    session: ChatSession,
    memberNames: { id: string; name: string }[],
    userName: string,
): string {
    pruneExpiredGroupMutes(session);
    const nameOf = (key: string): string => {
        if (key === GROUP_SELF_KEY) return `${userName}（用户本人）`;
        return memberNames.find(m => m.id === key)?.name || "未知";
    };
    const ownerKey = getGroupOwnerKey(session);
    const adminKeys = (session.groupAdminIds || []).filter(key => key !== ownerKey && isGroupMemberKey(session, key));
    const allKeys: string[] = [
        ...(session.isSpectator ? [] : [GROUP_SELF_KEY]),
        ...memberNames.map(m => m.id),
    ];
    const plainKeys = allKeys.filter(key => key !== ownerKey && !adminKeys.includes(key));

    const lines: string[] = ["<group_roster>"];
    lines.push(`群主：${nameOf(ownerKey)}`);
    if (adminKeys.length > 0) lines.push(`管理员：${adminKeys.map(nameOf).join("、")}`);
    if (plainKeys.length > 0) lines.push(`普通成员：${plainKeys.map(nameOf).join("、")}`);
    const mutedEntries = Object.keys(session.groupMutes || {})
        .filter(key => isGroupMemberKey(session, key))
        .map(key => {
            const ms = getGroupMuteRemainingMs(session, key);
            return ms > 0 ? `${nameOf(key)}（剩余${formatMuteRemainingLabel(ms)}）` : "";
        })
        .filter(Boolean);
    if (mutedEntries.length > 0) {
        lines.push(`禁言中：${mutedEntries.join("、")}（被禁言者在解除前不得发出任何群消息，线下场景不受影响）`);
    }
    // 专属头衔：谁带着什么头衔，以及改头衔的方式（权限与群管理操作同一套）
    const titledEntries = allKeys
        .map(key => ({ key, title: getGroupTitle(session, key) }))
        .filter(entry => entry.title)
        .map(entry => `${nameOf(entry.key)}（${entry.title}）`);
    if (titledEntries.length > 0) {
        lines.push(`专属头衔：${titledEntries.join("、")}`);
    }
    lines.push("头衔：群主与管理员可给自己或群友设专属头衔，输出 [设置群头衔:角色名:头衔] 即可（最多6字；角色名写自己名字即改自己；只写 [设置群头衔:角色名] 表示恢复该成员的默认头衔），改完系统会补一条提示。普通成员改了不生效。");
    lines.push("</group_roster>");
    return lines.join("\n");
}
