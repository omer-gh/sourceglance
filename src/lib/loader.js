// Loads everything the lists show, in one go, for the window (window/data.js). Same GitHub
// calls as the top bar's refresh in extension.js; no GNOME Shell imports.
import {isCancelled} from './github.js';
import {mergeItems} from './model.js';

/** A failure that only empties an optional part (closed counts, boards) instead of the lists. */
async function optional(promise, fallback) {
    try {
        return await promise;
    } catch (e) {
        if (isCancelled(e))
            throw e;
        return typeof fallback === 'function' ? fallback(e) : fallback;
    }
}

/**
 * @returns {Promise<object>} {login, issues, issueTotal, prs, prTotal, closedCounts,
 *   boards, boardsError}; items carry `boards` (their project boards). With `team`, the lists
 *   also hold the team's open items (reason 'team'); the totals stay yours.
 */
export async function loadLists(client, token, {repos = [], boards: withBoards = true, team = false} = {}, cancellable = null) {
    const login = await client.getViewer(token, cancellable);
    const [issues, assigned, review, closedIssues, closedPrs, teamItems] = await Promise.all([
        client.search(token, repos, 'issue', cancellable),
        client.search(token, repos, 'pr-assigned', cancellable),
        client.search(token, repos, 'pr-review', cancellable),
        optional(client.countSearch(token, repos, 'issue-closed', cancellable), null),
        optional(client.countSearch(token, repos, 'pr-closed', cancellable), null),
        team ? optional(client.listTeam(token, repos, cancellable), null) : null,
    ]);
    for (const item of review.items)
        item.reviewer = login;
    const myPrs = mergeItems(assigned.items, review.items);
    // Results past the first page of either PR search aren't in `prs`.
    const prTotal = myPrs.length + Math.max(0, assigned.total - assigned.items.length) +
        Math.max(0, review.total - review.items.length);

    // Yours first: a copy the team list also has keeps why it's yours.
    const issueItems = mergeItems(issues.items, teamItems?.issues ?? []);
    const prs = mergeItems(myPrs, teamItems?.prs ?? []);
    const all = [...issueItems, ...prs];
    const itemBoards = await optional(client.getProjectBoards(token, all.map(item => item.nodeId), cancellable), new Map());
    for (const item of all)
        item.boards = itemBoards.get(item.nodeId) ?? [];

    let boards = null;
    let boardsError = null;
    if (withBoards) {
        boards = await optional(client.getViewerBoards(token, cancellable), e => {
            boardsError = e.kind ?? 'unknown';
            return null;
        });
    }

    return {
        login,
        issues: issueItems,
        issueTotal: issues.total,
        prs,
        prTotal,
        closedCounts: {issues: closedIssues, prs: closedPrs},
        boards,
        boardsError,
    };
}
