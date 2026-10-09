"use client";

// 群成员专属头衔徽标：放在昵称左侧的小标签。
// 没有头衔时返回 null（此时由调用方决定是否显示群主/管理员这类默认身份徽标）。
// 样式用内联写死，避免为了一个小角标去动全局样式表。

export function GroupTitleBadge({ title, className }: { title?: string; className?: string }) {
    const value = (title || "").trim();
    if (!value) return null;
    return (
        <span
            className={`chat-group-title-badge ${className ?? ""}`}
            title={value}
            style={{
                display: "inline-flex",
                alignItems: "center",
                flex: "0 0 auto",
                maxWidth: 84,
                marginRight: 4,
                padding: "0 5px",
                borderRadius: 6,
                fontSize: "calc(10px*var(--app-text-scale,1))",
                fontWeight: 600,
                lineHeight: "16px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                color: "var(--c-icon-active, #576b95)",
                background: "color-mix(in srgb, var(--c-icon-active, #576b95) 14%, transparent)",
            }}
        >
            {value}
        </span>
    );
}
