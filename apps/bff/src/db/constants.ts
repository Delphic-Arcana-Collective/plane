export const DATA_SOURCE_LINEAR = "linear" as const;
export const DATA_SOURCE_PLANE = "plane" as const;
export type DataSource = typeof DATA_SOURCE_LINEAR | typeof DATA_SOURCE_PLANE;

export const TAG_LINEAR = "Linear" as const;
export const TAG_PLANE = "Plane" as const;
export type SystemTag = typeof TAG_LINEAR | typeof TAG_PLANE;

export const SYNC_META_ID = "default";

export function rowId(source: DataSource, externalId: string): string {
  return `${source}:${externalId}`;
}

export function tagForSource(source: DataSource): SystemTag {
  return source === DATA_SOURCE_LINEAR ? TAG_LINEAR : TAG_PLANE;
}

export function isLinearTag(tag: string): boolean {
  return tag === TAG_LINEAR;
}
