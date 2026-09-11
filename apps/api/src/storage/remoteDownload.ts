import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number) as [number, number, number, number];
    return !(a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
      || (a === 192 && b === 0) || (a === 198 && [18, 19].includes(b))
      || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113));
  }
  if (isIP(address) === 6) {
    const lower = address.toLowerCase();
    // Only global unicast; mapped IPv4, link-local, loopback and ULA are excluded.
    return /^[23][a-f0-9]{3}:/.test(lower) && !/^2001:(?:db8|0):/.test(lower) && !lower.startsWith("2002:");
  }
  return false;
}

export async function downloadPublicMedia(source: string, maxBytes: number, timeoutMs = 120_000): Promise<{ bytes: Buffer; contentType: string }> {
  let current = new URL(source);
  const deadline = Date.now() + timeoutMs;
  for (let redirect = 0; redirect < 4; redirect += 1) {
    if (!["https:", "http:"].includes(current.protocol) || current.username || current.password) throw new Error("素材地址必须是公开 HTTP(S) 地址");
    const hostname = current.hostname.replace(/^\[|\]$/g, "");
    const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await lookup(hostname, { all: true });
    if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) throw new Error("素材地址不能指向内网、回环或云服务器元数据地址");
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("素材下载超时");
    const pinned = addresses[0]!;
    const response = await new Promise<{ bytes: Buffer; contentType: string; redirect?: string }>((resolve, reject) => {
      const request = (current.protocol === "https:" ? httpsRequest : httpRequest)(current, {
        // Pin the validated IP; no second DNS lookup can rebind to an internal address.
        hostname: pinned.address, family: pinned.family, servername: hostname,
        headers: { Host: current.host, "User-Agent": "ManjiaoMedia/1.0", "Accept-Encoding": "identity" }
      }, response => {
        const status = response.statusCode || 0;
        if (status >= 300 && status < 400 && response.headers.location) {
          response.resume();
          resolve({ bytes: Buffer.alloc(0), contentType: "", redirect: response.headers.location });
          return;
        }
        if (status < 200 || status >= 300) { response.resume(); reject(new Error(`素材下载失败（HTTP ${status}）`)); return; }
        if (Number(response.headers["content-length"] || 0) > maxBytes) { response.destroy(); reject(new Error("素材文件过大")); return; }
        let size = 0;
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) response.destroy(new Error("素材文件过大"));
          else chunks.push(chunk);
        });
        response.on("end", () => resolve({ bytes: Buffer.concat(chunks), contentType: response.headers["content-type"] || "" }));
        response.on("error", reject);
      });
      const timer = setTimeout(() => request.destroy(new Error("素材下载超时")), remaining);
      request.on("close", () => clearTimeout(timer));
      request.on("error", reject);
      request.end();
    });
    if (!response.redirect) return response;
    current = new URL(response.redirect, current);
  }
  throw new Error("素材地址重定向次数过多");
}
