import { describe, expect, it } from "vitest";
import { roomIdFromHash, shareUrl } from "./config";

const id = "3f2a9c1e-7b4d-4e8a-9f10-2c3d4e5f6a7b";

describe("share links", () => {
  it("round-trip a room id through the URL hash", () => {
    const url = shareUrl(id, { origin: "https://blockpad-five.vercel.app", pathname: "/" });
    expect(url).toBe(`https://blockpad-five.vercel.app/#join=${id}`);
    expect(roomIdFromHash(new URL(url).hash)).toBe(id);
  });

  it("ignore anything that isn't a well-formed room id", () => {
    expect(roomIdFromHash("")).toBeNull();
    expect(roomIdFromHash("#join=")).toBeNull();
    expect(roomIdFromHash("#join=../../etc")).toBeNull();
    expect(roomIdFromHash(`#join=${id}&x=1`)).toBeNull();
    expect(roomIdFromHash(`#other=${id}`)).toBeNull();
  });
});
