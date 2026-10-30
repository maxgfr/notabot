import { describe, expect, test } from "bun:test";
import { CROSS_CHECK_RULES, REQUEST_RULES } from "../src/middleware/request";
import { RULES } from "../src/score/index";

describe("doc/methods.md", () => {
  test("describes every rule the code has", async () => {
    const doc = await Bun.file(new URL("../doc/methods.md", import.meta.url)).text();
    const ids = [...RULES, ...REQUEST_RULES, ...CROSS_CHECK_RULES].map((r) => r.id);
    expect(ids.filter((id) => !doc.includes(`\`${id}\``))).toEqual([]);
  });
});
