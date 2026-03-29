// tests/integration/bc2-migrate.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { query } from "@/lib/db";
import { resolvePerson, parseProjectTitle, resolveClientId } from "@/lib/imports/bc2-transformer";
import type { Bc2Person } from "@/lib/imports/bc2-fetcher";

// These tests hit the real DB — requires DATABASE_URL in env
const SKIP = !process.env.DATABASE_URL;

describe.skipIf(SKIP)("BC2 migration integration", () => {
  const testPersonId = 999991;
  const testEmail = `bc2test_${Date.now()}@example.com`;
  const testPerson: Bc2Person = {
    id: testPersonId,
    name: "Test Legacy User",
    email_address: testEmail,
    avatar_url: null,
    title: "QA",
    time_zone: "UTC"
  };

  afterAll(async () => {
    // Cleanup
    await query("delete from import_map_people where basecamp_person_id = $1", [String(testPersonId)]);
    await query("delete from user_profiles where email = $1", [testEmail]);
  });

  it("creates a legacy profile for an unknown BC2 person", async () => {
    const result = await resolvePerson(testPerson, "test-job");
    expect(result.localProfileId).toBe(`bc2_${testPersonId}`);
    expect(result.isLegacy).toBe(true);

    const profile = await query("select * from user_profiles where id = $1", [`bc2_${testPersonId}`]);
    expect(profile.rows[0]).toBeDefined();
    expect(profile.rows[0].is_legacy).toBe(true);
    expect(profile.rows[0].email).toBe(testEmail);
  });

  it("is idempotent: re-running resolvePerson returns same id without duplicates", async () => {
    const result = await resolvePerson(testPerson, "test-job");
    expect(result.localProfileId).toBe(`bc2_${testPersonId}`);

    const profileRows = await query("select id from user_profiles where email = $1", [testEmail]);
    expect(profileRows.rows).toHaveLength(1);

    const mapRows = await query(
      "select * from import_map_people where basecamp_person_id = $1",
      [String(testPersonId)]
    );
    expect(mapRows.rows).toHaveLength(1);
  });

  it("resolves project title and finds/creates client", async () => {
    const testCode = `BCTST${Date.now().toString().slice(-4)}`;
    const { code, num, title } = parseProjectTitle(`${testCode}-0042: Test Project Alpha`);
    expect(code).toBe(testCode);
    expect(num).toBe("0042");
    expect(title).toBe("Test Project Alpha");

    const clientId = await resolveClientId(testCode);
    expect(typeof clientId).toBe("string");

    // Idempotency: resolving again returns same id
    const clientId2 = await resolveClientId(testCode);
    expect(clientId2).toBe(clientId);

    // Cleanup
    await query("delete from clients where code = $1", [testCode]);
  });
});
