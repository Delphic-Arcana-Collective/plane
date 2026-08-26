/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { action, computed, makeObservable, observable, runInAction } from "mobx";
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
} from "@plane/types";
// helpers
// base class
import type { IBaseIssuesStore } from "../helpers/base-issues.store";
import { BaseIssuesStore } from "../helpers/base-issues.store";
// services
import type { IIssueRootStore } from "../root.store";
import type { IProjectIssuesFilter } from "./filter.store";
import { isLinearReadOnly, LINEAR_READ_ONLY_VIEW_FLAGS } from "@/helpers/linear-display.helper";

type TLinearProjectIssueCache = {
  groupedIssueIds: TGroupedIssues | TSubGroupedIssues;
  groupedIssueCount: TGroupedIssueCount;
  issuePaginationData: TIssuePaginationData;
  paginationOptions: IssuePaginationOptions | undefined;
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
}

export class ProjectIssues extends BaseIssuesStore implements IProjectIssues {
  router;

  // filter store
  issueFilterStore: IProjectIssuesFilter;
  /** Project id for the issues currently loaded in groupedIssueIds. */
  loadedProjectId: string | null = null;
  private linearProjectIssueCache = new Map<string, TLinearProjectIssueCache>();

  isProjectDataReady = (projectId: string): boolean => this.loadedProjectId === projectId && !!this.groupedIssueIds;

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

  private cacheCurrentProjectIssues(projectId: string) {
    if (!isLinearReadOnly() || !this.groupedIssueIds) return;

    this.linearProjectIssueCache.set(projectId, {
      groupedIssueIds: this.groupedIssueIds,
      groupedIssueCount: { ...this.groupedIssueCount },
      issuePaginationData: { ...this.issuePaginationData },
      paginationOptions: this.paginationOptions,
    });
  }

  private restoreCachedProjectIssues(projectId: string): boolean {
    const cached = this.linearProjectIssueCache.get(projectId);
    if (!cached) return false;

    runInAction(() => {
      this.groupedIssueIds = cached.groupedIssueIds;
      this.groupedIssueCount = cached.groupedIssueCount;
      this.issuePaginationData = cached.issuePaginationData;
      this.paginationOptions = cached.paginationOptions;
      this.loadedProjectId = projectId;
    });
    return true;
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
      loadedProjectId: observable,
      fetchIssues: action,
      fetchNextIssues: action,
      fetchIssuesWithExistingPagination: action,

      quickAddIssue: action,
    });
    // filter store
    this.issueFilterStore = issueFilterStore;
    this.router = _rootStore.rootStore.router;
  }

  /**
   * Fetches the project details
   * @param workspaceSlug
   * @param projectId
   */
  fetchParentStats = async (workspaceSlug: string, projectId?: string) => {
    if (projectId) {
      await this.rootIssueStore.rootStore.projectRoot.project.fetchProjectDetails(workspaceSlug, projectId);
    }
  };

  /** */
  updateParentStats = () => {};

  /**
   * This method is called to fetch the first issues of pagination
   * @param workspaceSlug
   * @param projectId
   * @param loadType
   * @param options
   * @returns
   */
  fetchIssues = async (
    workspaceSlug: string,
    projectId: string,
    loadType: TLoader = "init-loader",
    options: IssuePaginationOptions,
    isExistingPaginationOptions: boolean = false
  ) => {
    const isLinearMode = isLinearReadOnly();
    const isProjectSwitch = this.loadedProjectId !== null && this.loadedProjectId !== projectId;

    if (isLinearMode && !isExistingPaginationOptions) {
      if (this.isProjectDataReady(projectId)) {
        return;
      }
      if (this.restoreCachedProjectIssues(projectId)) {
        runInAction(() => {
          this.setLoader(undefined);
        });
        return;
      }
    }

    if (isLinearMode && isProjectSwitch && this.loadedProjectId && this.groupedIssueIds) {
      this.cacheCurrentProjectIssues(this.loadedProjectId);
    }

    const preserveIssueList = isLinearMode ? !!this.groupedIssueIds : !isProjectSwitch && !!this.groupedIssueIds;

    const sequence = this.beginFetch(loadType, !isExistingPaginationOptions, preserveIssueList);

    try {
      // get params from pagination options
      const params = this.issueFilterStore?.getFilterParams(options, projectId, undefined, undefined, undefined);
      // call the fetch issues API with the params
      const response = await this.issueService.getIssues(workspaceSlug, projectId, params, {
        signal: isLinearMode ? undefined : this.controller.signal,
      });

      if (this.isStaleFetch(sequence)) return;

      // after fetching issues, call the base method to process the response further
      this.onfetchIssues(response, options, workspaceSlug, projectId, undefined, !isExistingPaginationOptions);
      runInAction(() => {
        this.loadedProjectId = projectId;
      });
      this.cacheCurrentProjectIssues(projectId);
      return response;
    } catch (error) {
      if (this.isStaleFetch(sequence) || this.isAbortError(error)) return;
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
   * @param projectId
   * @param groupId
   * @param subGroupId
   * @returns
   */
  fetchNextIssues = async (workspaceSlug: string, projectId: string, groupId?: string, subGroupId?: string) => {
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
        projectId,
        this.getNextCursor(groupId, subGroupId),
        groupId,
        subGroupId
      );
      // call the fetch issues API with the params for next page in issues
      const response = await this.issueService.getIssues(workspaceSlug, projectId, params);

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
   * @param projectId
   * @param loadType
   * @returns
   */
  fetchIssuesWithExistingPagination = async (
    workspaceSlug: string,
    projectId: string,
    loadType: TLoader = "mutation"
  ) => {
    if (!this.paginationOptions) return;

    if (isLinearReadOnly()) {
      this.linearProjectIssueCache.delete(projectId);
      return await this.fetchIssues(workspaceSlug, projectId, loadType, this.paginationOptions, true);
    }

    if (this.loadedProjectId !== projectId) return;
    return await this.fetchIssues(workspaceSlug, projectId, loadType, this.paginationOptions, true);
  };

  /**
   * Override inherited create issue, to update list only if user is on current project
   * @param workspaceSlug
   * @param projectId
   * @param data
   * @returns
   */
  override createIssue = async (workspaceSlug: string, projectId: string, data: Partial<TIssue>) => {
    const response = await super.createIssue(workspaceSlug, projectId, data, "", projectId === this.router.projectId);
    return response;
  };

  // Using aliased names as they cannot be overridden in other stores
  archiveBulkIssues = this.bulkArchiveIssues;
  quickAddIssue = this.issueQuickAdd;
  updateIssue = this.issueUpdate;
  archiveIssue = this.issueArchive;
}
