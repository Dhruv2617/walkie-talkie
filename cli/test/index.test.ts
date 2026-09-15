import { beforeEach, describe, expect, it, vi } from "vitest";
import { dispatch } from "../src/index";
import * as init from "../src/commands/init";
import * as join from "../src/commands/join";
import * as share from "../src/commands/share";
import * as ask from "../src/commands/ask";

vi.mock("../src/commands/init");
vi.mock("../src/commands/join");
vi.mock("../src/commands/share");
vi.mock("../src/commands/ask");

beforeEach(() => {
  vi.resetAllMocks();
});

describe("dispatch", () => {
  it("init prints the invite code", async () => {
    vi.mocked(init.runInit).mockResolvedValue("CTXR-abc");
    const out = await dispatch(["init"]);
    expect(out).toContain("CTXR-abc");
  });

  it("join requires a role and prints attached message", async () => {
    vi.mocked(join.runJoin).mockResolvedValue({ messages: [] });
    const out = await dispatch(["join", "CTXR-abc", "--role", "backend"]);
    expect(join.runJoin).toHaveBeenCalledWith("CTXR-abc", "backend");
    expect(out).toContain("attached as backend");
  });

  it("share pushes the given text", async () => {
    vi.mocked(share.runShare).mockResolvedValue(9);
    const out = await dispatch(["share", "qty is integer only"]);
    expect(share.runShare).toHaveBeenCalledWith("qty is integer only");
    expect(out).toContain("9");
  });

  it("ask prints the returned answer", async () => {
    vi.mocked(ask.runAsk).mockResolvedValue("integer only");
    const out = await dispatch(["ask", "does qty accept decimals?"]);
    expect(out).toBe("integer only");
  });
});
