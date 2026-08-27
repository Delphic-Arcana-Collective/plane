import type { IProjectUserPropertiesResponse } from "@plane/types";

export const DEFAULT_PROJECT_DISPLAY_FILTERS = {
  layout: "list",
  order_by: "sort_order",
  group_by: "state",
  sub_group_by: null,
  sub_issue: false,
  show_empty_groups: false,
  calendar: {
    show_weekends: false,
    layout: "month",
  },
} as const;

export const EMPTY_PROJECT_USER_PROPERTIES: IProjectUserPropertiesResponse = {
  rich_filters: {},
  display_filters: { ...DEFAULT_PROJECT_DISPLAY_FILTERS },
  display_properties: {},
  sort_order: 0,
  preferences: {
    pages: {
      block_display: false,
    },
    navigation: {
      default_tab: "work_items",
      hide_in_more_menu: [],
    },
  },
};

const store = new Map<string, IProjectUserPropertiesResponse>();

function cloneDefaults(): IProjectUserPropertiesResponse {
  return JSON.parse(JSON.stringify(EMPTY_PROJECT_USER_PROPERTIES)) as IProjectUserPropertiesResponse;
}

function withDisplayFilterDefaults(
  displayFilters: IProjectUserPropertiesResponse["display_filters"] | undefined
): IProjectUserPropertiesResponse["display_filters"] {
  return {
    ...DEFAULT_PROJECT_DISPLAY_FILTERS,
    ...displayFilters,
    calendar: {
      ...DEFAULT_PROJECT_DISPLAY_FILTERS.calendar,
      ...displayFilters?.calendar,
    },
    group_by:
      displayFilters && "group_by" in displayFilters
        ? displayFilters.group_by
        : DEFAULT_PROJECT_DISPLAY_FILTERS.group_by,
  };
}

export function getProjectUserProperties(projectId: string): IProjectUserPropertiesResponse {
  const current = store.get(projectId) ?? cloneDefaults();
  return {
    ...current,
    display_filters: withDisplayFilterDefaults(current.display_filters),
  };
}

export function updateProjectUserProperties(
  projectId: string,
  patch: Partial<IProjectUserPropertiesResponse>
): IProjectUserPropertiesResponse {
  const current = getProjectUserProperties(projectId);
  const next: IProjectUserPropertiesResponse = {
    ...current,
    ...patch,
    rich_filters: patch.rich_filters ?? current.rich_filters,
    display_filters: {
      ...current.display_filters,
      ...patch.display_filters,
    },
    display_properties: {
      ...current.display_properties,
      ...patch.display_properties,
    },
    preferences: {
      ...current.preferences,
      ...patch.preferences,
      pages: {
        ...current.preferences.pages,
        ...patch.preferences?.pages,
      },
      navigation: {
        ...current.preferences.navigation,
        ...patch.preferences?.navigation,
      },
    },
  };
  store.set(projectId, next);
  return next;
}

export function resetProjectUserProperties() {
  store.clear();
}
