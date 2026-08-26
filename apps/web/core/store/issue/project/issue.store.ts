/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { action, computed, makeObservable, observable, runInAction } from "mobx";
import { cloneDeep } from "lodash-es";
import { ALL_ISSUES } from "@plane/constants";
// types
import type {
  TIssue,
  TLoader,
  ViewFlags,
  IssuePaginationOptions,
  TIssuesResponse,
  TBulkOperationsPayload,
  TGroupedIssues,
  TSubGroupedIssues,
  TGroupedIssueCount,
  TIssuePaginationData,
  GroupByColumnTypes,
} from "@plane/types";
import { EIssueLayoutTypes } from "@plane/types";
// base class
import type { IBaseIssuesStore } from "../helpers/base-issues.store";
import { BaseIssuesStore } from "../helpers/base-issues.store";
// services
import type { IIssueRootStore } from "../root.store";
import type { IProjectIssuesFilter } from "./filter.store";
import {
  isLinearReadOnly,
  LINEAR_READ_ONLY_VIEW_FLAGS,
  hasLinearGroupedIssueData,
  groupLinearIssuesFromFlatList,
} from "@/helpers/linear-display.helper";

/** Immutable backend payload for a project — survives navigation until page refresh or explicit refetch. */
type TLinearProjectSnapshot = {
  groupedIssueIds: TGroupedIssues;
  groupedIssueCount: TGroupedIssueCount;
  issuePaginationData: TIssuePaginationData;
  paginationOptions: IssuePaginationOptions | undefined;
  issues: TIssue[];
};

type TLinearInflightFetch = {
  projectId: string;
  promise: Promise<TIssuesResponse | undefined>;
};

export interface IProjectIssues extends IBaseIssuesStore {
  viewFlags: ViewFlags;
  // action
  fetchIssues: (
    workspaceSlug: string,
    projectId: string,
    loadType: TLoader,
    option: IssuePaginationOptions
  ) => Promise<TIssuesResponse | undefined>;
  fetchIssuesWithExistingPagination: (
    workspaceSlug: string,
    projectId: string,
    loadType: TLoader
  ) => Promise<TIssuesResponse | undefined>;
  fetchNextIssues: (
    workspaceSlug: string,
    projectId: string,
    groupId?: string,
    subGroupId?: string
  ) => Promise<TIssuesResponse | undefined>;

  createIssue: (workspaceSlug: string, projectId: string, data: Partial<TIssue>) => Promise<TIssue>;
  updateIssue: (workspaceSlug: string, projectId: string, issueId: string, data: Partial<TIssue>) => Promise<void>;
  archiveIssue: (workspaceSlug: string, projectId: string, issueId: string) => Promise<void>;
  quickAddIssue: (workspaceSlug: string, projectId: string, data: TIssue) => Promise<TIssue | undefined>;
  removeBulkIssues: (workspaceSlug: string, projectId: string, issueIds: string[]) => Promise<void>;
  archiveBulkIssues: (workspaceSlug: string, projectId: string, issueIds: string[]) => Promise<void>;
  bulkUpdateProperties: (workspaceSlug: string, projectId: string, data: TBulkOperationsPayload) => Promise<void>;
  isProjectDataReady: (projectId: string) => boolean;
  snapshotBeforeLinearNavigation: (projectId: string) => void;
}

export class ProjectIssues extends BaseIssuesStore implements IProjectIssues {
  router;

  issueFilterStore: IProjectIssuesFilter;

  /** Route project the UI is showing. */
  activeProjectId: string | null = null;
  /** Which project's snapshot is currently mounted into groupedIssueIds. */
  mountedSnapshotProjectId: string | null = null;

  /** Session-scoped backend snapshots — keyed by projectId, untouched by navigation. */
  private linearProjectSnapshots = new Map<string, TLinearProjectSnapshot>();
  private linearInflightFetch: TLinearInflightFetch | null = null;

