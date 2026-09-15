const BASE_URL = process.env.CTX_RELAY_URL ?? "https://relay.ctx-relay.dev";

export interface Message {
  id: number;
  from: "backend" | "frontend";
  ts: number;
  type: "fyi" | "question" | "answer";
  text: string;
  reply_to: number | null;
}

async function request(path: string, init?: RequestInit): Promise<any> {
  const resp = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await resp.json();
  if (!resp.ok) {
    const error = body?.detail?.error ?? body?.detail ?? "request_failed";
    throw new Error(typeof error === "string" ? error : JSON.stringify(error));
  }
  return body;
}

export async function createChannel(): Promise<{ channelId: string; secret: string }> {
  const body = await request("/channels", { method: "POST" });
  return { channelId: body.channel_id, secret: body.secret };
}

export async function joinChannel(channelId: string, secret: string, role: string): Promise<void> {
  await request(`/channels/${channelId}/join`, {
    method: "POST",
    body: JSON.stringify({ secret, role }),
  });
}

export async function heartbeat(channelId: string, secret: string, role: string): Promise<void> {
  await request(`/channels/${channelId}/heartbeat`, {
    method: "POST",
    body: JSON.stringify({ secret, role }),
  });
}

export async function getPresence(channelId: string, role: string): Promise<boolean> {
  const body = await request(`/channels/${channelId}/presence/${role}`);
  return body.online as boolean;
}

export async function pushMessage(
  channelId: string,
  secret: string,
  msg: { from: string; type: string; text: string; reply_to?: number }
): Promise<number> {
  const body = await request(`/channels/${channelId}/messages`, {
    method: "POST",
    body: JSON.stringify({ secret, ...msg }),
  });
  return body.id as number;
}

export async function pullMessages(channelId: string, since: number): Promise<Message[]> {
  const body = await request(`/channels/${channelId}/messages?since=${since}`);
  return body.messages as Message[];
}
