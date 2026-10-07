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

/** 安卓 WebView：UA 里带 "; wv)"。页面内生成的 blob: 下载在这类宿主里最容易被
 *  单独接管，所以只在这类环境走 saveImageBlob 的降级链，普通浏览器不受影响。 */
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

/**
 * 保存图片文件（分享摘抄卡片等）。
 *
 * 背景：有些安卓 WebView / 壳把「存图片」单独接管成自家原生下载器，那个下载器
 * 只认 http(s)，拿到页面内生成的 blob: 地址就报
 *   Expected URL scheme 'http' or 'https' but was 'blob'
 * 文本类文件不走那条分流，所以同一个 downloadFile 导出 .md 是好的——
 * 这也是「同一个下载函数，文本能存、图片不能存」的原因。
 *
 * 因此在安卓 WebView 里按兼容性从高到低试：
 *   ① 系统分享面板 —— 可直接「保存到相册」，完全绕开下载器；
 *   ② 把类型换成 application/octet-stream 再走常规下载 —— 绕开宿主对 image/*
 *      的分流（文件后缀仍是 .png，内容还是 PNG，只是类型标签变了）。
 * 其它浏览器（含 iOS）保持原来的行为，不受影响。
 */
export async function saveImageBlob(blob: Blob, filename: string): Promise<string | null> {
    if (!isAndroidWebView()) {
        await downloadFile(blob, filename);
        return null;
    }

    // ① 系统分享面板：最干净，图片不出本机
    const file = new File([blob], filename, { type: blob.type || "image/png" });
    if (typeof navigator.share === "function"
        && typeof navigator.canShare === "function"
        && navigator.canShare({ files: [file] })) {
        try {
            await navigator.share({ files: [file] });
            return null;
        } catch (err) {
            // 用户自己在分享面板上取消了，就当他不想存，别再弹下载
            if (err instanceof DOMException && err.name === "AbortError") return null;
            // 其它失败（壳里没有真的分享实现等）继续往下试
        }
    }

    // ② 图床直链：宿主只认 http(s)，那就把图先上传成一条 http(s) 再交给它。
    //    经同源中转是为了让 download 属性生效（跨域地址上的 download 会被浏览器
    //    忽略，变成「打开图片」），并带上 Content-Disposition 确保走下载。
    try {
        const remote = await uploadImageForDownload(blob, filename);
        downloadRemoteUrl(
            `/api/image-hosting/fetch?url=${encodeURIComponent(remote)}&name=${encodeURIComponent(filename)}`,
            filename,
        );
        return "已通过图床保存（图床上的副本 1 天后自动删除）";
    } catch { /* 没配图床、或上传失败，继续往下试 */ }

    // ③ 换掉类型标签再走常规下载：绕开宿主对 image/* 的分流。
    // ④ 原样下载兜底。
    const neutral = blob.type === "application/octet-stream"
        ? blob
        : new Blob([blob], { type: "application/octet-stream" });
    await downloadFile(neutral, filename);
    return null;
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