  isProjectDataReady = (projectId: string): boolean => {
    if (!isLinearReadOnly()) return false;
    if (this.activeProjectId !== projectId || this.mountedSnapshotProjectId !== projectId) {
      return false;
    }

    const snapshot = this.linearProjectSnapshots.get(projectId);
    if (!snapshot || !this.isValidSnapshotRecord(snapshot, projectId)) return false;

    const groupedIssueIds = this.groupedIssueIds;
    if (!groupedIssueIds) return false;

    const flatIds = groupedIssueIds[ALL_ISSUES];
    if (!Array.isArray(flatIds) || flatIds.length === 0) return false;

    if (!flatIds.every((issueId) => this.rootIssueStore.issues.getIssueById(issueId))) {
      return false;
    }

    const displayFilters = this.issueFilterStore?.getIssueFilters(projectId)?.displayFilters;
    return hasLinearGroupedIssueData(
      groupedIssueIds as TGroupedIssues,
      displayFilters?.layout,
      displayFilters?.group_by as GroupByColumnTypes | null
    );
  };

  /** Validate snapshot payload itself — do not depend on issueMap hydration. */
  private isValidSnapshotRecord(snapshot: TLinearProjectSnapshot, projectId: string): boolean {
    const flatIds = snapshot.groupedIssueIds[ALL_ISSUES];
    if (!Array.isArray(flatIds) || flatIds.length === 0) return false;

    const count = snapshot.groupedIssueCount[ALL_ISSUES];
    if (typeof count === "number" && flatIds.length !== count) return false;

    const issuesById = new Map(snapshot.issues.map((issue) => [issue.id, issue]));
    if (!flatIds.every((issueId) => issuesById.get(issueId)?.project_id === projectId)) {
      return false;
    }

    const displayFilters = this.issueFilterStore?.getIssueFilters(projectId)?.displayFilters;
    return hasLinearGroupedIssueData(
      snapshot.groupedIssueIds,
      displayFilters?.layout,
      displayFilters?.group_by as GroupByColumnTypes | null
    );
  }

  private normalizeLinearProjectGroupedIssueIds(groupedIssueIds: TGroupedIssues | TSubGroupedIssues): TGroupedIssues {
    const flatIds = groupedIssueIds[ALL_ISSUES];
    if (Array.isArray(flatIds) && flatIds.length > 0) {
      return groupedIssueIds as TGroupedIssues;
    }

    const mergedIds = Object.entries(groupedIssueIds)
      .filter(([key]) => key !== ALL_ISSUES)
      .flatMap(([, bucket]) => (Array.isArray(bucket) ? bucket : []));

    if (mergedIds.length === 0) return groupedIssueIds as TGroupedIssues;

    return {
      ...(groupedIssueIds as TGroupedIssues),
      [ALL_ISSUES]: [...new Set(mergedIds)],
    };
  }

  private isValidSnapshotPayload(
    projectId: string,
    groupedIssueIds: TGroupedIssues,
    groupedIssueCount: TGroupedIssueCount,
    issueList: TIssue[]
  ): boolean {
    const flatIds = groupedIssueIds[ALL_ISSUES];
    if (!Array.isArray(flatIds) || flatIds.length === 0) return false;

    const count = groupedIssueCount[ALL_ISSUES];
    if (typeof count === "number" && flatIds.length !== count) return false;

    if (!issueList.every((issue) => issue.project_id === projectId)) return false;

    const displayFilters = this.issueFilterStore?.getIssueFilters(projectId)?.displayFilters;
    return hasLinearGroupedIssueData(
      groupedIssueIds,
      displayFilters?.layout,
      displayFilters?.group_by as GroupByColumnTypes | null
    );
  }

  private createSnapshotFromFetch(
    projectId: string,
    response: TIssuesResponse,
    options: IssuePaginationOptions,
    groupedIssueIds: TGroupedIssues,
    groupedIssueCount: TGroupedIssueCount,
    issueList: TIssue[]
  ): TLinearProjectSnapshot {
    runInAction(() => {
      this.groupedIssueIds = groupedIssueIds;
      this.groupedIssueCount = groupedIssueCount;
    });
    this.storePreviousPaginationValues(response, options);

    return this.finalizeLinearSnapshot({
      groupedIssueIds: cloneDeep(groupedIssueIds),
      groupedIssueCount: cloneDeep(groupedIssueCount),
      issuePaginationData: cloneDeep(this.issuePaginationData),
      paginationOptions: this.paginationOptions ? { ...this.paginationOptions } : undefined,
      issues: cloneDeep(issueList),
    });
  }

