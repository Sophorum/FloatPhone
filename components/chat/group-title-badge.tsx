"use client";

// 群成员标签角标：挂在昵称左侧，一个成员只挂一个。
// 有专属头衔 → 显示头衔；没设头衔 → 回落显示群主/管理员；普通成员又没头衔就没有角标。
// 头衔顶掉的是「群主/管理员」这几个字，配色仍然表示群内身份
// （群主橙、管理员蓝、普通成员灰），所以头衔不会变成第二个标签。
// 身份按当前群状态实时计算：被移出群聊、卸任后，旧消息上的角标也跟着消失。

import type { ChatSession } from "@/lib/chat-storage";
import { getGroupRole, isGroupMemberKey } from "@/lib/group-admin";
import { getGroupTitle } from "@/lib/group-title";

export function GroupMemberBadge({ session, memberKey, className }: {
    session: ChatSession;
    memberKey?: string | null;
    className?: string;
}) {
    if (!session.isGroup || !memberKey) return null;
    if (!isGroupMemberKey(session, memberKey)) return null;

    const title = getGroupTitle(session, memberKey).trim();
    const role = getGroupRole(session, memberKey);
    const roleLabel = role === "owner" ? "群主" : role === "admin" ? "管理员" : "";
    const text = title || roleLabel;
    if (!text) return null;

    // 留着 chat-group-title-badge 这个类名：写给头衔的自定义 CSS 还能命中
    const tone = role === "owner" ? "owner" : role === "admin" ? "admin" : "member";
    return (
        <span
            className={`chat-role-badge chat-role-badge-${tone}${title ? " chat-group-title-badge" : ""}${className ? ` ${className}` : ""}`}
            title={title || roleLabel}
        >
            {text}
        </span>
    );
}
