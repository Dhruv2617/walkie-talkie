import { beforeEach, describe, expect, it, vi } from "vitest";
import { dispatch } from "../src/index";
import * as init from "../src/commands/init";
import * as join from "../src/commands/join";
import * as share from "../src/commands/share";
import * as ask from "../src/commands/ask";
import * as install from "../src/commands/install";

vi.mock("../src/commands/init");
vi.mock("../src/commands/join");
vi.mock("../src/commands/share");
vi.mock("../src/commands/ask");
vi.mock("../src/commands/install");

beforeEach(() => {
  vi.resetAllMocks();
});

describe("dispatch", () => {
  it("init prints the invite code", async () => {
    vi.mocked(init.runInit).mockResolvedValue("WT-abc");
    const out = await dispatch(["init"]);
    expect(out).toContain("WT-abc");
  });

  it("join requires a role and prints attached message", async () => {
    vi.mocked(join.runJoin).mockResolvedValue({ messages: [] });
    const out = await dispatch(["join", "WT-abc", "--role", "backend"]);
    expect(join.runJoin).toHaveBeenCalledWith("WT-abc", "backend");
    expect(out).toContain("attached as backend");
  });

  it("share pushes the given text", async () => {
    vi.mocked(share.runShare).mockResolvedValue(9);
    const out = await dispatch(["share", "qty", "is", "integer", "only"]);
    expect(share.runShare).toHaveBeenCalledWith("qty is integer only", undefined);
    expect(out).toContain("9");
  });

  it("share parses --reply-to and passes it through", async () => {
    vi.mocked(share.runShare).mockResolvedValue(102);
    const out = await dispatch(["share", "integer", "only", "--reply-to", "101"]);
    expect(share.runShare).toHaveBeenCalledWith("integer only", { replyTo: 101 });
    expect(out).toContain("102");
  });

  it("ask prints the returned answer", async () => {
    vi.mocked(ask.runAsk).mockResolvedValue("integer only");
    const out = await dispatch(["ask", "does qty accept decimals?"]);
    expect(out).toBe("integer only");
  });

  it("join lists pulled messages and flags unanswered questions", async () => {
    vi.mocked(join.runJoin).mockResolvedValue({
      messages: [
        { id: 100, from: "backend", ts: 1, type: "fyi", text: "renamed org_name", reply_to: null },
        {
          id: 101,
          from: "backend",
          ts: 2,
          type: "question",
          text: "does qty accept decimals?",
          reply_to: null,
        },
      ],
    });
    const out = await dispatch(["join", "WT-abc", "--role", "frontend"]);
    expect(out).toContain("2 unread message(s)");
    expect(out).toContain("does qty accept decimals?");
    expect(out).toContain("1 question(s) still need a reply");
    expect(out).toContain("[101] does qty accept decimals?");
  });

  it("join does not flag a question that already has a matching answer in the same pull", async () => {
    vi.mocked(join.runJoin).mockResolvedValue({
      messages: [
        {
          id: 101,
          from: "frontend",
          ts: 1,
          type: "question",
          text: "does qty accept decimals?",
          reply_to: null,
        },
        { id: 102, from: "backend", ts: 2, type: "answer", text: "integer only", reply_to: 101 },
      ],
    });
    const out = await dispatch(["join", "WT-abc", "--role", "frontend"]);
    expect(out).not.toContain("still need a reply");
  });

  it("join rejects when --role is missing", async () => {
    await expect(dispatch(["join", "WT-abc"])).rejects.toThrow(
      "usage: ctx-relay join <code> --role <backend|frontend>"
    );
  });

  it("throws a clear error for an unknown command", async () => {
    await expect(dispatch(["frobnicate"])).rejects.toThrow("unknown command: frobnicate");
  });

  it("install writes Claude Code commands and reports how many", async () => {
    vi.mocked(install.runInstall).mockReturnValue([
      "/repo/.claude/commands/share-context.md",
      "/repo/.claude/commands/ask-relay.md",
      "/repo/.claude/commands/join-relay.md",
    ]);
    const out = await dispatch(["install"]);
    expect(install.runInstall).toHaveBeenCalled();
    expect(out).toContain("installed 3 Claude Code command(s)");
  });
});