  private remountActiveSnapshot() {
    const projectId = this.activeProjectId;
    if (!projectId) return;

    const snapshot = this.linearProjectSnapshots.get(projectId);
    if (snapshot) {
      this.mountSnapshot(projectId, snapshot);
    }
  }

  private saveSnapshot(projectId: string, snapshot: TLinearProjectSnapshot) {
    this.linearProjectSnapshots.set(projectId, snapshot);
  }

  private buildLinearDisplayCounts(groupedIssueIds: TGroupedIssues): TGroupedIssueCount {
    const counts: TGroupedIssueCount = {};
    const flatIds = groupedIssueIds[ALL_ISSUES];
    if (Array.isArray(flatIds)) {
      counts[ALL_ISSUES] = flatIds.length;
    }
    for (const [key, bucket] of Object.entries(groupedIssueIds)) {
      if (key === ALL_ISSUES || !Array.isArray(bucket)) continue;
      counts[key] = bucket.length;
    }
    return counts;
  }

  private finalizeLinearSnapshot(snapshot: TLinearProjectSnapshot): TLinearProjectSnapshot {
    const groupedIssueIds = cloneDeep(snapshot.groupedIssueIds);
    return {
      ...snapshot,
      groupedIssueIds,
      groupedIssueCount: this.buildLinearDisplayCounts(groupedIssueIds),
      issuePaginationData: {},
    };
  }

  private mountSnapshot(projectId: string, snapshot: TLinearProjectSnapshot) {
    const finalized = this.finalizeLinearSnapshot(snapshot);
    const displayFilters = this.issueFilterStore?.getIssueFilters(projectId)?.displayFilters;
    const groupBy = (displayFilters?.group_by ?? "state") as GroupByColumnTypes;
    const layout = displayFilters?.layout;
    const issueMapFromSnapshot = Object.fromEntries(finalized.issues.map((issue) => [issue.id, issue]));

    let groupedIssueIds = cloneDeep(finalized.groupedIssueIds);
    if (
      groupBy &&
      (layout === EIssueLayoutTypes.KANBAN || layout === EIssueLayoutTypes.LIST) &&
      Array.isArray(groupedIssueIds[ALL_ISSUES])
    ) {
      groupedIssueIds = groupLinearIssuesFromFlatList(groupedIssueIds, issueMapFromSnapshot, groupBy);
    }

    runInAction(() => {
      this.rootIssueStore.issues.addIssue(finalized.issues);
      this.groupedIssueIds = groupedIssueIds;
      this.groupedIssueCount = this.buildLinearDisplayCounts(groupedIssueIds);
      this.issuePaginationData = {};
      this.paginationOptions = finalized.paginationOptions ? { ...finalized.paginationOptions } : undefined;
      this.mountedSnapshotProjectId = projectId;
      this.setLoader(undefined);
    });
  }

  private activateProject = (projectId: string) => {
    this.activeProjectId = projectId;

    const snapshot = this.linearProjectSnapshots.get(projectId);
    if (snapshot && this.isValidSnapshotRecord(snapshot, projectId)) {
      this.mountSnapshot(projectId, snapshot);
      return;
    }

    runInAction(() => {
      this.mountedSnapshotProjectId = null;
      this.groupedIssueIds = undefined;
      this.groupedIssueCount = {};
      this.issuePaginationData = {};
      this.setLoader("init-loader");
    });
  };

  /** Leaving project view — only clears the active pointer; snapshots stay in memory. */
  snapshotBeforeLinearNavigation = (_projectId: string) => {
    if (!isLinearReadOnly()) return;
    runInAction(() => {
      this.activeProjectId = null;
      this.mountedSnapshotProjectId = null;
    });
  };

