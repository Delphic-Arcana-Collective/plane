/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { action, computed, makeObservable, observable, runInAction } from "mobx";
import { cloneDeep } from "lodash-es";
import { ALL_ISSUES } from "@plane/constants";
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
  GroupByColumnTypes,
} from "@plane/types";
import { EIssueLayoutTypes } from "@plane/types";
import type { IBaseIssuesStore } from "../helpers/base-issues.store";
import { BaseIssuesStore } from "../helpers/base-issues.store";
import type { IIssueRootStore } from "../root.store";
import type { IProjectIssuesFilter } from "./filter.store";
import {
  isLinearReadOnly,
  LINEAR_READ_ONLY_VIEW_FLAGS,
  getLinearDefaultDisplayFilters,
  groupLinearIssuesFromFlatList,
} from "@/helpers/linear-display.helper";
import {
  clearLinearProjectCache,
  deleteLinearProjectSnapshot,
  openLinearProjectFromCache,
  persistLinearProjectSnapshot,
  type TLinearProjectSnapshot,
} from "@/helpers/linear-project-snapshot.storage";

export interface IProjectIssues extends IBaseIssuesStore {
  viewFlags: ViewFlags;
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
}

export class ProjectIssues extends BaseIssuesStore implements IProjectIssues {
  router;

  issueFilterStore: IProjectIssuesFilter;

  /** Mirrors sessionStorage active project — updated only after a locked read/write. */
  linearActiveProjectId: string | null = null;

  isProjectDataReady = (projectId: string): boolean => {
    if (!isLinearReadOnly()) return false;
    if (this.linearActiveProjectId !== projectId) return false;

    const groupedIssueIds = this.groupedIssueIds;
    if (!groupedIssueIds) return false;

    const flatIds = groupedIssueIds[ALL_ISSUES];
    if (!Array.isArray(flatIds) || flatIds.length === 0) return false;

    const getIssueById = this.rootIssueStore.issues.getIssueById;
    if (!flatIds.every((issueId) => getIssueById(issueId)?.project_id === projectId)) {
      return false;
    }

    return Object.keys(groupedIssueIds).some((key) => {
      if (key === ALL_ISSUES) return false;
      const bucket = groupedIssueIds[key];
      return Array.isArray(bucket) && bucket.length > 0;
    });
  };

