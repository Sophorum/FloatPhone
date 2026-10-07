import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * 图床直链的同源中转，专给「分享图片 → 交给系统下载器」用。
 *
 * 为什么不直接把图床地址丢给下载器：
 *  1. 跨域地址上的 download 属性会被浏览器忽略，结果是「打开图片」而不是「下载」；
 *  2. 走同源 + Content-Disposition: attachment，宿主才会确定地走下载流程。
 *
 * 只放行图床自己的域名。这不是通用代理——通用代理就是个 SSRF 的口子。
 */
const ALLOWED_HOSTS = new Set(["i.ibb.co", "ibb.co", "www.ibb.co"]);

export async function GET(req: NextRequest) {
    const raw = req.nextUrl.searchParams.get("url") || "";
    let target: URL;
    try {
        target = new URL(raw);
    } catch {
        return NextResponse.json({ error: "url 不合法" }, { status: 400 });
    }
    if (target.protocol !== "https:" || !ALLOWED_HOSTS.has(target.hostname.toLowerCase())) {
        return NextResponse.json({ error: "只允许转发图床的 https 地址" }, { status: 400 });
    }

    let upstream: Response;
    try {
        upstream = await fetch(target.toString(), { cache: "no-store" });
    } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: `取回图片失败：${detail}` }, { status: 502 });
    }
    if (!upstream.ok) {
        return NextResponse.json({ error: `图床返回 HTTP ${upstream.status}` }, { status: 502 });
    }
    const contentType = upstream.headers.get("Content-Type") || "image/png";
    if (!contentType.startsWith("image/")) {
        return NextResponse.json({ error: "图床返回的不是图片" }, { status: 502 });
    }

    const buffer = await upstream.arrayBuffer();
    const requested = req.nextUrl.searchParams.get("name") || "share.png";
    const safeName = requested.replace(/[^\w.\-\u4e00-\u9fa5]+/g, "_") || "share.png";
    return new NextResponse(buffer, {
        status: 200,
        headers: {
            "Content-Type": contentType,
            // 强制成附件，WebView 才会走下载流程，而不是把图当页面显示出来
            "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}`,
            "Cache-Control": "no-store",
        },
    });
}