  get viewFlags(): ViewFlags {
    if (isLinearReadOnly()) {
      return LINEAR_READ_ONLY_VIEW_FLAGS;
    }

    return {
      enableQuickAdd: true,
      enableIssueCreation: true,
      enableInlineEditing: true,
    };
  }

  constructor(_rootStore: IIssueRootStore, issueFilterStore: IProjectIssuesFilter) {
    super(_rootStore, issueFilterStore);
    makeObservable(this, {
      viewFlags: computed,
      activeProjectId: observable,
      mountedSnapshotProjectId: observable,
      fetchIssues: action,
      fetchNextIssues: action,
      fetchIssuesWithExistingPagination: action,
      snapshotBeforeLinearNavigation: action,
      quickAddIssue: action,
    });
    this.issueFilterStore = issueFilterStore;
    this.router = _rootStore.rootStore.router;
  }

  fetchParentStats = async (workspaceSlug: string, projectId?: string) => {
    if (projectId) {
      await this.rootIssueStore.rootStore.projectRoot.project.fetchProjectDetails(workspaceSlug, projectId);
    }
  };

  updateParentStats = () => {};

  fetchIssues = async (
    workspaceSlug: string,
    projectId: string,
    loadType: TLoader = "init-loader",
    options: IssuePaginationOptions,
    isExistingPaginationOptions: boolean = false
  ) => {
    if (!isLinearReadOnly()) {
      return this.runLegacyFetchIssues(workspaceSlug, projectId, loadType, options, isExistingPaginationOptions);
    }

    if (!isExistingPaginationOptions) {
      this.activateProject(projectId);
    }

    if (this.linearProjectSnapshots.has(projectId)) {
      const snapshot = this.linearProjectSnapshots.get(projectId)!;
      if (this.activeProjectId === projectId && this.isValidSnapshotRecord(snapshot, projectId)) {
        this.mountSnapshot(projectId, snapshot);
      }
      return;
    }

    const inflight = this.linearInflightFetch;
    if (inflight?.projectId === projectId && !isExistingPaginationOptions) {
      return inflight.promise;
    }

    const fetchPromise = this.runLinearFetchIssues(
      workspaceSlug,
      projectId,
      loadType,
      options,
      isExistingPaginationOptions
    );

    if (!isExistingPaginationOptions) {
      this.linearInflightFetch = { projectId, promise: fetchPromise };
      void fetchPromise.finally(() => {
        if (this.linearInflightFetch?.promise === fetchPromise) {
          this.linearInflightFetch = null;
        }
      });
    }

    return fetchPromise;
  };

  private runLegacyFetchIssues = async (
    workspaceSlug: string,
    projectId: string,
    loadType: TLoader,
    options: IssuePaginationOptions,
    isExistingPaginationOptions: boolean
  ) => {
    const sequence = this.beginFetch(loadType, !isExistingPaginationOptions, false);

    try {
      const params = this.issueFilterStore?.getFilterParams(options, projectId, undefined, undefined, undefined);
      const response = await this.issueService.getIssues(workspaceSlug, projectId, params, {
        signal: this.controller.signal,
      });

      if (this.isStaleFetch(sequence)) return;

      this.onfetchIssues(response, options, workspaceSlug, projectId, undefined, !isExistingPaginationOptions);
      runInAction(() => {
        this.mountedSnapshotProjectId = projectId;
      });
      return response;
    } catch (error) {
      if (this.isStaleFetch(sequence) || this.isAbortError(error)) return;
      this.setLoader(undefined);
      throw error;
    }
  };

