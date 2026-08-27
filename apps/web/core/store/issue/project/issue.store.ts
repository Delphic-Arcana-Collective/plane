/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { set } from "lodash-es";
import { action, computed, makeObservable, observable, runInAction } from "mobx";
// types
import { ALL_ISSUES } from "@plane/constants";
import type {
  TIssue,
  TLoader,
  ViewFlags,
  IssuePaginationOptions,
  TIssuesResponse,
  TBulkOperationsPayload,
  GroupByColumnTypes,
} from "@plane/types";
import { EIssueLayoutTypes } from "@plane/types";
// helpers
// base class
import type { IBaseIssuesStore } from "../helpers/base-issues.store";
import { BaseIssuesStore } from "../helpers/base-issues.store";
// services
import type { IIssueRootStore } from "../root.store";
import type { IProjectIssuesFilter } from "./filter.store";
import {
  groupLinearIssuesFromFlatList,
  hasLinearGroupedIssueData,
  isLinearReadOnly,
  LINEAR_READ_ONLY_VIEW_FLAGS,
  syncLinearGroupedIssueCounts,
} from "@/helpers/linear-display.helper";

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
  loadedProjectId: string | null;
  isProjectViewReady: (projectId: string) => boolean;
  ensureLinearProjectIssuesGrouped: (projectId: string) => boolean;
}

export class ProjectIssues extends BaseIssuesStore implements IProjectIssues {
  router;

  // filter store
  issueFilterStore: IProjectIssuesFilter;
  /** Project id for the issues currently loaded in groupedIssueIds. */
  loadedProjectId: string | null = null;

  isProjectViewReady = (projectId: string): boolean => {
    if (!isLinearReadOnly()) return true;
    if (this.loadedProjectId !== projectId || !this.groupedIssueIds) return false;
    if (!this.groupedIssuesMatchProject(projectId)) return false;

    const filters = this.issueFilterStore.getIssueFilters(projectId);
    const layout = filters?.displayFilters?.layout ?? EIssueLayoutTypes.LIST;
    const groupBy = (filters?.displayFilters?.group_by ?? null) as GroupByColumnTypes | null;

    if (groupBy === "state") {
      const states = this.rootIssueStore.rootStore.state.getProjectStates(projectId);
      if (!states?.length) return false;
    }

    return hasLinearGroupedIssueData(this.groupedIssueIds, layout, groupBy);
  };

  ensureLinearProjectIssuesGrouped = (projectId: string): boolean => {
    if (!isLinearReadOnly()) return true;
    if (this.loadedProjectId !== projectId || !this.groupedIssueIds) return false;
    return this.normalizeLinearGroupedIssues(projectId);
  };

  private groupedIssuesMatchProject(projectId: string): boolean {
    const groupedIssueIds = this.groupedIssueIds;
    if (!groupedIssueIds) return false;

    const getIssueById = this.rootIssueStore.issues.getIssueById;
    const issueIds = new Set<string>();

    for (const value of Object.values(groupedIssueIds)) {
      if (!Array.isArray(value)) continue;
      for (const issueId of value) issueIds.add(issueId);
    }

    if (issueIds.size === 0) return false;

    for (const issueId of issueIds) {
      const issue = getIssueById(issueId);
      if (!issue || issue.project_id !== projectId) return false;
    }

    return true;
  }

  private applyLinearGroupedIssueCounts(groupedIssueIds: TGroupedIssues) {
    const synced = syncLinearGroupedIssueCounts(groupedIssueIds, this.groupedIssueCount);
    for (const [key, count] of Object.entries(synced)) {
      set(this.groupedIssueCount, [key], count);
    }
  }

  private collectGroupedIssueIds(groupedIssueIds: TGroupedIssues): string[] {
    const ids = new Set<string>();
    for (const value of Object.values(groupedIssueIds)) {
      if (!Array.isArray(value)) continue;
      for (const issueId of value) ids.add(issueId);
    }
    return Array.from(ids);
  }

