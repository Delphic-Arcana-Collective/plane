/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { action, makeObservable, observable, runInAction } from "mobx";
import { cloneDeep } from "lodash-es";
import { ALL_ISSUES } from "@plane/constants";
import type {
  IssuePaginationOptions,
  TBulkOperationsPayload,
  TIssue,
  TIssuesResponse,
  TLoader,
  ViewFlags,
  TGroupedIssues,
  TGroupedIssueCount,
} from "@plane/types";
import { WorkspaceService } from "@/services/workspace.service";
import { isLinearAllIssuesView, isLinearReadOnly } from "@/helpers/linear-display.helper";
import type { IBaseIssuesStore } from "../helpers/base-issues.store";
import { BaseIssuesStore } from "../helpers/base-issues.store";
import type { IIssueRootStore } from "../root.store";
import type { IWorkspaceIssuesFilter } from "./filter.store";
import {
  clearLinearAllIssuesCache,
  deleteLinearAllIssuesSnapshot,
  openLinearAllIssuesFromCache,
  persistLinearAllIssuesSnapshot,
  type TLinearProjectSnapshot,
} from "@/helpers/linear-project-snapshot.storage";

export interface IWorkspaceIssues extends IBaseIssuesStore {
  viewFlags: ViewFlags;
  fetchIssues: (
    workspaceSlug: string,
    viewId: string,
    loadType: TLoader,
    options: IssuePaginationOptions
  ) => Promise<TIssuesResponse | undefined>;
  fetchIssuesWithExistingPagination: (
    workspaceSlug: string,
    viewId: string,
    loadType: TLoader
  ) => Promise<TIssuesResponse | undefined>;
  fetchNextIssues: (
    workspaceSlug: string,
    viewId: string,
    groupId?: string,
    subGroupId?: string
  ) => Promise<TIssuesResponse | undefined>;

  createIssue: (workspaceSlug: string, projectId: string, data: Partial<TIssue>) => Promise<TIssue>;
  updateIssue: (workspaceSlug: string, projectId: string, issueId: string, data: Partial<TIssue>) => Promise<void>;
  archiveIssue: (workspaceSlug: string, projectId: string, issueId: string) => Promise<void>;
  removeBulkIssues: (workspaceSlug: string, projectId: string, issueIds: string[]) => Promise<void>;
  archiveBulkIssues: (workspaceSlug: string, projectId: string, issueIds: string[]) => Promise<void>;
  bulkUpdateProperties: (workspaceSlug: string, projectId: string, data: TBulkOperationsPayload) => Promise<void>;

  quickAddIssue: undefined;
  clear(): void;
  isViewDataReady: (viewId: string) => boolean;
}

export class WorkspaceIssues extends BaseIssuesStore implements IWorkspaceIssues {
  viewFlags = {
    enableQuickAdd: true,
    enableIssueCreation: true,
    enableInlineEditing: true,
  };

  /** True when committed all-issues data matches the active workspace view. */
  linearAllIssuesActive = false;

  isViewDataReady = (viewId: string): boolean => {
    if (!isLinearAllIssuesView(viewId)) return false;
    if (!this.linearAllIssuesActive) return false;

    const flatIds = this.groupedIssueIds?.[ALL_ISSUES];
    return Array.isArray(flatIds) && flatIds.length > 0;
  };

  private clearLinearDisplay() {
    this.groupedIssueIds = undefined;
    this.groupedIssueCount = {};
    this.issuePaginationData = {};
    this.linearAllIssuesActive = false;
  }

  private isValidWorkspaceSnapshot(snapshot: TLinearProjectSnapshot): boolean {
    const flatIds = snapshot.groupedIssueIds[ALL_ISSUES];
    return Array.isArray(flatIds) && flatIds.length > 0 && snapshot.issues.length > 0;
  }

  private applySnapshotToStore(snapshot: TLinearProjectSnapshot) {
    this.rootIssueStore.issues.addIssue(snapshot.issues);
    this.groupedIssueIds = cloneDeep(snapshot.groupedIssueIds);
    this.groupedIssueCount = cloneDeep(snapshot.groupedIssueCount);
    this.issuePaginationData = cloneDeep(snapshot.issuePaginationData);
    this.paginationOptions = snapshot.paginationOptions ? { ...snapshot.paginationOptions } : undefined;
    this.linearAllIssuesActive = true;
    this.setLoader(undefined);
  }

  private showLinearLoader(loadType: TLoader = "init-loader") {
    this.clearLinearDisplay();
    this.setLoader(loadType);
  }

  private async linearOpenAllIssues(): Promise<boolean> {
    const snapshot = await openLinearAllIssuesFromCache();

    if (!snapshot || !this.isValidWorkspaceSnapshot(snapshot)) {
      if (snapshot) {
        await deleteLinearAllIssuesSnapshot();
      }
      runInAction(() => {
        this.showLinearLoader();
      });
      return false;
    }

    runInAction(() => {
      this.applySnapshotToStore(snapshot);
    });
    return true;
  }

  private async linearCommitSnapshot(snapshot: TLinearProjectSnapshot) {
    if (!this.isValidWorkspaceSnapshot(snapshot)) {
      runInAction(() => {
        this.showLinearLoader();
      });
      return;
    }

    const prepared: TLinearProjectSnapshot = {
      groupedIssueIds: cloneDeep(snapshot.groupedIssueIds),
      groupedIssueCount: cloneDeep(snapshot.groupedIssueCount),
      issuePaginationData: cloneDeep(snapshot.issuePaginationData),
      paginationOptions: snapshot.paginationOptions ? { ...snapshot.paginationOptions } : undefined,
      issues: cloneDeep(snapshot.issues),
    };

    const stillActive = await persistLinearAllIssuesSnapshot(prepared);
    if (!stillActive) return;

    runInAction(() => {
      this.applySnapshotToStore(prepared);
    });
  }

