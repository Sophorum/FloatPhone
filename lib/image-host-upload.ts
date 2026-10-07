"use client";

/**
 * 分享图片的「图床」出口。
 *
 * 背景：有些安卓 WebView / 壳把下载交给自家原生下载器（OkHttp），那个下载器只认
 * http(s)，页面内用 canvas 现做的 blob: 图片一律拒收，报
 *   Expected URL scheme 'http' or 'https' but was 'blob'
 * 同一个下载函数导出 .md 却是好的——文本不走那条图片分流。
 *
 * 既然它认 http(s)，那就在保存前先把图变成一条真的 http(s)：
 * 上传到站点自带的图床接口，拿回直链再交给下载器（见 download-utils 的 saveImageBlob）。
 *
 * 用的是 /api/image-hosting/imgbb，需要在部署平台配置 IMGBB_API_KEY。
 * 没配的话这里会抛错，调用方会安静地退回原来的下载方式，不会打扰用户。
 */

/** 图床副本的有效期：1 天。图存到本地之后就不再需要这条外链，
 *  设个期限让它自己过期，免得私人批注一直挂在公网。 */
const UPLOAD_EXPIRATION_SECONDS = 24 * 60 * 60;

export async function uploadImageForDownload(blob: Blob, filename: string): Promise<string> {
    const form = new FormData();
    form.set("file", new File([blob], filename, { type: blob.type || "image/png" }));
    form.set("name", filename);
    form.set("expiration", String(UPLOAD_EXPIRATION_SECONDS));

    const res = await fetch("/api/image-hosting/imgbb", { method: "POST", body: form });
    const data = await res.json().catch(() => null) as { url?: string; error?: string } | null;
    const url = typeof data?.url === "string" ? data.url : "";
    if (!res.ok || !/^https?:\/\//.test(url)) {
        throw new Error(data?.error || `图床上传失败（HTTP ${res.status}）`);
    }
    return url;
}
