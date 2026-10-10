// ADR-0093 / ADR-0094: 資格情報を載せる接続先の検査を一か所にまとめる。
//
// 平文のHTTPや、検査していない宛先へのリダイレクトに資格情報（agent 資格情報、交換後の
// トークン、クライアント秘密）を送ると、経路上や転送先で読まれる。接続先は、https か
// ループバックの http だけを許し、URL に資格情報や断片を埋め込ませない。

export class InsecureEndpointError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InsecureEndpointError";
  }
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** 資格情報を送ってよい接続先なら URL を返し、そうでなければ InsecureEndpointError を投げる。 */
export function requireSecureEndpoint(raw: string, name: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new InsecureEndpointError(`${name} is not a valid URL.`);
  }
  const loopback = LOOPBACK_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new InsecureEndpointError(`${name} must be https (http only on loopback).`);
  }
  if (url.username || url.password || url.hash) {
    throw new InsecureEndpointError(`${name} must not carry credentials or a fragment.`);
  }
  return url;
}
