// Loads one GitLab account's lists in one go, for the top bar (extension.js) and the window
// (window/data.js), through accountStore.js. The result uses the same field names as
// GitHub's, so views and counts can treat both alike.
import {isCancelled} from './cancellation.js';
import {mergeItems} from './model.js';

/**
 * @returns {Promise<object>} {status: 'signed-out'} or {status: 'ready', login, updatedAt,
 *   issues, prs, issueTotal, prTotal, closedCounts}. Throws on API errors. With `team`, the
 *   lists also hold the team's open items (reason 'team'); the totals stay yours.
 */
export async function loadGitLab(client, {team = false} = {}, cancellable = null) {
    const token = await client.accessToken(cancellable);
    if (!token)
        return {status: 'signed-out'};
    const viewer = await client.getViewer(token, cancellable);
    const [issues, assigned, review, teamItems] = await Promise.all([
        client.list(token, 'issue', null, cancellable),
        client.list(token, 'mr-assigned', null, cancellable),
        client.list(token, 'mr-review', viewer.username, cancellable),
        team ? client.listTeam(token, cancellable).catch(e => {
            if (isCancelled(e))
                throw e;
            return null;
        }) : null,
    ]);
    for (const item of review.items)
        item.reviewer = viewer.username;
    let closedCounts = {issues: null, prs: null};
    try {
        closedCounts = await client.closedCounts(token, cancellable);
    } catch (e) {
        if (isCancelled(e))
            throw e;
    }
    const myPrs = mergeItems(assigned.items, review.items);
    return {
        status: 'ready',
        login: viewer.username,
        updatedAt: new Date(),
        // Yours first: a copy the team list also has keeps why it's yours.
        issues: mergeItems(issues.items, teamItems?.issues ?? []),
        issueTotal: issues.total,
        prs: mergeItems(myPrs, teamItems?.prs ?? []),
        // Results past the first page of either MR list aren't in `myPrs`.
        prTotal: myPrs.length + Math.max(0, assigned.total - assigned.items.length) +
            Math.max(0, review.total - review.items.length),
        closedCounts,
        error: null,
    };
}
