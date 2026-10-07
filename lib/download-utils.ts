import { uploadImageForDownload } from "./image-host-upload";

export type DownloadFileOptions = {
    disableNativeShare?: boolean;
    nativeShareOnly?: boolean;
};

export function isAndroidBrowser(): boolean {
    return typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
}

export function isIOSBrowser(): boolean {
    if (typeof navigator === "undefined") return false;
    const ua = navigator.userAgent || "";
    const platform = navigator.platform || "";
    return /iPad|iPhone|iPod/i.test(ua) || (platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export async function downloadFile(blob: Blob, filename: string, options: DownloadFileOptions = {}): Promise<void> {
    const url = URL.createObjectURL(blob);
    const anchorDownload = () => {
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
    };

    const shouldUseNativeShare = options.nativeShareOnly || (!options.disableNativeShare && isIOSBrowser());
    if (shouldUseNativeShare) {
        const file = new File([blob], filename, { type: blob.type || "application/octet-stream" });
        const canNativeShare = typeof navigator !== "undefined"
            && typeof navigator.share === "function"
            && typeof navigator.canShare === "function"
            && navigator.canShare({ files: [file] });
        if (canNativeShare) {
            try {
                await navigator.share({ files: [file] });
                setTimeout(() => URL.revokeObjectURL(url), 1000);
                return;
            } catch (err) {
                // User explicitly dismissed the share sheet → respect it, don't force a download.
                if (err instanceof DOMException && err.name === "AbortError") {
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                    return;
                }
                // Any other failure (webview without real file-share support, lost user
                // activation, etc.) is surfaced to the caller on iOS instead of opening
                // the blob URL, which can navigate away from the app.
            }
        }
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        throw new Error("当前浏览器没有成功打开系统分享，请在 Safari 中重试，或导出轻量备份后再试。");
    }

    anchorDownload();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 安卓 WebView：UA 里带 "; wv)"。这类宿主常把 blob: 图片交给只认 http(s) 的
 *  原生下载器，所以分享界面会给用户一个「通过图床保存」的备选。 */
export function isAndroidWebView(): boolean {
    if (typeof navigator === "undefined") return false;
    const ua = navigator.userAgent || "";
    return /Android/i.test(ua) && /\bwv\b/.test(ua);
}

/** 把一个已经在网上的 http(s) 地址交给下载器。宿主既然只认 http(s)，
 *  这条就是给它准备的——顺序不能和 downloadFile 弄混：
 *  downloadFile 给的是页面内存里的 blob:，它取不到。 */
export function downloadRemoteUrl(url: string, filename: string): void {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
}

export type ImageSaveResult = {
    /** 是否走通了一条结果可确认的通道 */
    ok: boolean;
    /** 给用户看的说明 */
    message: string;
};

/**
 * 本地保存图片（分享摘抄卡片等）：图片不出本机。
 *
 * 先试系统分享面板（可直接存相册），没有再走原来的 blob 下载（<a download>）。
 *
 * 为什么不做成"自动降级到图床"：那个失败发生在宿主原生层——它把 blob: 地址
 * 丢进只认 http(s) 的下载器就抛错，网页端连个回调都拿不到（报错也不出现在页面里），
 * 所以程序无从判断"到底存下来了没有"。与其猜，不如让用户在弹窗上自己选，
 * 于是有了「本地保存 / 通过图床保存」这个二选一（见 reading-share-dialog）。
 *
 * 其它浏览器（含 iOS）行为不变。
 */
export async function saveImageBlob(blob: Blob, filename: string): Promise<ImageSaveResult> {
    // 系统分享面板：最干净，图片不出本机，能直接存到相册
    const file = new File([blob], filename, { type: blob.type || "image/png" });
    if (typeof navigator !== "undefined"
        && typeof navigator.share === "function"
        && typeof navigator.canShare === "function"
        && navigator.canShare({ files: [file] })) {
        try {
            await navigator.share({ files: [file] });
            return { ok: true, message: "已交给系统分享面板。" };
        } catch (err) {
            // 用户自己在分享面板上取消了，就当他不想存
            if (err instanceof DOMException && err.name === "AbortError") {
                return { ok: true, message: "已取消分享。" };
            }
            // 壳里没有真的分享实现，继续走下面的普通下载
        }
    }

    await downloadFile(blob, filename);
    return { ok: true, message: "已用本地方式保存。" };
}

/**
 * 图床通道：先把图上传成一条 http(s) 直链，再交给下载器——宿主只认 http(s) 时
 * 就靠这条。经同源中转是为了让 download 属性生效（跨域地址上的 download 会被
 * 浏览器忽略，变成「打开图片」），并带上 Content-Disposition 确保走下载。
 *
 * 注意：图片会短暂上传到公网（1 天后自动删除），所以这条只由用户主动选择。
 */
export async function saveImageBlobViaHost(blob: Blob, filename: string): Promise<ImageSaveResult> {
    try {
        const remote = await uploadImageForDownload(blob, filename);
        downloadRemoteUrl(
            `/api/image-hosting/fetch?url=${encodeURIComponent(remote)}&name=${encodeURIComponent(filename)}`,
            filename,
        );
        return { ok: true, message: "已通过图床保存（图床上的副本 1 天后自动删除）。" };
    } catch (err) {
        return {
            ok: false,
            message: `图床保存失败：${err instanceof Error ? err.message : String(err)}`,
        };
    }
}

export async function downloadUrl(url: string, filename: string): Promise<void> {
    let blob: Blob | null = null;

    try {
        const res = await fetch(url);
        if (res.ok) blob = await res.blob();
    } catch { /* CORS or network error — try proxy */ }

    if (!blob && /^https?:\/\//.test(url)) {
        try {
            const res = await fetch("/api/tool-proxy", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url, method: "GET" }),
            });
            if (res.ok) blob = await res.blob();
        } catch { /* proxy also failed */ }
    }

    if (blob) {
        await downloadFile(blob, filename);
    } else {
        const a = document.createElement("a");
        a.href = url;
        a.target = "_blank";
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
    }
}
