/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// plane imports
import type { E_SORT_ORDER, TActivityFilters, EActivityFilterType } from "@plane/constants";
import { BASE_ACTIVITY_FILTER_TYPES, filterActivityOnSelectedFilters } from "@plane/constants";
import type { TCommentsOperations, TIssueComment } from "@plane/types";
// components
import { CommentCard } from "@/components/comments/card/root";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { buildLinearCommentThreads, isLinearDisplayMode } from "@/helpers/linear-display.helper";
// local imports
import { IssueActivityItem } from "./activity/activity-list";
import { IssueActivityLoader } from "./loader";

type TIssueActivityCommentRoot = {
  workspaceSlug: string;
  projectId: string;
  isIntakeIssue: boolean;
  issueId: string;
  selectedFilters: TActivityFilters[];
  activityOperations: TCommentsOperations;
  showAccessSpecifier?: boolean;
  disabled?: boolean;
  sortOrder: E_SORT_ORDER;
};

type TCommentCardRenderProps = {
  comment: TIssueComment;
  ends: "top" | "bottom" | undefined;
  isReply?: boolean;
};

export const IssueActivityCommentRoot = observer(function IssueActivityCommentRoot(props: TIssueActivityCommentRoot) {
  const {
    workspaceSlug,
    isIntakeIssue,
    issueId,
    selectedFilters,
    activityOperations,
    showAccessSpecifier,
    projectId,
    disabled,
    sortOrder,
  } = props;
  // store hooks
  const {
    activity: { getActivityAndCommentsByIssueId },
    comment: { getCommentById, getCommentsByIssueId },
  } = useIssueDetail();
  // derived values
  const activityAndComments = getActivityAndCommentsByIssueId(issueId, sortOrder);

  if (!activityAndComments) return <IssueActivityLoader />;

  if (activityAndComments.length <= 0) return null;

  const filteredActivityAndComments = filterActivityOnSelectedFilters(activityAndComments, selectedFilters);

  const renderCommentCard = ({ comment, ends, isReply = false }: TCommentCardRenderProps) => (
    <div key={comment.id} className={isReply ? "ml-9 border-l border-subtle pl-3" : undefined}>
      <CommentCard
        workspaceSlug={workspaceSlug}
        entityId={issueId}
        comment={comment}
        activityOperations={activityOperations}
        ends={ends}
        showAccessSpecifier={!!showAccessSpecifier}
        showCopyLinkOption={!isIntakeIssue}
        disabled={disabled}
        projectId={projectId}
        enableReplies={false}
      />
    </div>
  );

  if (isLinearDisplayMode()) {
    const commentIds = getCommentsByIssueId(issueId) ?? [];
    const comments = commentIds
      .map((commentId) => getCommentById(commentId))
      .filter((comment): comment is TIssueComment => !!comment);
    const visibleCommentIds = new Set(
      filteredActivityAndComments.filter((item) => item.activity_type === "COMMENT").map((item) => item.id)
    );
    const visibleComments = comments.filter((comment) => visibleCommentIds.has(comment.id));
    const { roots, childrenByParent } = buildLinearCommentThreads(visibleComments, commentIds);

    const nonCommentItems = filteredActivityAndComments.filter((item) => item.activity_type !== "COMMENT");

    return (
      <div>
        {nonCommentItems.map((activityComment, index) =>
          BASE_ACTIVITY_FILTER_TYPES.includes(activityComment.activity_type as EActivityFilterType) ? (
            <IssueActivityItem
              key={activityComment.id}
              activityId={activityComment.id}
              ends={index === 0 ? "top" : index === nonCommentItems.length - 1 ? "bottom" : undefined}
            />
          ) : null
        )}
        {roots.map((root, rootIndex) => {
          const replies = childrenByParent.get(root.id) ?? [];
          const isLastRoot = rootIndex === roots.length - 1;
          return (
            <div key={root.id}>
              {renderCommentCard({
                comment: root,
                ends: rootIndex === 0 && nonCommentItems.length === 0 ? "top" : undefined,
              })}
              {replies.map((reply, replyIndex) =>
                renderCommentCard({
                  comment: reply,
                  isReply: true,
                  ends: isLastRoot && replyIndex === replies.length - 1 ? "bottom" : undefined,
                })
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div>
      {filteredActivityAndComments.map((activityComment, index) => {
        const comment = getCommentById(activityComment.id);
        return activityComment.activity_type === "COMMENT" ? (
          <CommentCard
            key={activityComment.id}
            workspaceSlug={workspaceSlug}
            entityId={issueId}
            comment={comment}
            activityOperations={activityOperations}
            ends={index === 0 ? "top" : index === filteredActivityAndComments.length - 1 ? "bottom" : undefined}
            showAccessSpecifier={!!showAccessSpecifier}
            showCopyLinkOption={!isIntakeIssue}
            disabled={disabled}
            projectId={projectId}
            enableReplies
          />
        ) : BASE_ACTIVITY_FILTER_TYPES.includes(activityComment.activity_type as EActivityFilterType) ? (
          <IssueActivityItem
            key={activityComment.id}
            activityId={activityComment.id}
            ends={index === 0 ? "top" : index === filteredActivityAndComments.length - 1 ? "bottom" : undefined}
          />
        ) : null;
      })}
    </div>
  );
});
