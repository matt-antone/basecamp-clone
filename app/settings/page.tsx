"use client";

import Link from "next/link";
import { PageLoadingState } from "@/components/loading-shells";
import { OneShotButton } from "@/components/one-shot-button";
import { getAvatarProxyUrl } from "@/lib/avatar";
import { authedJsonFetch, fetchAuthSession } from "@/lib/browser-auth";
import { createClientResource } from "@/lib/client-resource";
import { DEFAULT_HOURLY_RATE_USD, formatUsdInput } from "@/lib/project-financials";
import {
  DEFAULT_SITE_LOGO_URL,
  DEFAULT_SITE_TITLE,
  normalizeSiteLogoUrl,
  normalizeSiteTitle
} from "@/lib/site-branding";
import { useEffect, useRef, useState } from "react";

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
type SiteSettingsForm = {
  siteTitle: string;
  logoUrl: string;
  defaultHourlyRateUsd: string;
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
  siteSettings: SiteSettingsForm;
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
    const siteSettings = await loadSiteSettings();

    if (!accessToken) {
      return {
        token: null,
        googleAvatarUrl,
        status: session.status || "Sign in first, then open settings",
        clients: [],
        profile: EMPTY_PROFILE,
        siteSettings
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
      profile: profileRecordToForm((profileData.data?.profile ?? null) as UserProfileRecord | null),
      siteSettings
    };
  } catch (error) {
    return {
      token: null,
      googleAvatarUrl: "",
      status: error instanceof Error ? error.message : "Failed to load",
      clients: [],
      profile: EMPTY_PROFILE,
      siteSettings: {
        siteTitle: DEFAULT_SITE_TITLE,
          logoUrl: DEFAULT_SITE_LOGO_URL,
          defaultHourlyRateUsd: formatUsdInput(DEFAULT_HOURLY_RATE_USD)
      }
    };
  }
}

async function loadSiteSettings(): Promise<SiteSettingsForm> {
  try {
    const response = await fetch("/site-settings", {
      cache: "no-store",
      credentials: "same-origin"
    });
    if (!response.ok) {
      return {
        siteTitle: DEFAULT_SITE_TITLE,
          logoUrl: DEFAULT_SITE_LOGO_URL,
          defaultHourlyRateUsd: formatUsdInput(DEFAULT_HOURLY_RATE_USD)
      };
    }

    const payload = (await response.json().catch(() => null)) as
      | {
        siteSettings?: {
          siteTitle?: string | null;
          logoUrl?: string | null;
          defaultHourlyRateUsd?: number | string | null;
          site_title?: string | null;
          logo_url?: string | null;
        };
      }
      | null;
    const source = payload?.siteSettings ?? null;
    const rawTitle = source?.siteTitle ?? source?.site_title ?? null;
    const rawLogo = source?.logoUrl ?? source?.logo_url ?? null;
    const rawHourlyRate = source?.defaultHourlyRateUsd ?? DEFAULT_HOURLY_RATE_USD;

    return {
      siteTitle: normalizeSiteTitle(rawTitle),
      logoUrl: normalizeSiteLogoUrl(rawLogo),
      defaultHourlyRateUsd: formatUsdInput(rawHourlyRate)
    };
  } catch {
    return {
      siteTitle: DEFAULT_SITE_TITLE,
      logoUrl: DEFAULT_SITE_LOGO_URL,
      defaultHourlyRateUsd: formatUsdInput(DEFAULT_HOURLY_RATE_USD)
    };
  }
}

