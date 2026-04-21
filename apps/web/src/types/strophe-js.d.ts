declare module "strophe.js" {
  export interface StropheBuilder {
    c(name: string, attrs?: Record<string, string>): StropheBuilder;
    t(text: string): StropheBuilder;
    up(): StropheBuilder;
    tree(): Element;
  }

  export interface StropheConnection {
    connect(jid: string, password: string, callback: (status: number) => void): void;
    disconnect(): void;
    send(stanza: StropheBuilder | Element): void;
    sendIQ(
      stanza: Element,
      onSuccess: (result: Element) => void,
      onError?: (error?: unknown) => void,
    ): void;
    addHandler(
      handler: (stanza: Element) => boolean,
      ns?: string | null,
      name?: string | null,
      type?: string | null,
      id?: string | null,
      from?: string | null,
      options?: unknown,
    ): unknown;
    deleteHandler(handlerRef: unknown): void;
  }

  export interface StropheStatic {
    Connection: new (service: string) => StropheConnection;
    Status: {
      ERROR: number;
      CONNECTING: number;
      CONNFAIL: number;
      AUTHENTICATING: number;
      AUTHFAIL: number;
      CONNECTED: number;
      DISCONNECTED: number;
      DISCONNECTING: number;
      ATTACHED: number;
      REDIRECT: number;
    };
  }

  export const Strophe: StropheStatic;
  export function $msg(attrs?: Record<string, string>): StropheBuilder;
  export function $iq(attrs?: Record<string, string>): StropheBuilder;
  export function $pres(attrs?: Record<string, string>): StropheBuilder;
}