  private normalizeLinearGroupedIssues(projectId: string) {
    const groupedIssueIds = this.groupedIssueIds;
    if (!groupedIssueIds) return false;

    const getIssueById = this.rootIssueStore.issues.getIssueById;
    let flatIds = groupedIssueIds[ALL_ISSUES];
    if (!Array.isArray(flatIds) || flatIds.length === 0) {
      flatIds = this.collectGroupedIssueIds(groupedIssueIds);
      if (flatIds.length > 0) {
        groupedIssueIds[ALL_ISSUES] = flatIds;
      }
    }

    if (Array.isArray(flatIds) && flatIds.length > 0) {
      if (!flatIds.every((issueId) => getIssueById(issueId)?.project_id === projectId)) {
        return false;
      }
    }

    const filters = this.issueFilterStore.getIssueFilters(projectId);
    const groupBy = (filters?.displayFilters?.group_by ?? null) as GroupByColumnTypes | null;
    const layout = filters?.displayFilters?.layout ?? EIssueLayoutTypes.LIST;

    if (groupBy && Array.isArray(flatIds) && flatIds.length > 0) {
      const issueMap = Object.fromEntries(
        flatIds.flatMap((issueId) => {
          const issue = getIssueById(issueId);
          return issue ? [[issueId, issue] as const] : [];
        })
      );

      this.groupedIssueIds = groupLinearIssuesFromFlatList(groupedIssueIds, issueMap, groupBy);
    }

    this.applyLinearGroupedIssueCounts(this.groupedIssueIds);
    return hasLinearGroupedIssueData(this.groupedIssueIds, layout, groupBy);
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
      ensureLinearProjectIssuesGrouped: action,
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
    if (isLinearReadOnly()) {
      return this.fetchLinearProjectIssues(workspaceSlug, projectId, loadType, options, isExistingPaginationOptions);
    }

    const sequence = this.beginFetch(loadType, !isExistingPaginationOptions);

    try {
      // get params from pagination options
      const params = this.issueFilterStore?.getFilterParams(options, projectId, undefined, undefined, undefined);
      // call the fetch issues API with the params
      const response = await this.issueService.getIssues(workspaceSlug, projectId, params, {
        signal: this.controller.signal,
      });

      if (this.isStaleFetch(sequence)) return;

      // after fetching issues, call the base method to process the response further
      this.onfetchIssues(response, options, workspaceSlug, projectId, undefined, !isExistingPaginationOptions);
      runInAction(() => {
        this.loadedProjectId = projectId;
      });
      return response;
    } catch (error) {
      if (this.isStaleFetch(sequence) || this.isAbortError(error)) return;
      // set loader to undefined if errored out
      this.setLoader(undefined);
      throw error;
    }
  };

  private fetchLinearProjectIssues = async (
    workspaceSlug: string,
    projectId: string,
    loadType: TLoader,
    options: IssuePaginationOptions,
    isExistingPaginationOptions: boolean
  ) => {
    const sequence = this.bumpFetchSequence();

    runInAction(() => {
      this.setLoader(loadType);
      if (this.loadedProjectId !== projectId) {
        this.loadedProjectId = null;
      }
    });

    try {
      const params = this.issueFilterStore?.getFilterParams(options, projectId, undefined, undefined, undefined);
      const response = await this.issueService.getIssues(workspaceSlug, projectId, params, {
        signal: undefined,
      });

      if (this.isStaleFetch(sequence)) return;

      this.onfetchIssues(response, options, workspaceSlug, projectId, undefined, !isExistingPaginationOptions);

      runInAction(() => {
        if (this.normalizeLinearGroupedIssues(projectId)) {
          this.loadedProjectId = projectId;
        } else {
          this.clear(true);
          this.loadedProjectId = null;
          this.setLoader(loadType);
        }
      });
      return response;
    } catch (error) {
      if (this.isStaleFetch(sequence)) return;
      runInAction(() => {
        this.setLoader(undefined);
      });
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
    if (!this.paginationOptions || this.loadedProjectId !== projectId) return;
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
