import { afterEach, describe, expect, it, vi } from "vitest";
import * as relayClient from "../src/relayClient";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("relayClient", () => {
  it("createChannel posts to /channels and returns the body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ channel_id: "abc", secret: "shh" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await relayClient.createChannel();

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/channels"),
      expect.objectContaining({ method: "POST" })
    );
    expect(result).toEqual({ channelId: "abc", secret: "shh" });
  });

  it("joinChannel throws role_taken on 409", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ detail: { error: "role_taken" } }),
      })
    );

    await expect(relayClient.joinChannel("abc", "shh", "backend")).rejects.toThrow("role_taken");
  });
});
