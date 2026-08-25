import type { Env } from "../env.js";

/** Stable viewer id used before Linear users are synced into cache. */
export const BFF_VIEWER_USER_ID = "00000000-0000-4000-8000-000000000001";

const BFF_WORKSPACE_ID = "00000000-0000-4000-8000-000000000002";
const BFF_WORKSPACE_MEMBER_ID = "00000000-0000-4000-8000-000000000003";

const EMPTY_VIEW_PROPS = {
  rich_filters: {},
  display_filters: {},
  display_properties: {},
};

function splitName(fullName: string) {
  const [firstName, ...rest] = fullName.split(" ");
  return {
    firstName: firstName ?? "Linear",
    lastName: rest.join(" ") || "Viewer",
  };
}

/** Minimal Plane auth/bootstrap payloads derived from env (used before Linear cache is ready). */
export function createBootstrapContext(env: Env) {
  const workspaceSlug = env.PLANE_WORKSPACE_SLUG;
  const workspaceName = env.PLANE_WORKSPACE_NAME;
  const { firstName, lastName } = splitName(env.MOCK_USER_NAME);

  const viewer = {
    id: BFF_VIEWER_USER_ID,
    avatar_url: "",
    display_name: env.MOCK_USER_NAME,
    email: env.MOCK_USER_EMAIL,
    first_name: firstName,
    last_name: lastName,
    is_bot: false,
    cover_image: null,
    cover_image_url: null,
    date_joined: "2026-01-01T00:00:00.000Z",
    is_active: true,
    is_email_verified: true,
    is_password_autoset: true,
    is_tour_completed: true,
    mobile_number: null,
    last_workspace_id: BFF_WORKSPACE_ID,
    user_timezone: "UTC",
    username: env.MOCK_USER_EMAIL,
    last_login_medium: "email",
    theme: {
      theme: "system",
    },
  };

  const workspace = {
    id: BFF_WORKSPACE_ID,
    owner: viewer,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    name: workspaceName,
    url: workspaceSlug,
    logo_url: null,
    total_members: 1,
    slug: workspaceSlug,
    created_by: BFF_VIEWER_USER_ID,
    updated_by: BFF_VIEWER_USER_ID,
    organization_size: "1-10",
    total_projects: 0,
    role: 20,
    timezone: "UTC",
  };

  return {
    workspaceSlug,
    viewer,
    profile: {
      id: "00000000-0000-4000-8000-000000000010",
      user: BFF_VIEWER_USER_ID,
      role: "Product / Project Manager",
      last_workspace_id: BFF_WORKSPACE_ID,
      theme: { theme: "system" },
      onboarding_step: {
        workspace_join: true,
        profile_complete: true,
        workspace_create: true,
        workspace_invite: true,
      },
      is_onboarded: true,
      is_tour_completed: true,
      use_case: "project_management",
      billing_address_country: null,
      billing_address: null,
      has_billing_address: false,
      has_marketing_email_consent: false,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
    settings: {
      id: "00000000-0000-4000-8000-000000000011",
      email: env.MOCK_USER_EMAIL,
      workspace: {
        last_workspace_id: BFF_WORKSPACE_ID,
        last_workspace_slug: workspaceSlug,
        last_workspace_name: workspaceName,
        last_workspace_logo: null,
        fallback_workspace_id: BFF_WORKSPACE_ID,
        fallback_workspace_slug: workspaceSlug,
        invites: 0,
      },
    },
    workspaceListItem: {
      id: BFF_WORKSPACE_ID,
      name: workspaceName,
      slug: workspaceSlug,
      logo_url: null,
      role: 20,
      total_members: 1,
      total_projects: 0,
    },
    workspace,
    workspaceMemberMe: {
      company_role: null,
      created_at: "2026-01-01T00:00:00.000Z",
      created_by: BFF_VIEWER_USER_ID,
      default_props: EMPTY_VIEW_PROPS,
      id: BFF_WORKSPACE_MEMBER_ID,
      member: BFF_VIEWER_USER_ID,
      role: 20,
      updated_at: "2026-01-01T00:00:00.000Z",
      updated_by: BFF_VIEWER_USER_ID,
      view_props: EMPTY_VIEW_PROPS,
      workspace: BFF_WORKSPACE_ID,
      draft_issue_count: 0,
    },
    instanceInfo: {
      instance: {
        id: "linear-bff-instance",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        instance_name: "Linear Display",
        whitelist_emails: null,
        instance_id: "linear-bff",
        license_key: null,
        current_version: "0.1.0",
        latest_version: "0.1.0",
        last_checked_at: "2026-01-01T00:00:00.000Z",
        namespace: null,
        is_telemetry_enabled: false,
        is_support_required: false,
        is_activated: true,
        is_setup_done: true,
        is_signup_screen_visited: true,
        user_count: 1,
        is_verified: true,
        created_by: BFF_VIEWER_USER_ID,
        updated_by: BFF_VIEWER_USER_ID,
        workspaces_exist: true,
      },
      config: {
        enable_signup: false,
        is_workspace_creation_disabled: true,
        is_google_enabled: false,
        is_github_enabled: false,
        is_gitlab_enabled: false,
        is_gitea_enabled: false,
        is_magic_login_enabled: false,
        is_email_password_enabled: false,
        github_app_name: null,
        slack_client_id: null,
        has_unsplash_configured: false,
        has_llm_configured: false,
        file_size_limit: 5242880,
        is_smtp_configured: false,
        app_base_url: env.WEB_APP_BASE_URL,
        space_base_url: "http://localhost:3002",
        admin_base_url: "http://localhost:3001",
        is_self_managed: true,
      },
    },
    emptyWorkspaceUserProperties: {
      rich_filters: {},
      display_filters: {},
      display_properties: {},
      navigation_project_limit: 10,
      navigation_control_preference: "ACCORDION" as const,
    },
    fallbackMember: {
      id: BFF_WORKSPACE_MEMBER_ID,
      member: {
        id: BFF_VIEWER_USER_ID,
        avatar_url: "",
        display_name: env.MOCK_USER_NAME,
        email: env.MOCK_USER_EMAIL,
        first_name: firstName,
        last_name: lastName,
        is_bot: false,
      },
      role: 20,
      created_at: "2026-01-01T00:00:00.000Z",
      is_active: true,
    },
  };
}
