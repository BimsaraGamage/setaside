import { describe, expect, it } from "vitest";
import { currentZoneName, currentZoneNames, zoneToAsk } from "../../src/money";

// SAB-64 · The home time zone list shows current city names, not old ones.

describe("old zone names become current ones", () => {
  it("maps the old names browsers still give", () => {
    expect(currentZoneName("Asia/Calcutta")).toBe("Asia/Kolkata");
    expect(currentZoneName("Europe/Kiev")).toBe("Europe/Kyiv");
    expect(currentZoneName("Asia/Saigon")).toBe("Asia/Ho_Chi_Minh");
    expect(currentZoneName("Asia/Rangoon")).toBe("Asia/Yangon");
    expect(currentZoneName("Asia/Katmandu")).toBe("Asia/Kathmandu");
  });

  it("leaves current names alone", () => {
    expect(currentZoneName("Asia/Colombo")).toBe("Asia/Colombo");
    expect(currentZoneName("Asia/Kolkata")).toBe("Asia/Kolkata");
  });

  it("every current name is one the runtime knows", () => {
    for (const z of currentZoneNames(["Asia/Calcutta", "Europe/Kiev", "Asia/Saigon", "Asia/Rangoon"])) {
      expect(() => new Intl.DateTimeFormat("en", { timeZone: z })).not.toThrow();
    }
  });

  it("the list has only current names, sorted, without doubles", () => {
    const list = currentZoneNames([
      "Europe/Kiev",
      "Asia/Kolkata",
      "Asia/Calcutta",
      "Asia/Colombo",
      "Europe/Kyiv",
    ]);
    expect(list).toEqual(["Asia/Colombo", "Asia/Kolkata", "Europe/Kyiv"]);
  });
});

describe("the switch question ignores old-vs-new names", () => {
  it("asks nothing when home is the old name and the phone the new one", () => {
    const home = currentZoneName("Asia/Calcutta");
    const phone = currentZoneName("Asia/Kolkata");
    expect(zoneToAsk({ home, phone, asked: null })).toBeNull();
  });

  it("asks nothing when the zone asked about was saved with the old name", () => {
    const asked = currentZoneName("Europe/Kiev");
    expect(zoneToAsk({ home: "Asia/Colombo", phone: currentZoneName("Europe/Kyiv"), asked })).toBeNull();
  });
});