  private normalizeGroupedIssueIds(groupedIssues: TGroupedIssues): TGroupedIssues {
    const flatIds = groupedIssues[ALL_ISSUES];
    if (Array.isArray(flatIds) && flatIds.length > 0) {
      return groupedIssues;
    }

    const mergedIds = Object.entries(groupedIssues)
      .filter(([key]) => key !== ALL_ISSUES)
      .flatMap(([, bucket]) => (Array.isArray(bucket) ? bucket : []));

    if (mergedIds.length === 0) return groupedIssues;

    return {
      ...groupedIssues,
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

  workspaceService;
  issueFilterStore;

  constructor(_rootStore: IIssueRootStore, issueFilterStore: IWorkspaceIssuesFilter) {
    super(_rootStore, issueFilterStore);

    makeObservable(this, {
      linearAllIssuesActive: observable,
      fetchIssues: action,
      fetchNextIssues: action,
      fetchIssuesWithExistingPagination: action,
    });
    this.workspaceService = new WorkspaceService();
    this.issueFilterStore = issueFilterStore;
  }

  fetchParentStats = () => {};

  updateParentStats = () => {};

  fetchIssues = async (
    workspaceSlug: string,
    viewId: string,
    loadType: TLoader,
    options: IssuePaginationOptions,
    isExistingPaginationOptions: boolean = false
  ) => {
    if (isLinearReadOnly() && isLinearAllIssuesView(viewId)) {
      return this.fetchLinearAllIssues(workspaceSlug, viewId, loadType, options, isExistingPaginationOptions);
    }

    const sequence = this.beginFetch(loadType, !isExistingPaginationOptions, false);

    try {
      const params = this.issueFilterStore?.getFilterParams(options, viewId, undefined, undefined, undefined);
      const response = await this.workspaceService.getViewIssues(workspaceSlug, params, {
        signal: this.controller.signal,
      });

      if (this.isStaleFetch(sequence)) return;

      this.onfetchIssues(response, options, workspaceSlug, undefined, undefined, !isExistingPaginationOptions);
      return response;
    } catch (error) {
      if (this.isStaleFetch(sequence) || this.isAbortError(error)) return;
      this.setLoader(undefined);
      throw error;
    }
  };

  private fetchLinearAllIssues = async (
    workspaceSlug: string,
    viewId: string,
    loadType: TLoader,
    options: IssuePaginationOptions,
    isExistingPaginationOptions: boolean
  ) => {
    if (!isExistingPaginationOptions) {
      const loaded = await this.linearOpenAllIssues();
      if (loaded) {
        return;
      }
    }

    runInAction(() => {
      this.showLinearLoader(loadType);
    });

    try {
      const params = this.issueFilterStore?.getFilterParams(options, viewId, undefined, undefined, undefined);
      const response = await this.workspaceService.getViewIssues(workspaceSlug, params, {
        signal: undefined,
      });

      const { issueList, groupedIssues, groupedIssueCount } = this.processIssueResponse(response);
      const groupedIssueIds = this.normalizeGroupedIssueIds(groupedIssues as TGroupedIssues);
      const flatIds = groupedIssueIds[ALL_ISSUES];
      if (!Array.isArray(flatIds) || flatIds.length === 0) {
        runInAction(() => {
          this.showLinearLoader();
        });
        return;
      }

      const snapshot = this.createSnapshotFromFetch(response, options, groupedIssueIds, groupedIssueCount, issueList);
      await this.linearCommitSnapshot(snapshot);
      return response;
    } catch (error) {
      if (this.isAbortError(error)) return;
      runInAction(() => {
        this.showLinearLoader();
      });
      throw error;
    }
  };

  fetchNextIssues = async (workspaceSlug: string, viewId: string, groupId?: string, subGroupId?: string) => {
    const cursorObject = this.getPaginationData(groupId, subGroupId);
    if (!this.paginationOptions || (cursorObject && !cursorObject?.nextPageResults)) return;

    const sequence = this.bumpFetchSequence();

    try {
      this.setLoader("pagination", groupId, subGroupId);

      const params = this.issueFilterStore?.getFilterParams(
        this.paginationOptions,
        viewId,
        this.getNextCursor(groupId, subGroupId),
        groupId,
        subGroupId
      );
      const response = await this.workspaceService.getViewIssues(workspaceSlug, params);

      if (this.isStaleFetch(sequence)) return;

      this.onfetchNexIssues(response, groupId, subGroupId);
      return response;
    } catch (error) {
      if (this.isStaleFetch(sequence) || this.isAbortError(error)) return;
      this.setLoader(undefined, groupId, subGroupId);
      throw error;
    }
  };

  fetchIssuesWithExistingPagination = async (workspaceSlug: string, viewId: string, loadType: TLoader) => {
    if (!this.paginationOptions) return;

    if (isLinearAllIssuesView(viewId)) {
      await clearLinearAllIssuesCache();
    }

    return await this.fetchIssues(workspaceSlug, viewId, loadType, this.paginationOptions, true);
  };

  archiveBulkIssues = this.bulkArchiveIssues;
  updateIssue = this.issueUpdate;
  archiveIssue = this.issueArchive;
  quickAddIssue = undefined;
}