  private clearLinearDisplay() {
    this.groupedIssueIds = undefined;
    this.groupedIssueCount = {};
    this.issuePaginationData = {};
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

  private prepareSnapshotForDisplay(snapshot: TLinearProjectSnapshot): TLinearProjectSnapshot {
    const groupedIssueIds = cloneDeep(snapshot.groupedIssueIds);
    const linearDefaults = getLinearDefaultDisplayFilters();
    const groupBy = linearDefaults.group_by as GroupByColumnTypes;
    const layout = linearDefaults.layout;
    const issueMap = Object.fromEntries(snapshot.issues.map((issue) => [issue.id, issue]));

    let preparedGrouped = groupedIssueIds;
    if (
      groupBy &&
      (layout === EIssueLayoutTypes.KANBAN || layout === EIssueLayoutTypes.LIST) &&
      Array.isArray(groupedIssueIds[ALL_ISSUES])
    ) {
      preparedGrouped = groupLinearIssuesFromFlatList(groupedIssueIds, issueMap, groupBy);
    }

    return {
      ...snapshot,
      groupedIssueIds: preparedGrouped,
      groupedIssueCount: this.buildLinearDisplayCounts(preparedGrouped),
      issuePaginationData: {},
    };
  }

  private isValidProjectSnapshot(snapshot: TLinearProjectSnapshot, projectId: string): boolean {
    const prepared = this.prepareSnapshotForDisplay(snapshot);
    const flatIds = prepared.groupedIssueIds[ALL_ISSUES];
    if (!Array.isArray(flatIds) || flatIds.length === 0) return false;

    const issuesById = new Map(prepared.issues.map((issue) => [issue.id, issue]));
    if (!flatIds.every((issueId) => issuesById.get(issueId)?.project_id === projectId)) {
      return false;
    }

    return Object.keys(prepared.groupedIssueIds).some((key) => {
      if (key === ALL_ISSUES) return false;
      const bucket = prepared.groupedIssueIds[key];
      return Array.isArray(bucket) && bucket.length > 0;
    });
  }

  private applySnapshotToStore(projectId: string, snapshot: TLinearProjectSnapshot) {
    const prepared = this.prepareSnapshotForDisplay(snapshot);
    this.rootIssueStore.issues.addIssue(prepared.issues);
    this.groupedIssueIds = prepared.groupedIssueIds;
    this.groupedIssueCount = prepared.groupedIssueCount;
    this.issuePaginationData = {};
    this.paginationOptions = prepared.paginationOptions ? { ...prepared.paginationOptions } : undefined;
    this.linearActiveProjectId = projectId;
    this.setLoader(undefined);
  }

  private showLinearLoader(projectId: string, loadType: TLoader = "init-loader") {
    if (this.linearActiveProjectId !== projectId) return;
    this.clearLinearDisplay();
    this.setLoader(loadType);
  }

  private async linearOpenProject(projectId: string): Promise<boolean> {
    const snapshot = await openLinearProjectFromCache(projectId);

    if (snapshot && this.isValidProjectSnapshot(snapshot, projectId)) {
      runInAction(() => {
        this.applySnapshotToStore(projectId, snapshot);
      });
      return true;
    }

    if (snapshot) {
      await deleteLinearProjectSnapshot(projectId);
    }

    runInAction(() => {
      this.linearActiveProjectId = projectId;
      this.showLinearLoader(projectId);
    });
    return false;
  }

  private async linearCommitSnapshot(projectId: string, snapshot: TLinearProjectSnapshot) {
    if (this.linearActiveProjectId !== projectId) return;

    if (!this.isValidProjectSnapshot(snapshot, projectId)) {
      runInAction(() => {
        this.showLinearLoader(projectId);
      });
      return;
    }

    const prepared = this.prepareSnapshotForDisplay(snapshot);
    const stillActive = await persistLinearProjectSnapshot(projectId, prepared);
    if (!stillActive || this.linearActiveProjectId !== projectId) return;

    runInAction(() => {
      this.applySnapshotToStore(projectId, prepared);
    });
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

  private createSnapshotFromFetch(
    response: TIssuesResponse,
    options: IssuePaginationOptions,
    groupedIssueIds: TGroupedIssues,
    groupedIssueCount: TGroupedIssueCount,
    issueList: TIssue[]
  ): TLinearProjectSnapshot {
    this.storePreviousPaginationValues(response, options);

    return {
      groupedIssueIds: cloneDeep(groupedIssueIds),
      groupedIssueCount: cloneDeep(groupedIssueCount),
      issuePaginationData: cloneDeep(this.issuePaginationData),
      paginationOptions: this.paginationOptions ? { ...this.paginationOptions } : undefined,
      issues: cloneDeep(issueList),
    };
  }

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
      linearActiveProjectId: observable,
      fetchIssues: action,
      fetchNextIssues: action,
      fetchIssuesWithExistingPagination: action,
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
      const loaded = await this.linearOpenProject(projectId);
      if (loaded) {
        return;
      }
    }

    return this.runLinearFetchIssues(workspaceSlug, projectId, loadType, options);
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
    options: IssuePaginationOptions
  ): Promise<TIssuesResponse | undefined> => {
    runInAction(() => {
      this.linearActiveProjectId = projectId;
      if (!this.isProjectDataReady(projectId)) {
        this.showLinearLoader(projectId, loadType);
      }
    });

    try {
      const params = this.issueFilterStore?.getFilterParams(options, projectId, undefined, undefined, undefined);
      const response = await this.issueService.getIssues(workspaceSlug, projectId, params, {
        signal: undefined,
      });

      if (this.linearActiveProjectId !== projectId) return;

      const { issueList, groupedIssues, groupedIssueCount } = this.processIssueResponse(response);
      const groupedIssueIds = this.normalizeLinearProjectGroupedIssueIds(groupedIssues);

      const flatIds = groupedIssueIds[ALL_ISSUES];
      if (
        !Array.isArray(flatIds) ||
        flatIds.length === 0 ||
        !issueList.every((issue) => issue.project_id === projectId)
      ) {
        runInAction(() => {
          this.showLinearLoader(projectId);
        });
        return;
      }

      const snapshot = this.createSnapshotFromFetch(response, options, groupedIssueIds, groupedIssueCount, issueList);
      await this.linearCommitSnapshot(projectId, snapshot);

      void this.fetchParentStats(workspaceSlug, projectId);
      return response;
    } catch (error) {
      if (this.isAbortError(error)) {
        return;
      }

      runInAction(() => {
        this.showLinearLoader(projectId);
      });
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

      if (this.isStaleFetch(sequence)) {
        return;
      }

      this.onfetchNexIssues(response, groupId, subGroupId);
      return response;
    } catch (error) {
      if (this.isStaleFetch(sequence) || this.isAbortError(error)) {
        return;
      }
      this.setLoader(undefined, groupId, subGroupId);
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
      await clearLinearProjectCache(projectId);
      return await this.fetchIssues(workspaceSlug, projectId, loadType, this.paginationOptions, true);
    }

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
