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
// helpers
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
} from "@/helpers/linear-display.helper";

type TLinearProjectIssueCache = {
  groupedIssueIds: TGroupedIssues | TSubGroupedIssues;
  groupedIssueCount: TGroupedIssueCount;
  issuePaginationData: TIssuePaginationData;
  paginationOptions: IssuePaginationOptions | undefined;
  issues: TIssue[];
};

type TLinearInflightFetch = {
  projectId: string;
  generation: number;
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

  // filter store
  issueFilterStore: IProjectIssuesFilter;
  /** Project id for the issues currently loaded in groupedIssueIds. */
  loadedProjectId: string | null = null;
  /** Project id the UI route is showing. */
  activeProjectId: string | null = null;
  /** Monotonic session counter — bumps on project change or leaving project view. */
  activeGeneration = 0;
  /** Generation that produced the current loadedProjectId data. */
  loadedGeneration = 0;
  private linearProjectIssueCache = new Map<string, TLinearProjectIssueCache>();
  private linearInflightFetch: TLinearInflightFetch | null = null;

  isProjectDataReady = (projectId: string): boolean => {
    if (
      this.activeProjectId !== projectId ||
      this.loadedProjectId !== projectId ||
      this.loadedGeneration !== this.activeGeneration
    ) {
      return false;
    }

    const displayFilters = this.issueFilterStore?.getIssueFilters(projectId)?.displayFilters;
    const groupedIssueIds = this.groupedIssueIds as TGroupedIssues | undefined;
    if (
      !hasLinearGroupedIssueData(
        groupedIssueIds,
        displayFilters?.layout,
        displayFilters?.group_by as GroupByColumnTypes | null
      )
    ) {
      return false;
    }

    return this.hasResolvedProjectIssuesInMap(groupedIssueIds, projectId);
  };

  private hasResolvedProjectIssuesInMap(groupedIssueIds: TGroupedIssues | undefined, projectId: string): boolean {
    if (!groupedIssueIds) return false;

    const flatIds = groupedIssueIds[ALL_ISSUES];
    if (Array.isArray(flatIds)) {
      if (flatIds.length === 0) return false;
      return flatIds.every((issueId) => {
        const issue = this.rootIssueStore.issues.getIssueById(issueId);
        return !!issue && issue.project_id === projectId;
      });
    }

    return Object.entries(groupedIssueIds)
      .filter(([key]) => key !== ALL_ISSUES)
      .some(([, bucket]) => {
        if (!Array.isArray(bucket) || bucket.length === 0) return false;
        return bucket.every((issueId) => {
          const issue = this.rootIssueStore.issues.getIssueById(issueId);
          return !!issue && issue.project_id === projectId;
        });
      });
  }

  private collectIssuePayloadsFromGrouped(
    groupedIssueIds: TGroupedIssues | TSubGroupedIssues,
    projectId: string
  ): TIssue[] {
    const normalized = this.normalizeLinearProjectGroupedIssueIds(groupedIssueIds) as TGroupedIssues;
    const flatIds = normalized[ALL_ISSUES];
    if (!Array.isArray(flatIds)) return [];

    const issues: TIssue[] = [];
    for (const issueId of flatIds) {
      const issue = this.rootIssueStore.issues.getIssueById(issueId);
      if (issue && issue.project_id === projectId) {
        issues.push(issue);
      }
    }
    return issues;
  }

  private canCommitLinearProjectLoad(projectId: string, groupedIssueIds: TGroupedIssues | undefined): boolean {
    const displayFilters = this.issueFilterStore?.getIssueFilters(projectId)?.displayFilters;
    return (
      !!groupedIssueIds &&
      hasLinearGroupedIssueData(
        groupedIssueIds,
        displayFilters?.layout,
        displayFilters?.group_by as GroupByColumnTypes | null
      ) &&
      this.hasResolvedProjectIssuesInMap(groupedIssueIds, projectId)
    );
  }

  /** Bump write generation when leaving project view — does not clear committed display data. */
  private invalidateProjectSession = () => {
    this.activeGeneration += 1;
    this.activeProjectId = null;
    this.loadedProjectId = null;
    this.loadedGeneration = 0;
  };

  snapshotBeforeLinearNavigation = (projectId: string) => {
    if (!isLinearReadOnly()) return;
    if (this.loadedProjectId === projectId && this.isProjectDataReady(projectId)) {
      this.cacheCurrentProjectIssues(projectId);
    }
    this.invalidateProjectSession();
  };

  private activateProject = (projectId: string) => {
    if (this.activeProjectId === projectId) return;

    this.activeProjectId = projectId;
    this.activeGeneration += 1;
    const generation = this.activeGeneration;

    if (this.restoreCachedProjectIssues(projectId, generation)) {
      return;
    }

    runInAction(() => {
      this.loadedProjectId = null;
      this.loadedGeneration = 0;
      this.groupedIssueIds = undefined;
      this.issuePaginationData = {};
      this.groupedIssueCount = {};
      this.setLoader("init-loader");
    });
  };

  private commitProjectLoad = (projectId: string, generation: number) => {
    this.loadedProjectId = projectId;
    this.loadedGeneration = generation;
  };

  private isFetchGenerationCurrent = (projectId: string, generation: number): boolean =>
    this.activeProjectId === projectId && this.activeGeneration === generation;

  /** Flatten grouped buckets so cache restores work across List/Kanban layouts. */
  private normalizeLinearProjectGroupedIssueIds(
    groupedIssueIds: TGroupedIssues | TSubGroupedIssues
  ): TGroupedIssues | TSubGroupedIssues {
    const flatIds = groupedIssueIds[ALL_ISSUES];
    if (Array.isArray(flatIds) && flatIds.length > 0) {
      return groupedIssueIds;
    }

    const mergedIds = Object.entries(groupedIssueIds)
      .filter(([key]) => key !== ALL_ISSUES)
      .flatMap(([, bucket]) => (Array.isArray(bucket) ? bucket : []));

    if (mergedIds.length === 0) return groupedIssueIds;

    return { [ALL_ISSUES]: [...new Set(mergedIds)] };
  }

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

    const groupedIssueIds = this.normalizeLinearProjectGroupedIssueIds(this.groupedIssueIds) as TGroupedIssues;
    if (!this.canCommitLinearProjectLoad(projectId, groupedIssueIds)) return;

    const issues = this.collectIssuePayloadsFromGrouped(groupedIssueIds, projectId);
    if (issues.length === 0) return;

    this.linearProjectIssueCache.set(projectId, {
      groupedIssueIds: cloneDeep(groupedIssueIds),
      groupedIssueCount: cloneDeep(this.groupedIssueCount),
      issuePaginationData: cloneDeep(this.issuePaginationData),
      paginationOptions: this.paginationOptions ? { ...this.paginationOptions } : undefined,
      issues: cloneDeep(issues),
    });
  }

  private restoreCachedProjectIssues(projectId: string, generation: number): boolean {
    const cached = this.linearProjectIssueCache.get(projectId);
    if (!cached || !cached.issues?.length) {
      if (cached) this.linearProjectIssueCache.delete(projectId);
      return false;
    }

    this.rootIssueStore.issues.addIssue(cached.issues);

    const displayFilters = this.issueFilterStore?.getIssueFilters(projectId)?.displayFilters;
    const groupedIssueIds = this.normalizeLinearProjectGroupedIssueIds(
      cloneDeep(cached.groupedIssueIds)
    ) as TGroupedIssues;

    if (
      !hasLinearGroupedIssueData(
        groupedIssueIds,
        displayFilters?.layout,
        displayFilters?.group_by as GroupByColumnTypes | null
      ) ||
      !this.hasResolvedProjectIssuesInMap(groupedIssueIds, projectId)
    ) {
      this.linearProjectIssueCache.delete(projectId);
      return false;
    }

    runInAction(() => {
      this.groupedIssueIds = groupedIssueIds;
      this.groupedIssueCount = cloneDeep(cached.groupedIssueCount);
      this.issuePaginationData = cloneDeep(cached.issuePaginationData);
      this.paginationOptions = cached.paginationOptions ? { ...cached.paginationOptions } : undefined;
      this.commitProjectLoad(projectId, generation);
      this.setLoader(undefined);
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
      activeProjectId: observable,
      activeGeneration: observable,
      loadedGeneration: observable,
      fetchIssues: action,
      fetchNextIssues: action,
      fetchIssuesWithExistingPagination: action,
      snapshotBeforeLinearNavigation: action,

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

    if (!isLinearMode) {
      return this.runLegacyFetchIssues(workspaceSlug, projectId, loadType, options, isExistingPaginationOptions);
    }

    if (!isExistingPaginationOptions) {
      this.activateProject(projectId);
    }

    const generation = this.activeGeneration;

    if (this.isProjectDataReady(projectId)) {
      return;
    }

    const inflight = this.linearInflightFetch;
    if (
      inflight &&
      inflight.projectId === projectId &&
      inflight.generation === generation &&
      !isExistingPaginationOptions
    ) {
      return inflight.promise;
    }

    const fetchPromise = this.runLinearFetchIssues(
      workspaceSlug,
      projectId,
      loadType,
      options,
      isExistingPaginationOptions,
      generation
    );

    if (!isExistingPaginationOptions) {
      this.linearInflightFetch = { projectId, generation, promise: fetchPromise };
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
    const isProjectSwitch = this.loadedProjectId !== null && this.loadedProjectId !== projectId;
    const sequence = this.beginFetch(
      loadType,
      !isExistingPaginationOptions,
      !isProjectSwitch && !!this.groupedIssueIds
    );

    try {
      const params = this.issueFilterStore?.getFilterParams(options, projectId, undefined, undefined, undefined);
      const response = await this.issueService.getIssues(workspaceSlug, projectId, params, {
        signal: this.controller.signal,
      });

      if (this.isStaleFetch(sequence)) return;

      this.onfetchIssues(response, options, workspaceSlug, projectId, undefined, !isExistingPaginationOptions);
      runInAction(() => {
        this.loadedProjectId = projectId;
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
    isExistingPaginationOptions: boolean,
    generation: number
  ) => {
    const hasCommittedSnapshot = this.isProjectDataReady(projectId);
    this.beginFetch(loadType, !isExistingPaginationOptions, hasCommittedSnapshot);

    try {
      const params = this.issueFilterStore?.getFilterParams(options, projectId, undefined, undefined, undefined);
      const response = await this.issueService.getIssues(workspaceSlug, projectId, params, {
        signal: undefined,
      });

      if (!this.isFetchGenerationCurrent(projectId, generation)) {
        return;
      }

      this.onfetchIssues(response, options, workspaceSlug, projectId, undefined, !isExistingPaginationOptions);

      runInAction(() => {
        const normalized = this.normalizeLinearProjectGroupedIssueIds(
          this.groupedIssueIds as TGroupedIssues
        ) as TGroupedIssues;
        this.groupedIssueIds = normalized;

        if (!this.canCommitLinearProjectLoad(projectId, normalized)) {
          this.setLoader("init-loader");
          return;
        }

        this.commitProjectLoad(projectId, generation);
        this.setLoader(undefined);
      });

      if (this.isProjectDataReady(projectId)) {
        this.cacheCurrentProjectIssues(projectId);
      }
      return response;
    } catch (error) {
      if (!this.isFetchGenerationCurrent(projectId, generation) || this.isAbortError(error)) {
        return;
      }
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

    const generation = this.activeGeneration;
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

      if (isLinearReadOnly()) {
        if (!this.isFetchGenerationCurrent(projectId, generation)) return;
      } else if (this.isStaleFetch(sequence)) {
        return;
      }

      // after the next page of issues are fetched, call the base method to process the response
      this.onfetchNexIssues(response, groupId, subGroupId);
      return response;
    } catch (error) {
      if (isLinearReadOnly()) {
        if (!this.isFetchGenerationCurrent(projectId, generation) || this.isAbortError(error)) return;
      } else if (this.isStaleFetch(sequence) || this.isAbortError(error)) {
        return;
      }
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