  private runLinearFetchIssues = async (
    workspaceSlug: string,
    projectId: string,
    loadType: TLoader,
    options: IssuePaginationOptions,
    _isExistingPaginationOptions: boolean
  ): Promise<TIssuesResponse | undefined> => {
    const shouldShowLoader = !this.linearProjectSnapshots.has(projectId) && this.activeProjectId === projectId;

    if (shouldShowLoader) {
      runInAction(() => {
        this.setLoader(loadType);
      });
    }

    try {
      const params = this.issueFilterStore?.getFilterParams(options, projectId, undefined, undefined, undefined);
      const response = await this.issueService.getIssues(workspaceSlug, projectId, params, {
        signal: undefined,
      });

      const { issueList, groupedIssues, groupedIssueCount } = this.processIssueResponse(response);
      const groupedIssueIds = this.normalizeLinearProjectGroupedIssueIds(groupedIssues);

      if (!this.isValidSnapshotPayload(projectId, groupedIssueIds, groupedIssueCount, issueList)) {
        runInAction(() => {
          if (this.activeProjectId === projectId) {
            this.mountedSnapshotProjectId = null;
            this.setLoader("init-loader");
          }
        });
        return;
      }

      this.rootIssueStore.issues.addIssue(issueList);
      this.rootIssueStore.issueDetail.relation.extractRelationsFromIssues(issueList);

      const snapshot = this.createSnapshotFromFetch(
        projectId,
        response,
        options,
        groupedIssueIds,
        groupedIssueCount,
        issueList
      );
      this.saveSnapshot(projectId, snapshot);

      if (this.activeProjectId === projectId) {
        this.mountSnapshot(projectId, snapshot);
      } else {
        this.remountActiveSnapshot();
      }

      void this.fetchParentStats(workspaceSlug, projectId);
      return response;
    } catch (error) {
      if (this.isAbortError(error)) return;

      if (this.activeProjectId === projectId) {
        const existing = this.linearProjectSnapshots.get(projectId);
        if (existing) {
          this.mountSnapshot(projectId, existing);
          return;
        }

        runInAction(() => {
          this.mountedSnapshotProjectId = null;
          this.setLoader("init-loader");
        });
      }

      throw error;
    }
  };

  fetchNextIssues = async (workspaceSlug: string, projectId: string, groupId?: string, subGroupId?: string) => {
    if (isLinearReadOnly()) {
      return;
    }

    const cursorObject = this.getPaginationData(groupId, subGroupId);
    if (!this.paginationOptions || (cursorObject && !cursorObject?.nextPageResults)) return;

    const sequence = this.bumpFetchSequence();

    try {
      this.setLoader("pagination", groupId, subGroupId);

      const params = this.issueFilterStore?.getFilterParams(
        this.paginationOptions,
        projectId,
        this.getNextCursor(groupId, subGroupId),
        groupId,
        subGroupId
      );
      const response = await this.issueService.getIssues(workspaceSlug, projectId, params);

      if (isLinearReadOnly()) {
        if (this.activeProjectId !== projectId) return;
      } else if (this.isStaleFetch(sequence)) {
        return;
      }

      this.onfetchNexIssues(response, groupId, subGroupId);
      return response;
    } catch (error) {
      if (isLinearReadOnly()) {
        if (this.activeProjectId !== projectId || this.isAbortError(error)) return;
        this.setLoader(undefined, groupId, subGroupId);
      } else if (this.isStaleFetch(sequence) || this.isAbortError(error)) {
        return;
      } else {
        this.setLoader(undefined, groupId, subGroupId);
      }
      throw error;
    }
  };

  fetchIssuesWithExistingPagination = async (
    workspaceSlug: string,
    projectId: string,
    loadType: TLoader = "mutation"
  ) => {
    if (!this.paginationOptions) return;

    if (isLinearReadOnly()) {
      this.linearProjectSnapshots.delete(projectId);
      runInAction(() => {
        if (this.mountedSnapshotProjectId === projectId) {
          this.mountedSnapshotProjectId = null;
        }
      });
      return await this.fetchIssues(workspaceSlug, projectId, loadType, this.paginationOptions, true);
    }

    if (this.mountedSnapshotProjectId !== projectId) return;
    return await this.fetchIssues(workspaceSlug, projectId, loadType, this.paginationOptions, true);
  };

  override createIssue = async (workspaceSlug: string, projectId: string, data: Partial<TIssue>) => {
    const response = await super.createIssue(workspaceSlug, projectId, data, "", projectId === this.router.projectId);
    return response;
  };

  archiveBulkIssues = this.bulkArchiveIssues;
  quickAddIssue = this.issueQuickAdd;
  updateIssue = this.issueUpdate;
  archiveIssue = this.issueArchive;
}
