import { z } from "zod";
import { config } from "./config";
import { getSupabaseAdmin } from "./supabase-admin";
import {
  createUserProfile,
  getUserProfileById,
  updateUserProfile,
  type UserProfile
} from "./repositories";
import { reconcileLegacyProfile } from "./imports/bc2-transformer";

const callbackSchema = z.object({
  email: z.string().email(),
  provider: z.literal("google")
});

export function isAllowedWorkspaceEmail(email: string) {
  const domain = email.split("@")[1]?.toLowerCase();
  return domain === config.workspaceDomain();
}

export function parseCallbackBody(body: unknown) {
  return callbackSchema.parse(body);
}

type AuthenticatedUser = {
  id: string;
  email: string;
};

function toNullableString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function splitDisplayName(fullName: string) {
  const parts = fullName.split(/\s+/).filter(Boolean);
  if (!parts.length) {
    return { firstName: null, lastName: null };
  }
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: null };
  }
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" ")
  };
}

function profileFromMetadata(args: { id: string; email: string; userMetadata: unknown }): UserProfile {
  const metadata =
    args.userMetadata && typeof args.userMetadata === "object"
      ? (args.userMetadata as Record<string, unknown>)
      : {};

  let firstName = toNullableString(metadata.first_name);
  let lastName = toNullableString(metadata.last_name);
  const fullName = toNullableString(metadata.full_name) ?? toNullableString(metadata.name);

  if ((!firstName || !lastName) && fullName) {
    const split = splitDisplayName(fullName);
    if (!firstName) {
      firstName = split.firstName;
    }
    if (!lastName) {
      lastName = split.lastName;
    }
  }

  return {
    id: args.id,
    email: args.email,
    firstName,
    lastName,
    avatarUrl: toNullableString(metadata.avatar_url),
    jobTitle: toNullableString(metadata.job_title) ?? toNullableString(metadata.title),
    timezone: toNullableString(metadata.timezone),
    bio: toNullableString(metadata.bio)
  };
}

function mergeProfileValues(existingProfile: Record<string, unknown> | null, incoming: UserProfile) {
  return {
    firstName:
      incoming.firstName ??
      (typeof existingProfile?.first_name === "string" ? existingProfile.first_name : null),
    lastName:
      incoming.lastName ?? (typeof existingProfile?.last_name === "string" ? existingProfile.last_name : null),
    avatarUrl:
      incoming.avatarUrl ?? (typeof existingProfile?.avatar_url === "string" ? existingProfile.avatar_url : null),
    jobTitle:
      incoming.jobTitle ?? (typeof existingProfile?.job_title === "string" ? existingProfile.job_title : null),
    timezone:
      incoming.timezone ?? (typeof existingProfile?.timezone === "string" ? existingProfile.timezone : null),
    bio: incoming.bio ?? (typeof existingProfile?.bio === "string" ? existingProfile.bio : null)
  };
}

export async function requireUser(request: Request): Promise<AuthenticatedUser> {
  const auth = request.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length) : null;
  if (!token) {
    throw new Error("Missing bearer token");
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user?.email) {
    throw new Error("Invalid auth token");
  }

  if (!isAllowedWorkspaceEmail(data.user.email)) {
    throw new Error("Non-workspace account is not allowed");
  }

  const profileFromSignIn = profileFromMetadata({
    id: data.user.id,
    email: data.user.email,
    userMetadata: data.user.user_metadata
  });

  try {
    await reconcileLegacyProfile(data.user.email, data.user.id);
  } catch {
    // best-effort — don't block login on reconciliation failure
  }

  const existingProfile = await getUserProfileById(data.user.id);
  if (!existingProfile) {
    await createUserProfile(
      profileFromSignIn
    );
  } else {
    const merged = mergeProfileValues(existingProfile as Record<string, unknown>, profileFromSignIn);
    await updateUserProfile({
      id: data.user.id,
      firstName: merged.firstName,
      lastName: merged.lastName,
      avatarUrl: merged.avatarUrl,
      jobTitle: merged.jobTitle,
      timezone: merged.timezone,
      bio: merged.bio
    });
  }

  return {
    id: data.user.id,
    email: data.user.email
  };
}
