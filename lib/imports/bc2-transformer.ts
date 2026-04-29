// lib/imports/bc2-transformer.ts
import { query } from "../db";

interface ParsedProjectTitle {
  code: string | null;
  num: string | null;
  title: string;
}

const PRIMARY_PATTERN = /^([A-Za-z]+)-(\d{3,4}):\s*(.+)$/;
const FALLBACK_PATTERN = /^([A-Za-z]+)\s*[-\u2013]\s*(.+)$/;

export function parseProjectTitle(raw: string): ParsedProjectTitle {
  const primaryMatch = raw.match(PRIMARY_PATTERN);
  if (primaryMatch) {
    return {
      code: primaryMatch[1],
      num: primaryMatch[2],
      title: primaryMatch[3].trim()
    };
  }

  const fallbackMatch = raw.match(FALLBACK_PATTERN);
  if (fallbackMatch) {
    return {
      code: fallbackMatch[1],
      num: null,
      title: fallbackMatch[2].trim()
    };
  }

  return { code: null, num: null, title: raw.trim() };
}

// Look up a client by code (case-insensitive) or create one.
// Returns the client id (uuid).
export async function resolveClientId(code: string): Promise<string> {
  const existing = await query(
    "select id from clients where lower(code) = lower($1) limit 1",
    [code]
  );
  if (existing.rows[0]) {
    return existing.rows[0].id as string;
  }

  const created = await query(
    "insert into clients (name, code) values ($1, $2) returning id",
    [code, code]
  );
  return created.rows[0].id as string;
}

import type { Bc2Person } from "./bc2-fetcher";

interface ResolvedPerson {
  localProfileId: string;
  isLegacy: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function resolvePerson(person: Bc2Person, jobId: string): Promise<ResolvedPerson> {
  // Check import map first (idempotency)
  const mapRow = await query(
    "select local_user_profile_id from import_map_people where basecamp_person_id = $1",
    [String(person.id)]
  );
  if (mapRow.rows[0]) {
    const cachedId = mapRow.rows[0].local_user_profile_id as string;
    const profileRow = await query(
      "select is_legacy from user_profiles where id = $1 limit 1",
      [cachedId]
    );
    const isLegacy = (profileRow.rows[0]?.is_legacy as boolean | undefined) ?? false;
    return { localProfileId: cachedId, isLegacy };
  }

  // Try to match by email
  const emailRow = await query(
    "select id from user_profiles where email = $1 limit 1",
    [person.email_address]
  );

  let localProfileId: string;
  let isLegacy: boolean;

  if (emailRow.rows[0]) {
    localProfileId = emailRow.rows[0].id as string;
    isLegacy = false;
  } else {
    // Create legacy profile
    const [firstName, ...restParts] = person.name.split(" ");
    const lastName = restParts.join(" ") || null;
    const legacyId = `bc2_${person.id}`;
    const created = await query(
      `insert into user_profiles
         (id, email, first_name, last_name, avatar_url, job_title, timezone, is_legacy)
       values ($1, $2, $3, $4, $5, $6, $7, true)
       on conflict (id) do nothing
       returning id`,
      [
        legacyId,
        person.email_address,
        firstName ?? null,
        lastName,
        person.avatar_url ?? null,
        person.title ?? null,
        person.time_zone ?? null
      ]
    );
    localProfileId = (created.rows[0]?.id as string) ?? legacyId;
    isLegacy = true;
  }

  // Record in import map
  await query(
    "insert into import_map_people (basecamp_person_id, local_user_profile_id) values ($1, $2) on conflict (basecamp_person_id) do nothing",
    [String(person.id), localProfileId]
  );

  return { localProfileId, isLegacy };
}

// Returns true if a legacy profile was found and reconciled.
export async function reconcileLegacyProfile(
  email: string,
  googleUid: string
): Promise<boolean> {
  const legacyRow = await query(
    "select id from user_profiles where email = $1 and is_legacy = true limit 1",
    [email]
  );
  if (!legacyRow.rows[0]) return false;

  const oldId = legacyRow.rows[0].id as string;

  // Update the profile: new id = Google UID, clear legacy flag
  await query(
    "update user_profiles set id = $1, is_legacy = false, updated_at = now() where id = $2",
    [googleUid, oldId]
  );

  // Update import_map_people to point to the new id
  await query(
    "update import_map_people set local_user_profile_id = $1 where local_user_profile_id = $2",
    [googleUid, oldId]
  );

  return true;
}
