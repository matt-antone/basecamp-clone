"use client";

import Link from "next/link";
import { PageLoadingState } from "@/components/loading-shells";
import { getAvatarProxyUrl } from "@/lib/avatar";
import { authedJsonFetch, fetchAuthSession } from "@/lib/browser-auth";
import { createClientResource } from "@/lib/client-resource";
import { useEffect, useState } from "react";

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

type SettingsBootstrap = {
  token: string | null;
  googleAvatarUrl: string;
  status: string;
  clients: ClientRecord[];
  profile: ProfileForm;
};

const settingsBootstrapResource = createClientResource(loadSettingsBootstrap, () => "settings");

export default function SettingsPage() {
  const [initial, setInitial] = useState<SettingsBootstrap | null>(null);

  useEffect(() => {
    let cancelled = false;

    settingsBootstrapResource.read("settings").then((nextState) => {
      if (!cancelled) {
        setInitial(nextState);
      }
    });

    return () => {
      cancelled = true;
      settingsBootstrapResource.clear();
    };
  }, []);

  if (!initial) {
    return (
      <PageLoadingState
        label="Loading settings"
        message="Getting your profile and workspace preferences ready."
      />
    );
  }

  return <SettingsPageContent initial={initial} />;
}

function profileRecordToForm(data: UserProfileRecord | null): ProfileForm {
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

async function loadSettingsBootstrap(): Promise<SettingsBootstrap> {
  try {
    const session = await fetchAuthSession();
    const accessToken = session.accessToken;
    const googleAvatarUrl = session.googleAvatarUrl;

    if (!accessToken) {
      return {
        token: null,
        googleAvatarUrl,
        status: session.status || "Sign in first, then open settings",
        clients: [],
        profile: EMPTY_PROFILE
      };
    }

    const [clientsData, profileData] = await Promise.all([
      authedJsonFetch({ accessToken, path: "/clients" }),
      authedJsonFetch({ accessToken, path: "/profile" })
    ]);

    return {
      token: clientsData.accessToken,
      googleAvatarUrl,
      status: session.status,
      clients: (clientsData.data?.clients ?? []) as ClientRecord[],
      profile: profileRecordToForm((profileData.data?.profile ?? null) as UserProfileRecord | null)
    };
  } catch (error) {
    return {
      token: null,
      googleAvatarUrl: "",
      status: error instanceof Error ? error.message : "Failed to load",
      clients: [],
      profile: EMPTY_PROFILE
    };
  }
}

function SettingsPageContent({ initial }: { initial: SettingsBootstrap }) {
  const [token, setToken] = useState(initial.token);
  const [googleAvatarUrl] = useState(initial.googleAvatarUrl);
  const [status, setStatus] = useState(initial.status);
  const [tab, setTab] = useState<"clients" | "profile">("clients");

  const [clients, setClients] = useState<ClientRecord[]>(initial.clients);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");

  const [profile, setProfile] = useState<ProfileForm>(initial.profile);
  const [savingProfile, setSavingProfile] = useState(false);
  const displayedAvatarUrl = googleAvatarUrl || profile.avatarUrl;

  async function authedFetch(accessToken: string, path: string, options: RequestInit = {}) {
    const { accessToken: nextToken, data } = await authedJsonFetch({
      accessToken,
      init: options,
      onToken: setToken,
      path
    });
    if (nextToken !== token) {
      setToken(nextToken);
    }
    return data;
  }

  async function loadClients(accessToken: string) {
    const data = await authedFetch(accessToken, "/clients");
    setClients((data?.clients ?? []) as ClientRecord[]);
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
    setProfile(profileToForm((data?.profile ?? null) as UserProfileRecord | null));
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
      setProfile(profileToForm((data?.profile ?? null) as UserProfileRecord | null));
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
            {displayedAvatarUrl ? (
              <img src={getAvatarProxyUrl(displayedAvatarUrl)} alt="Profile avatar" className="profileAvatar" />
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
