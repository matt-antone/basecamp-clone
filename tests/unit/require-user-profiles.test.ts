import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserMock = vi.fn();
const getUserProfileByIdMock = vi.fn();
const createUserProfileMock = vi.fn();
const updateUserProfileMock = vi.fn();

vi.mock("@/lib/supabase-admin", () => ({
  getSupabaseAdmin: vi.fn(() => ({
    auth: {
      getUser: getUserMock
    }
  }))
}));

vi.mock("@/lib/repositories", () => ({
  getUserProfileById: getUserProfileByIdMock,
  createUserProfile: createUserProfileMock,
  updateUserProfile: updateUserProfileMock
}));

beforeEach(() => {
  process.env.WORKSPACE_DOMAIN = "example.com";
  getUserMock.mockReset();
  getUserProfileByIdMock.mockReset();
  createUserProfileMock.mockReset();
  updateUserProfileMock.mockReset();
});

describe("requireUser profile provisioning", () => {
  it("creates profile on first authenticated request when missing", async () => {
    getUserMock.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
          email: "person@example.com",
          user_metadata: {
            first_name: "Person",
            last_name: "Example",
            avatar_url: "https://example.com/avatar.png",
            job_title: "Engineer",
            timezone: "America/Los_Angeles",
            bio: "Builds things"
          }
        }
      },
      error: null
    });
    getUserProfileByIdMock.mockResolvedValue(null);

    const { requireUser } = await import("@/lib/auth");
    const user = await requireUser(
      new Request("http://localhost/test", {
        headers: {
          authorization: "Bearer token-1"
        }
      })
    );

    expect(user).toEqual({ id: "user-1", email: "person@example.com" });
    expect(getUserProfileByIdMock).toHaveBeenCalledWith("user-1");
    expect(createUserProfileMock).toHaveBeenCalledWith({
      id: "user-1",
      email: "person@example.com",
      firstName: "Person",
      lastName: "Example",
      avatarUrl: "https://example.com/avatar.png",
      jobTitle: "Engineer",
      timezone: "America/Los_Angeles",
      bio: "Builds things"
    });
  });

  it("does not create profile when one already exists", async () => {
    getUserMock.mockResolvedValue({
      data: {
        user: {
          id: "user-2",
          email: "person@example.com",
          user_metadata: {}
        }
      },
      error: null
    });
    getUserProfileByIdMock.mockResolvedValue({ id: "user-2" });

    const { requireUser } = await import("@/lib/auth");
    await requireUser(
      new Request("http://localhost/test", {
        headers: {
          authorization: "Bearer token-2"
        }
      })
    );

    expect(getUserProfileByIdMock).toHaveBeenCalledWith("user-2");
    expect(createUserProfileMock).not.toHaveBeenCalled();
    expect(updateUserProfileMock).toHaveBeenCalledWith({
      id: "user-2",
      firstName: null,
      lastName: null,
      avatarUrl: null,
      jobTitle: null,
      timezone: null,
      bio: null
    });
  });

  it("rejects non-workspace users before profile lookups", async () => {
    getUserMock.mockResolvedValue({
      data: {
        user: {
          id: "user-3",
          email: "person@outside.com",
          user_metadata: {}
        }
      },
      error: null
    });

    const { requireUser } = await import("@/lib/auth");

    await expect(
      requireUser(
        new Request("http://localhost/test", {
          headers: {
            authorization: "Bearer token-3"
          }
        })
      )
    ).rejects.toThrow("Non-workspace account is not allowed");

    expect(getUserProfileByIdMock).not.toHaveBeenCalled();
    expect(createUserProfileMock).not.toHaveBeenCalled();
    expect(updateUserProfileMock).not.toHaveBeenCalled();
  });

  it("uses full-name split and title fallback when metadata is partial", async () => {
    getUserMock.mockResolvedValue({
      data: {
        user: {
          id: "user-4",
          email: "person@example.com",
          user_metadata: {
            name: "Jane Doe",
            title: "Product Designer"
          }
        }
      },
      error: null
    });
    getUserProfileByIdMock.mockResolvedValue(null);

    const { requireUser } = await import("@/lib/auth");
    await requireUser(
      new Request("http://localhost/test", {
        headers: {
          authorization: "Bearer token-4"
        }
      })
    );

    expect(createUserProfileMock).toHaveBeenCalledWith({
      id: "user-4",
      email: "person@example.com",
      firstName: "Jane",
      lastName: "Doe",
      avatarUrl: null,
      jobTitle: "Product Designer",
      timezone: null,
      bio: null
    });
    expect(updateUserProfileMock).not.toHaveBeenCalled();
  });

  it("stores google avatar at sign in for existing profiles", async () => {
    getUserMock.mockResolvedValue({
      data: {
        user: {
          id: "user-5",
          email: "person@example.com",
          user_metadata: {
            avatar_url: "https://googleusercontent.com/u5.png"
          }
        }
      },
      error: null
    });
    getUserProfileByIdMock.mockResolvedValue({
      id: "user-5",
      first_name: "Existing",
      last_name: "User",
      avatar_url: null,
      job_title: "PM",
      timezone: "America/Los_Angeles",
      bio: "Hello"
    });

    const { requireUser } = await import("@/lib/auth");
    await requireUser(
      new Request("http://localhost/test", {
        headers: {
          authorization: "Bearer token-5"
        }
      })
    );

    expect(updateUserProfileMock).toHaveBeenCalledWith({
      id: "user-5",
      firstName: "Existing",
      lastName: "User",
      avatarUrl: "https://googleusercontent.com/u5.png",
      jobTitle: "PM",
      timezone: "America/Los_Angeles",
      bio: "Hello"
    });
  });
});
