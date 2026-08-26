/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { action, makeObservable, observable, runInAction } from "mobx";
import { cloneDeep } from "lodash-es";
// base class
import type {
  IssuePaginationOptions,
  TBulkOperationsPayload,
  TIssue,
  TIssuesResponse,
  TLoader,
  ViewFlags,
  TGroupedIssues,
  TSubGroupedIssues,
  TGroupedIssueCount,
  TIssuePaginationData,
} from "@plane/types";
// services
import { WorkspaceService } from "@/services/workspace.service";
import { isLinearAllIssuesView, isLinearReadOnly } from "@/helpers/linear-display.helper";
// types
import type { IBaseIssuesStore } from "../helpers/base-issues.store";
import { BaseIssuesStore } from "../helpers/base-issues.store";
import type { IIssueRootStore } from "../root.store";
import type { IWorkspaceIssuesFilter } from "./filter.store";

export interface IWorkspaceIssues extends IBaseIssuesStore {
  // observable
  viewFlags: ViewFlags;
  // actions
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
  snapshotBeforeLinearNavigation: () => void;
}

export class WorkspaceIssues extends BaseIssuesStore implements IWorkspaceIssues {
  viewFlags = {
    enableQuickAdd: true,
    enableIssueCreation: true,
    enableInlineEditing: true,
  };
  activeViewId: string | null = null;
  private linearViewIssueCache = new Map<
    string,
    {
      groupedIssueIds: TGroupedIssues | TSubGroupedIssues;
      groupedIssueCount: TGroupedIssueCount;
      issuePaginationData: TIssuePaginationData;
      paginationOptions: IssuePaginationOptions | undefined;
    }
  >();

  isViewDataReady = (viewId: string): boolean =>
    isLinearAllIssuesView(viewId) && this.activeViewId === viewId && !!this.groupedIssueIds;

  snapshotBeforeLinearNavigation = () => {
    if (!this.activeViewId || !isLinearAllIssuesView(this.activeViewId) || !this.groupedIssueIds) return;
    this.cacheViewIssues(this.activeViewId);
    this.bumpFetchSequence();
  };

  protected override beginFetch(
    loadType: TLoader,
    shouldClearPaginationOptions: boolean,
    preserveIssueList = false
  ): number {
    if (!isLinearReadOnly()) {
      return super.beginFetch(loadType, shouldClearPaginationOptions, preserveIssueList);
    }

    const sequence = ++this.fetchSequence;
    runInAction(() => {
      this.setLoader(loadType);
      if (!preserveIssueList) {
        this.groupedIssueIds = undefined;
        this.issuePaginationData = {};
        this.groupedIssueCount = {};
      }
      if (shouldClearPaginationOptions) {
        this.paginationOptions = undefined;
      }
    });
    return sequence;
  }

  private cacheViewIssues(viewId: string) {
    if (!this.groupedIssueIds) return;
    this.linearViewIssueCache.set(viewId, {
      groupedIssueIds: cloneDeep(this.groupedIssueIds),
      groupedIssueCount: cloneDeep(this.groupedIssueCount),
      issuePaginationData: cloneDeep(this.issuePaginationData),
      paginationOptions: this.paginationOptions ? { ...this.paginationOptions } : undefined,
    });
  }

  private restoreCachedViewIssues(viewId: string): boolean {
    const cached = this.linearViewIssueCache.get(viewId);
    if (!cached) return false;

    runInAction(() => {
      this.groupedIssueIds = cloneDeep(cached.groupedIssueIds);
      this.groupedIssueCount = cloneDeep(cached.groupedIssueCount);
      this.issuePaginationData = cloneDeep(cached.issuePaginationData);
      this.paginationOptions = cached.paginationOptions ? { ...cached.paginationOptions } : undefined;
      this.activeViewId = viewId;
    });
    return true;
  }

  private rejectStaleViewResponse(sequence: number, viewId: string): boolean {
    return this.isStaleFetch(sequence) || this.activeViewId !== viewId;
  }
  // service
  workspaceService;
  // filterStore
  issueFilterStore;

  constructor(_rootStore: IIssueRootStore, issueFilterStore: IWorkspaceIssuesFilter) {
    super(_rootStore, issueFilterStore);

    makeObservable(this, {
      activeViewId: observable,
      // action
      fetchIssues: action,
      fetchNextIssues: action,
      fetchIssuesWithExistingPagination: action,
      snapshotBeforeLinearNavigation: action,
    });
    // services
    this.workspaceService = new WorkspaceService();
    // filter store
    this.issueFilterStore = issueFilterStore;
  }

  fetchParentStats = () => {};

