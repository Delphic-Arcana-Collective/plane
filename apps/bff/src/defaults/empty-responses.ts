export const EMPTY_NOTIFICATION_COUNT = {
  total_unread_notifications_count: 0,
  mention_unread_notifications_count: 0,
};

export const EMPTY_NOTIFICATION_PAGE = {
  next_cursor: undefined,
  prev_cursor: undefined,
  next_page_results: false,
  prev_page_results: false,
  total_pages: 0,
  extra_stats: undefined,
  count: 0,
  total_count: 0,
  results: [],
  grouped_by: undefined,
  sub_grouped_by: undefined,
};

export const HOME_WIDGETS = [
  { key: "quick_links", name: "Quicklinks", is_enabled: false, sort_order: 1 },
  { key: "recents", name: "Recents", is_enabled: false, sort_order: 2 },
  { key: "my_stickies", name: "Stickies", is_enabled: false, sort_order: 3 },
  { key: "assigned_issues", name: "Assigned", is_enabled: true, sort_order: 4 },
  { key: "created_issues", name: "Created", is_enabled: false, sort_order: 5 },
  { key: "subscribed_issues", name: "Subscribed", is_enabled: false, sort_order: 6 },
];

export const EMPTY_ISSUE_META = {
  sub_issues_count: 0,
  attachment_count: 0,
  link_count: 0,
  is_subscribed: false,
};
