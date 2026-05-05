// lib/imports/migration/people.ts
import { resolvePerson } from "../bc2-transformer";
import { logRecord, type Query, type DataSource } from "./jobs";
import type { DumpReader } from "../dump-reader";

export async function migratePeople(args: {
  reader: DumpReader;
  q: Query;
  jobId: string;
}): Promise<{ success: number; failed: number }> {
  const { reader, q, jobId } = args;
  let success = 0;
  let failed = 0;

  const peopleResult = await reader.people();
  const dataSource: DataSource = peopleResult.source;
  const people = peopleResult.body ?? [];

  for (const person of people) {
    try {
      const resolved = await resolvePerson(person, jobId);
      await q(
        `insert into import_map_people (basecamp_person_id, local_user_profile_id)
         values ($1, $2)
         on conflict (basecamp_person_id) do update set local_user_profile_id = excluded.local_user_profile_id`,
        [String(person.id), resolved.localProfileId],
      );
      await logRecord(q, {
        jobId,
        recordType: "person",
        sourceId: String(person.id),
        status: "success",
        dataSource,
      });
      success++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await logRecord(q, {
        jobId,
        recordType: "person",
        sourceId: String(person.id),
        status: "failed",
        message,
        dataSource,
      });
      failed++;
    }
  }
  return { success, failed };
}
