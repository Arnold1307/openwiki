import path from "node:path";
import { describe, expect, it } from "vitest";
import { PathError, resolveDocPath } from "../src/docs/resolve-path.ts";

const root = path.resolve("snapshot-root");
const docs = path.join(root, "openwiki");

describe("resolveDocPath", () => {
  it("resolves a page inside openwiki/", () => {
    expect(resolveDocPath(root, "quickstart.md")).toBe(
      path.join(docs, "quickstart.md"),
    );
    expect(resolveDocPath(root, "architecture/overview.md")).toBe(
      path.join(docs, "architecture", "overview.md"),
    );
  });

  it.each([
    ["../secret.txt"],
    ["architecture/../../secret.txt"],
    ["%2e%2e/secret.txt"],
    ["%2e%2e%2fsecret.txt"],
    ["/etc/passwd"],
    ["..\\secret.txt"],
    ["C:\\Windows\\win.ini"],
    ["quickstart.md\0.txt"],
    ["%E0%A4%A"],
    [""],
  ])("rejects %j", (candidate) => {
    expect(() => resolveDocPath(root, candidate)).toThrow(PathError);
  });
});
