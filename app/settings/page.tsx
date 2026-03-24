"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

type ClientRecord = {
  id: string;
  name: string;
  code: string;
};

type UserProfileRecord = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  job_title: string | null;
  timezone: string | null;
  bio: string | null;
};

type ProfileForm = {
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl: string;
  jobTitle: string;
  timezone: string;
  bio: string;
};

const EMPTY_PROFILE: ProfileForm = {
  email: "",
  firstName: "",
  lastName: "",
  avatarUrl: "",
  jobTitle: "",
  timezone: "",
  bio: ""
};

export default function SettingsPage() {
  const [supabase, setSupabase] = useState<ReturnType<typeof getSupabaseBrowserClient> | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [googleAvatarUrl, setGoogleAvatarUrl] = useState("");
  const [status, setStatus] = useState("Loading...");
  const [tab, setTab] = useState<"clients" | "profile">("clients");

  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");

  const [profile, setProfile] = useState<ProfileForm>(EMPTY_PROFILE);
  const [savingProfile, setSavingProfile] = useState(false);

  useEffect(() => {
    try {
      setSupabase(getSupabaseBrowserClient());
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Supabase init failed");
    }
  }, []);

  useEffect(() => {
    if (!supabase) return;
    const bootstrap = async () => {
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token ?? null;
      const metadata =
        data.session?.user?.user_metadata && typeof data.session.user.user_metadata === "object"
          ? (data.session.user.user_metadata as Record<string, unknown>)
          : {};
      const googleAvatar = typeof metadata.avatar_url === "string" ? metadata.avatar_url : "";
      setToken(accessToken);
      setGoogleAvatarUrl(googleAvatar);
      if (!accessToken) {
        setStatus("Sign in first, then open settings");
        return;
      }
      setStatus("Ready");
      await Promise.all([loadClients(accessToken), loadProfile(accessToken)]);
    };

    bootstrap().catch((error) => setStatus(error instanceof Error ? error.message : "Failed to load"));
  }, [supabase]);

  async function authedFetch(accessToken: string, path: string, options: RequestInit = {}) {
    const response = await fetch(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        ...(options.headers ?? {})
      }
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error ?? "Request failed");
    }
    return data;
  }

  async function loadClients(accessToken: string) {
    const data = await authedFetch(accessToken, "/clients");
    setClients(data.clients ?? []);
  }

  function profileToForm(data: UserProfileRecord | null): ProfileForm {
    if (!data) {
      return EMPTY_PROFILE;
    }

    return {
      email: data.email ?? "",
      firstName: data.first_name ?? "",
      lastName: data.last_name ?? "",
      avatarUrl: data.avatar_url ?? "",
      jobTitle: data.job_title ?? "",
      timezone: data.timezone ?? "",
      bio: data.bio ?? ""
    };
  }

  async function loadProfile(accessToken: string) {
    const data = await authedFetch(accessToken, "/profile");
    setProfile(profileToForm((data.profile ?? null) as UserProfileRecord | null));
  }

  async function createClient() {
    if (!token) return;
    await authedFetch(token, "/clients", {
      method: "POST",
      body: JSON.stringify({ name, code })
    });
    setName("");
    setCode("");
    await loadClients(token);
  }

  async function saveProfile() {
    if (!token) return;
    setSavingProfile(true);
    try {
      const data = await authedFetch(token, "/profile", {
        method: "PATCH",
        body: JSON.stringify({
          firstName: profile.firstName,
          lastName: profile.lastName,
          avatarUrl: profile.avatarUrl,
          jobTitle: profile.jobTitle,
          timezone: profile.timezone,
          bio: profile.bio
        })
      });
      setProfile(profileToForm((data.profile ?? null) as UserProfileRecord | null));
      setStatus("Profile updated");
    } finally {
      setSavingProfile(false);
    }
  }

  return (
    <main className="page">
      <header className="header">
        <h1>Settings</h1>
        <Link href="/" className="linkButton">
          Back to Workspace
        </Link>
      </header>

      <p className="status">{status}</p>

      <div className="tabsRow">
        <button className={tab === "clients" ? "tabButton activeTab" : "tabButton"} onClick={() => setTab("clients")}>
          Client List
        </button>
        <button className={tab === "profile" ? "tabButton activeTab" : "tabButton"} onClick={() => setTab("profile")}>
          Profile
        </button>
      </div>

      {tab === "clients" && (
        <section className="stackSection">
          <h2>Clients</h2>
          <p>Each project must choose a client. Project labels are generated as: CLIENTCODE-0001-Title.</p>
          <div className="form">
            <input placeholder="Client name" value={name} onChange={(e) => setName(e.target.value)} />
            <input
              placeholder="Client code (e.g. ACME)"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
            <button onClick={() => createClient().catch((error) => setStatus(error.message))} disabled={!name || !code}>
              Add Client
            </button>
          </div>

          <ul>
            {clients.map((client) => (
              <li key={client.id}>
                <strong>{client.code}</strong>
                <span>{client.name}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === "profile" && (
        <section className="stackSection">
          <h2 className="profileTitle">
            {googleAvatarUrl || profile.avatarUrl ? (
              <img src={googleAvatarUrl || profile.avatarUrl} alt="Profile avatar" className="profileAvatar" />
            ) : (
              <span className="profileAvatarFallback">{(profile.firstName || profile.email || "U").charAt(0).toUpperCase()}</span>
            )}
            <span>My Profile</span>
          </h2>
          <p>Set the details shown to teammates across the workspace.</p>

          <div className="form">
            <label>
              Email
              <input value={profile.email} readOnly />
            </label>

            <label>
              First name
              <input
                value={profile.firstName}
                onChange={(e) => setProfile((prev) => ({ ...prev, firstName: e.target.value }))}
                placeholder="First name"
              />
            </label>

            <label>
              Last name
              <input
                value={profile.lastName}
                onChange={(e) => setProfile((prev) => ({ ...prev, lastName: e.target.value }))}
                placeholder="Last name"
              />
            </label>

            <label>
              Job title
              <input
                value={profile.jobTitle}
                onChange={(e) => setProfile((prev) => ({ ...prev, jobTitle: e.target.value }))}
                placeholder="Product Designer"
              />
            </label>

            <label>
              Timezone
              <input
                value={profile.timezone}
                onChange={(e) => setProfile((prev) => ({ ...prev, timezone: e.target.value }))}
                placeholder="America/Los_Angeles"
              />
            </label>

            <label>
              Bio
              <textarea
                value={profile.bio}
                onChange={(e) => setProfile((prev) => ({ ...prev, bio: e.target.value }))}
                placeholder="A short bio"
              />
            </label>

            <button onClick={() => saveProfile().catch((error) => setStatus(error.message))} disabled={savingProfile}>
              {savingProfile ? "Saving..." : "Save Profile"}
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
