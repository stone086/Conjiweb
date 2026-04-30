import type { OmemoEncryptedPayload, OmemoParsedMessage } from "./types";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function unescapeXml(value: string): string {
  return value
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

export class OmemoXml {
  buildEncryptedMessageXml(data: OmemoEncryptedPayload): string {
    const keys = data.keys
      .map((item) => `<key rid="${item.rid}"${item.preKey ? ' prekey="true"' : ""}>${escapeXml(item.key)}</key>`)
      .join("");

    return `<encrypted xmlns="eu.siacs.conversations.axolotl"><header sid="${data.sid}">${keys}</header><payload>${escapeXml(data.payload)}</payload></encrypted>`;
  }

  parseEncryptedMessageXml(stanzaXml: string): OmemoParsedMessage {
    const sidMatch = stanzaXml.match(/<header[^>]*sid=["'](\d+)["']/);
    if (!sidMatch) throw new Error("Missing OMEMO sid.");

    const keys = Array.from(stanzaXml.matchAll(/<key[^>]*rid=["'](\d+)["'][^>]*>([^<]*)<\/key>/g)).map((match) => ({
      rid: Number(match[1]),
      key: unescapeXml(match[2]),
      preKey: match[0].includes("prekey")
    }));

    const payloadMatch = stanzaXml.match(/<payload>([^<]*)<\/payload>/);
    if (!payloadMatch) throw new Error("Missing OMEMO payload.");

    return {
      senderDeviceId: Number(sidMatch[1]),
      keys,
      payload: unescapeXml(payloadMatch[1])
    };
  }

  buildDeviceListXml(deviceIds: number[]): string {
    return `<list xmlns="eu.siacs.conversations.axolotl">${deviceIds.map((id) => `<device id="${id}"/>`).join("")}</list>`;
  }

  parseDeviceListXml(xml: string): number[] {
    return Array.from(xml.matchAll(/<device[^>]*id=["'](\d+)["'][^/]*\/>/g)).map((match) => Number(match[1]));
  }
}
