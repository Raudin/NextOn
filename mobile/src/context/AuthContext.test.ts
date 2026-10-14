import { sameUser } from "./AuthContext";
import type { User } from "@/lib/media-api";

describe("sameUser", () => {
  const baseUser: User = {
    id: 1,
    email: "test@example.com",
    name: "Test User",
    avatar_url: "https://example.com/avatar.png",
    notifications_enabled: true,
    created_at: "2026-01-01T00:00:00Z",
  };

  it("returns true for identical references and matching values", () => {
    expect(sameUser(baseUser, baseUser)).toBe(true);
    expect(sameUser(baseUser, { ...baseUser })).toBe(true);
  });

  it("returns false when standard scalar fields differ", () => {
    expect(sameUser(baseUser, { ...baseUser, name: "Changed" })).toBe(false);
    expect(sameUser(baseUser, { ...baseUser, notifications_enabled: false })).toBe(false);
    expect(sameUser(baseUser, { ...baseUser, avatar_url: undefined })).toBe(false);
  });

  it("dynamically compares future or arbitrary fields", () => {
    const userWithExtra1 = { ...baseUser, subscription_tier: "pro" } as User;
    const userWithExtra2 = { ...baseUser, subscription_tier: "free" } as User;
    const userWithExtraSame = { ...baseUser, subscription_tier: "pro" } as User;

    expect(sameUser(userWithExtra1, userWithExtraSame)).toBe(true);
    expect(sameUser(userWithExtra1, userWithExtra2)).toBe(false);
    expect(sameUser(baseUser, userWithExtra1)).toBe(false);
  });
});
