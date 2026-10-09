// ADR-0093: backend へ送る認証ヘッダーを一か所で決める。document_client.ts から
// 分けてあるのは、audit_log.ts など他のモジュールが、document_client を差し替える
// 試験でも同じ規則を使えるようにするため。

export type AuthConfig = {
  apiKey?: string;
  /** tenantと文書に束縛した agent 資格情報。saas-multitenant ではこれだけを送る。 */
  agentCredential?: string;
  /** ADR-0094: トークン交換で得た、backend 宛ての短命の OAuth トークン（要求ごと）。 */
  agentBearer?: string;
};

export const AGENT_CREDENTIAL_HEADER = "Sui-Sensemaking-Agent-Credential";
export const AGENT_BEARER_HEADER = "Sui-Sensemaking-Agent-Bearer";

/**
 * 認証ヘッダーを一か所で決める。agent 資格情報があれば、それだけを送る（静的な
 * X-API-Key は tenant を証明しないので、同時には送らない）。
 */
export function authHeaders(config: AuthConfig): Record<string, string> {
  if (config.agentBearer) {
    return { [AGENT_BEARER_HEADER]: `Bearer ${config.agentBearer}` };
  }
  if (config.agentCredential) {
    return { [AGENT_CREDENTIAL_HEADER]: config.agentCredential };
  }
  return config.apiKey ? { "X-API-Key": config.apiKey } : {};
}