function SettingsPageContent({ initial }: { initial: SettingsBootstrap }) {
  const [token, setToken] = useState(initial.token);
  const [googleAvatarUrl] = useState(initial.googleAvatarUrl);
  const [status, setStatus] = useState(initial.status);
  const [tab, setTab] = useState<"clients" | "profile" | "site">("clients");

  const [clients, setClients] = useState<ClientRecord[]>(initial.clients);
  const clientDialogRef = useRef<HTMLDialogElement>(null);
  const [clientEditingId, setClientEditingId] = useState<string | null>(null);
  const [clientDialogName, setClientDialogName] = useState("");
  const [clientDialogCode, setClientDialogCode] = useState("");
  const [clientDialogSaving, setClientDialogSaving] = useState(false);
  const [clientDialogError, setClientDialogError] = useState<string | undefined>();

  const [profile, setProfile] = useState<ProfileForm>(initial.profile);
  const [siteSettings, setSiteSettings] = useState<SiteSettingsForm>(initial.siteSettings);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingSiteSettings, setSavingSiteSettings] = useState(false);
  const displayedAvatarUrl = googleAvatarUrl || profile.avatarUrl;
  const trimmedClientName = clientDialogName.trim();
  const trimmedClientCode = clientDialogCode.trim().toUpperCase();
  const isClientEdit = clientEditingId !== null;
  const clientBeingEdited = isClientEdit ? clients.find((client) => client.id === clientEditingId) ?? null : null;
  const hasClientNameChanged = clientBeingEdited ? clientBeingEdited.name !== trimmedClientName : true;
  const clientDialogSubmitDisabled =
    clientDialogSaving ||
    !trimmedClientName ||
    (!isClientEdit && !trimmedClientCode) ||
    (isClientEdit && !hasClientNameChanged);

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

  function openCreateClientDialog() {
    setClientEditingId(null);
    setClientDialogName("");
    setClientDialogCode("");
    setClientDialogError(undefined);
    clientDialogRef.current?.showModal();
  }

  function openEditClientDialog(client: ClientRecord) {
    setClientEditingId(client.id);
    setClientDialogName(client.name);
    setClientDialogCode(client.code);
    setClientDialogError(undefined);
    clientDialogRef.current?.showModal();
  }

  function closeClientDialog() {
    clientDialogRef.current?.close();
    setClientDialogError(undefined);
  }

  async function submitClientDialog() {
    if (!token) return;
    if (!trimmedClientName) {
      setClientDialogError("Client name is required.");
      return;
    }
    if (!isClientEdit && !trimmedClientCode) {
      setClientDialogError("Client code is required.");
      return;
    }
    if (isClientEdit && !hasClientNameChanged) {
      closeClientDialog();
      return;
    }

    setClientDialogSaving(true);
    setClientDialogError(undefined);
    try {
      if (isClientEdit) {
        await authedFetch(token, `/clients/${clientEditingId}`, {
          method: "PATCH",
          body: JSON.stringify({ name: trimmedClientName })
        });
        setStatus("Client updated");
      } else {
        await authedFetch(token, "/clients", {
          method: "POST",
          body: JSON.stringify({ name: trimmedClientName, code: trimmedClientCode })
        });
        setStatus("Client added");
      }
      closeClientDialog();
      await loadClients(token);
    } catch (error) {
      setClientDialogError(error instanceof Error ? error.message : "Request failed");
    } finally {
      setClientDialogSaving(false);
    }
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

  async function saveSiteSettings() {
    if (!token) return;
    setSavingSiteSettings(true);
    try {
      const nextSiteTitle = siteSettings.siteTitle.trim() || null;
      const nextLogoUrl = siteSettings.logoUrl.trim() || null;
      const trimmedHourlyRate = siteSettings.defaultHourlyRateUsd.trim();
      const parsedHourlyRate = trimmedHourlyRate ? Number(trimmedHourlyRate) : Number.NaN;
      if (trimmedHourlyRate && (!Number.isFinite(parsedHourlyRate) || parsedHourlyRate < 0 || parsedHourlyRate > 999999.99)) {
        throw new Error("Default hourly rate must be between 0 and 999999.99");
      }
      const data = await authedFetch(token, "/site-settings", {
        method: "PATCH",
        body: JSON.stringify({
          siteTitle: nextSiteTitle,
          logoUrl: nextLogoUrl,
          defaultHourlyRateUsd: trimmedHourlyRate ? parsedHourlyRate : DEFAULT_HOURLY_RATE_USD
        })
      });

      const payload = (data?.siteSettings ?? null) as {
        siteTitle?: string | null;
        logoUrl?: string | null;
        defaultHourlyRateUsd?: number | string | null;
        site_title?: string | null;
        logo_url?: string | null;
      } | null;
      const rawTitle = payload?.siteTitle ?? payload?.site_title ?? null;
      const rawLogo = payload?.logoUrl ?? payload?.logo_url ?? null;
      const rawHourlyRate = payload?.defaultHourlyRateUsd ?? DEFAULT_HOURLY_RATE_USD;
      setSiteSettings({
        siteTitle: normalizeSiteTitle(rawTitle),
        logoUrl: normalizeSiteLogoUrl(rawLogo),
        defaultHourlyRateUsd: formatUsdInput(rawHourlyRate)
      });
      setStatus("Site settings updated");
    } finally {
      setSavingSiteSettings(false);
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
        <OneShotButton className={tab === "clients" ? "tabButton activeTab" : "tabButton"} onClick={() => setTab("clients")}>
          Client List
        </OneShotButton>
        <OneShotButton className={tab === "profile" ? "tabButton activeTab" : "tabButton"} onClick={() => setTab("profile")}>
          Profile
        </OneShotButton>
        <OneShotButton className={tab === "site" ? "tabButton activeTab" : "tabButton"} onClick={() => setTab("site")}>
          Site
        </OneShotButton>
      </div>

      {tab === "clients" && (
        <section className="stackSection">
          <h2>Clients</h2>
          <p>Each project must choose a client. Project labels are generated as: CLIENTCODE-0001-Title.</p>
          <div className="form">
            <OneShotButton type="button" onClick={openCreateClientDialog} disabled={!token}>
              Add client
            </OneShotButton>
          </div>

          {clients.length === 0 ? (
            <p className="status">No clients yet. Add your first client to start assigning projects.</p>
          ) : (
            <ul className="settingsClientList">
              {clients.map((client) => (
                <li key={client.id} className="settingsClientRow">
                  <div className="settingsClientRowMain">
                    <strong>{client.code}</strong>
                    <span>{client.name}</span>
                  </div>
                  <OneShotButton
                    type="button"
                    className="secondary"
                    onClick={() => openEditClientDialog(client)}
                    disabled={!token}
                    aria-label={`Edit ${client.name}`}
                  >
                    Edit
                  </OneShotButton>
                </li>
              ))}
            </ul>
          )}
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

            <OneShotButton onClick={() => saveProfile().catch((error) => setStatus(error.message))} disabled={savingProfile}>
              {savingProfile ? "Saving..." : "Save Profile"}
            </OneShotButton>
          </div>
        </section>
      )}

      <dialog
        ref={clientDialogRef}
        className="dialog"
        aria-labelledby="client-dialog-title"
        aria-describedby={isClientEdit ? "client-code-immutable-note" : undefined}
        onClose={() => {
          setClientDialogError(undefined);
          setClientEditingId(null);
        }}
      >
        <form
          className="dialogForm"
          onSubmit={(event) => {
            event.preventDefault();
            submitClientDialog();
          }}
        >
          <h3 id="client-dialog-title">{clientEditingId ? "Edit client" : "Add client"}</h3>
          <div className="form">
            <label className="dialogField">
              <span>Name</span>
              <input
                value={clientDialogName}
                onChange={(e) => setClientDialogName(e.target.value)}
                placeholder="Client name"
                disabled={clientDialogSaving}
                maxLength={120}
                autoFocus
              />
            </label>
            <label className="dialogField">
              <span>Code</span>
              <input
                value={clientDialogCode}
                onChange={(e) => setClientDialogCode(e.target.value.toUpperCase())}
                placeholder="e.g. ACME"
                disabled={clientDialogSaving || clientEditingId !== null}
                maxLength={16}
                autoCapitalize="characters"
                spellCheck={false}
              />
            </label>
            {clientEditingId ? (
              <p id="client-code-immutable-note" className="dialogFieldHint">
                Code can’t be changed after the client is created.
              </p>
            ) : null}
            {clientDialogError ? (
              <p className="status settingsDialogError" role="alert" aria-live="polite">
                {clientDialogError}
              </p>
            ) : null}
          </div>
          <div className="row">
            <OneShotButton type="submit" disabled={clientDialogSubmitDisabled}>
              {clientDialogSaving ? "Saving…" : clientEditingId ? "Save changes" : "Add client"}
            </OneShotButton>
            <OneShotButton type="button" className="secondary" onClick={closeClientDialog} disabled={clientDialogSaving}>
              Cancel
            </OneShotButton>
          </div>
        </form>
      </dialog>

      {tab === "site" && (
        <section className="stackSection">
          <h2>Site Branding</h2>
          <p>Set a workspace-wide title and logo used in the top navigation.</p>

          <div className="form">
            <label>
              Site title
              <input
                value={siteSettings.siteTitle}
                onChange={(e) => setSiteSettings((prev) => ({ ...prev, siteTitle: e.target.value }))}
                placeholder={DEFAULT_SITE_TITLE}
              />
            </label>

            <label>
              Logo URL or path
              <input
                value={siteSettings.logoUrl}
                onChange={(e) => setSiteSettings((prev) => ({ ...prev, logoUrl: e.target.value }))}
                placeholder={DEFAULT_SITE_LOGO_URL}
              />
            </label>

            <label>
              Default hourly rate (USD)
              <input
                type="number"
                min="0"
                max="999999.99"
                step="0.01"
                inputMode="decimal"
                value={siteSettings.defaultHourlyRateUsd}
                onChange={(e) => setSiteSettings((prev) => ({ ...prev, defaultHourlyRateUsd: e.target.value }))}
                placeholder={formatUsdInput(DEFAULT_HOURLY_RATE_USD)}
              />
            </label>

            <p className="siteBrandPreviewLabel">Preview</p>
            <div className="siteBrandPreview" aria-label="Site branding preview">
              <img
                src={siteSettings.logoUrl.trim() || DEFAULT_SITE_LOGO_URL}
                alt={`${siteSettings.siteTitle.trim() || DEFAULT_SITE_TITLE} logo preview`}
                className="siteBrandPreviewLogo"
              />
              <span className="siteBrandPreviewTitle">{siteSettings.siteTitle.trim() || DEFAULT_SITE_TITLE}</span>
            </div>

            <OneShotButton onClick={() => saveSiteSettings().catch((error) => setStatus(error.message))} disabled={savingSiteSettings || !token}>
              {savingSiteSettings ? "Saving..." : "Save Site Settings"}
            </OneShotButton>
          </div>
        </section>
      )}
    </main>
  );
}
