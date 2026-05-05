import type { Pool } from "pg";

export interface Mappers {
  prodProjectIdToBc2Id(prodProjectId: number): Promise<number | null>;
  bc2IdToTestProjectId(bc2Id: number): Promise<number | null>;
  prodUserIdToTestUserId(prodUserId: number): Promise<number | null>;
  testClientIdByCode(code: string): Promise<number | null>;
}

export function createMappers(opts: { prodPool: Pool; testPool: Pool }): Mappers {
  const { prodPool, testPool } = opts;

  const projProdToBc2 = new Map<number, number | null>();
  const projBc2ToTest = new Map<number, number | null>();
  const userProdToBc2 = new Map<number, number | null>();
  const userBc2ToTest = new Map<number, number | null>();
  const clientCodeToTest = new Map<string, number | null>();

  async function prodProjectIdToBc2Id(id: number): Promise<number | null> {
    if (projProdToBc2.has(id)) return projProdToBc2.get(id)!;
    const r = await prodPool.query(
      "SELECT bc2_id FROM bc2_projects_map WHERE project_id = $1 LIMIT 1",
      [id],
    );
    const v = r.rows[0]?.bc2_id ?? null;
    projProdToBc2.set(id, v);
    return v;
  }

  async function bc2IdToTestProjectId(bc2Id: number): Promise<number | null> {
    if (projBc2ToTest.has(bc2Id)) return projBc2ToTest.get(bc2Id)!;
    const r = await testPool.query(
      "SELECT project_id FROM bc2_projects_map WHERE bc2_id = $1 LIMIT 1",
      [bc2Id],
    );
    const v = r.rows[0]?.project_id ?? null;
    projBc2ToTest.set(bc2Id, v);
    return v;
  }

  async function prodUserIdToBc2Id(id: number): Promise<number | null> {
    if (userProdToBc2.has(id)) return userProdToBc2.get(id)!;
    const r = await prodPool.query(
      "SELECT bc2_id FROM bc2_people_map WHERE user_id = $1 LIMIT 1",
      [id],
    );
    const v = r.rows[0]?.bc2_id ?? null;
    userProdToBc2.set(id, v);
    return v;
  }

  async function bc2UserIdToTestUserId(bc2Id: number): Promise<number | null> {
    if (userBc2ToTest.has(bc2Id)) return userBc2ToTest.get(bc2Id)!;
    const r = await testPool.query(
      "SELECT user_id FROM bc2_people_map WHERE bc2_id = $1 LIMIT 1",
      [bc2Id],
    );
    const v = r.rows[0]?.user_id ?? null;
    userBc2ToTest.set(bc2Id, v);
    return v;
  }

  async function prodUserIdToTestUserId(id: number): Promise<number | null> {
    const bc2 = await prodUserIdToBc2Id(id);
    if (bc2 === null) return null;
    return bc2UserIdToTestUserId(bc2);
  }

  async function testClientIdByCode(code: string): Promise<number | null> {
    if (clientCodeToTest.has(code)) return clientCodeToTest.get(code)!;
    const r = await testPool.query(
      "SELECT id FROM clients WHERE code = $1 LIMIT 1",
      [code],
    );
    const v = r.rows[0]?.id ?? null;
    clientCodeToTest.set(code, v);
    return v;
  }

  return {
    prodProjectIdToBc2Id,
    bc2IdToTestProjectId,
    prodUserIdToTestUserId,
    testClientIdByCode,
  };
}
