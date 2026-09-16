const BASE_URL = process.env.CTX_RELAY_URL ?? "https://relay.walkie-talkie.dev";

export type Slot = "buddy1" | "buddy2";

export interface Message {
  id: number;
  from: Slot;
  ts: number;
  type: "fyi" | "question" | "answer";
  text: string;
  reply_to: number | null;
}

function stringifyDetail(detail: unknown): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const messages = detail
      .map((d) => (d && typeof d === "object" && "msg" in d ? String((d as any).msg) : JSON.stringify(d)))
      .join("; ");
    return messages || "request_failed";
  }
  if (detail && typeof detail === "object") {
    const error = (detail as any).error;
    if (typeof error === "string") return error;
    return JSON.stringify(detail);
  }
  return "request_failed";
}

async function request(path: string, init?: RequestInit): Promise<any> {
  const resp = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });

  let body: any;
  try {
    body = await resp.json();
  } catch {
    body = null;
  }

  if (!resp.ok) {
    const error = body?.detail !== undefined ? stringifyDetail(body.detail) : `${resp.status} ${resp.statusText}`.trim();
    throw new Error(error || "request_failed");
  }
  return body;
}

export async function createChannel(): Promise<{ channelId: string; secret: string }> {
  const body = await request("/channels", { method: "POST" });
  return { channelId: body.channel_id, secret: body.secret };
}

export async function joinChannel(channelId: string, secret: string): Promise<Slot> {
  const body = await request(`/channels/${channelId}/join`, {
    method: "POST",
    body: JSON.stringify({ secret }),
  });
  return body.slot as Slot;
}

export async function heartbeat(channelId: string, secret: string, slot: Slot): Promise<void> {
  await request(`/channels/${channelId}/heartbeat`, {
    method: "POST",
    body: JSON.stringify({ secret, slot }),
  });
}

export async function getPresence(channelId: string, secret: string, slot: Slot): Promise<boolean> {
  const body = await request(
    `/channels/${channelId}/presence/${slot}?secret=${encodeURIComponent(secret)}`
  );
  return body.online as boolean;
}

export async function pushMessage(
  channelId: string,
  secret: string,
  msg: { from: Slot; type: "fyi" | "question" | "answer"; text: string; reply_to?: number }
): Promise<number> {
  const body = await request(`/channels/${channelId}/messages`, {
    method: "POST",
    body: JSON.stringify({ secret, ...msg }),
  });
  return body.id as number;
}

export async function pullMessages(channelId: string, secret: string, since: number): Promise<Message[]> {
  const body = await request(
    `/channels/${channelId}/messages?since=${since}&secret=${encodeURIComponent(secret)}`
  );
  return body.messages as Message[];
}