  /** */
  updateParentStats = () => {};

  /**
   * This method is called to fetch the first issues of pagination
   * @param workspaceSlug
   * @param viewId
   * @param loadType
   * @param options
   * @returns
   */
  fetchIssues = async (
    workspaceSlug: string,
    viewId: string,
    loadType: TLoader,
    options: IssuePaginationOptions,
    isExistingPaginationOptions: boolean = false
  ) => {
    const isLinearAll = isLinearAllIssuesView(viewId);

    if (isLinearAll) {
      this.activeViewId = viewId;
    }

    if (isLinearAll && !isExistingPaginationOptions) {
      if (this.isViewDataReady(viewId)) {
        this.bumpFetchSequence();
        return;
      }
      if (this.restoreCachedViewIssues(viewId)) {
        this.bumpFetchSequence();
        runInAction(() => {
          this.setLoader(undefined);
        });
        return;
      }
    }

    const preserveIssueList = isLinearAll && !!this.groupedIssueIds;
    const sequence = this.beginFetch(loadType, !isExistingPaginationOptions, preserveIssueList);

    try {
      // get params from pagination options
      const params = this.issueFilterStore?.getFilterParams(options, viewId, undefined, undefined, undefined);
      // call the fetch issues API with the params
      const response = await this.workspaceService.getViewIssues(workspaceSlug, params, {
        signal: isLinearAll ? undefined : this.controller.signal,
      });

      if (isLinearAll && this.rejectStaleViewResponse(sequence, viewId)) return;
      if (!isLinearAll && this.isStaleFetch(sequence)) return;

      // after fetching issues, call the base method to process the response further
      this.onfetchIssues(response, options, workspaceSlug, undefined, undefined, !isExistingPaginationOptions);
      if (isLinearAll) {
        this.cacheViewIssues(viewId);
      }
      return response;
    } catch (error) {
      if ((isLinearAll && this.rejectStaleViewResponse(sequence, viewId)) || this.isAbortError(error)) return;
      if (!isLinearAll && this.isStaleFetch(sequence)) return;
      // set loader to undefined if errored out
      this.setLoader(undefined);
      throw error;
    }
  };

  /**
   * This method is called subsequent pages of pagination
   * if groupId/subgroupId is provided, only that specific group's next page is fetched
   * else all the groups' next page is fetched
   * @param workspaceSlug
   * @param viewId
   * @param groupId
   * @param subGroupId
   * @returns
   */
  fetchNextIssues = async (workspaceSlug: string, viewId: string, groupId?: string, subGroupId?: string) => {
    const cursorObject = this.getPaginationData(groupId, subGroupId);
    // if there are no pagination options and the next page results do not exist the return
    if (!this.paginationOptions || (cursorObject && !cursorObject?.nextPageResults)) return;

    const sequence = this.bumpFetchSequence();

    try {
      // set Loader
      this.setLoader("pagination", groupId, subGroupId);

      // get params from stored pagination options
      const params = this.issueFilterStore?.getFilterParams(
        this.paginationOptions,
        viewId,
        this.getNextCursor(groupId, subGroupId),
        groupId,
        subGroupId
      );
      // call the fetch issues API with the params for next page in issues
      const response = await this.workspaceService.getViewIssues(workspaceSlug, params);

      if (this.isStaleFetch(sequence)) return;

      // after the next page of issues are fetched, call the base method to process the response
      this.onfetchNexIssues(response, groupId, subGroupId);
      return response;
    } catch (error) {
      if (this.isStaleFetch(sequence) || this.isAbortError(error)) return;
      // set Loader as undefined if errored out
      this.setLoader(undefined, groupId, subGroupId);
      throw error;
    }
  };

  /**
   * This Method exists to fetch the first page of the issues with the existing stored pagination
   * This is useful for refetching when filters, groupBy, orderBy etc changes
   * @param workspaceSlug
   * @param viewId
   * @param loadType
   * @returns
   */
  fetchIssuesWithExistingPagination = async (workspaceSlug: string, viewId: string, loadType: TLoader) => {
    if (!this.paginationOptions) return;
    if (isLinearAllIssuesView(viewId)) {
      this.linearViewIssueCache.delete(viewId);
    }
    return await this.fetchIssues(workspaceSlug, viewId, loadType, this.paginationOptions, true);
  };

  // Using aliased names as they cannot be overridden in other stores
  archiveBulkIssues = this.bulkArchiveIssues;
  updateIssue = this.issueUpdate;
  archiveIssue = this.issueArchive;

  // Setting them as undefined as they can not performed on workspace issues
  quickAddIssue = undefined;
}
