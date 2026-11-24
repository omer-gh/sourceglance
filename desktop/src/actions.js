// Item actions from the popover: comment, close or reopen, assignees, labels and project
// status. Same flow and requests as src/lib/actions.js on Ubuntu; the dialogs are panels
// inside the popover instead of GNOME dialogs. Every change runs as the item's account.
import {accountForItem} from '@shared/accounts.js';
import {assigneeChoices, itemKey, itemRef, labelChoices, moveStatusRequest} from '@shared/model.js';
import {assigneeRequests, closeReasons, closeRequests, commentRequests, labelRequests, reopenRequests} from '@shared/requests.js';
import {ApiError} from './platform/http.js';
import {LOCAL_NETWORK_TEXT, element} from './views.js';

// Repository labels and assignable users change rarely; fetch them again after this long.
const LIST_CACHE_MS = 5 * 60 * 1000;

function itemText(item) {
    return item.kind === 'draft' ? item.title : `${itemRef(item)} ${item.title}`;
}

function forbiddenText(item) {
    if (item?.platform === 'gitlab')
        return `Your GitLab account can’t change this in ${item.repo}.`;
    if (item?.repo)
        return `Source Glance can’t change ${item.repo}: the Source Glance app isn’t installed there, or you don’t have permission. Make the change on GitHub, or ask the owner to install the app.`;
    return 'Your sign-in can’t change this.';
}

export function actionErrorText(error, item = null) {
    if (!(error instanceof ApiError))
        return `Something went wrong: ${error?.message ?? error}`;
    switch (error.kind) {
    case 'auth':
        return 'Your sign-in was rejected. Sign in again in Settings.';
    case 'signed-out':
        return 'The account this came from is no longer signed in.';
    case 'insecure':
        return 'This instance uses plain http:// and isn’t on your local network now, so Source Glance won’t send your sign-in to it.';
    case 'local-network':
        return LOCAL_NETWORK_TEXT;
    case 'forbidden':
        return forbiddenText(item);
    case 'not-found':
        return 'It no longer exists, or your sign-in can’t see it.';
    case 'gone':
        return 'Issues are turned off in this repository.';
    case 'query':
        return 'GitHub didn’t accept this change.';
    case 'rate-limit':
        return 'GitHub rate limit reached. Try again later.';
    case 'network':
        return 'Couldn’t reach GitHub. Check your connection.';
    default:
        return `GitHub returned an error (HTTP ${error.status}).`;
    }
}

const CLOSE_LABELS = {
    not_planned: 'Close as not planned',
    completed: 'Close as completed',
};

export class Actions {
    /**
     * `store` has the accounts, clients and busy state. `showPanel(node)` shows a dialog panel
     * (null hides it), `notify(text)` a short message.
     */
    constructor({store, showPanel, notify}) {
        this._store = store;
        this._showPanel = showPanel;
        this._notify = notify;
        this._cache = new Map();
    }

    _account(item) {
        return this._store.accounts.find(account => account.id === accountForItem(item)) ?? null;
    }

    async _session(item) {
        const account = this._account(item);
        const token = account ? await this._store.clients.tokenFor(account) : null;
        if (!token)
            throw new ApiError({kind: account ? 'auth' : 'signed-out', status: 401, retryAt: null});
        return {client: this._store.clients.clientFor(account), token};
    }

    /** `arg` is the project board for 'status'. */
    run(item, action, arg = null) {
        switch (action) {
        case 'comment':
            this._comment(item);
            break;
        case 'close':
            this._close(item);
            break;
        case 'reopen':
            this._send(item, reopenRequests(item), 'Reopened');
            break;
        case 'assignees':
            this._pickAssignees(item);
            break;
        case 'labels':
            this._pickLabels(item);
            break;
        case 'status':
            this._pickStatus(item, arg);
            break;
        }
    }

    _panel(title, item, body, buttons) {
        const panel = element('form', {className: 'panel', attrs: {'aria-label': title}}, [
            element('h2', {text: title}),
            element('p', {className: 'panel-item', text: itemText(item)}),
            ...body,
            element('div', {className: 'panel-buttons'}, buttons),
        ]);
        panel.addEventListener('submit', event => event.preventDefault());
        this._showPanel(panel);
        panel.querySelector('textarea, input, button:not(.cancel)')?.focus();
        return panel;
    }

    _button(text, onClick, {primary = false, cancel = false} = {}) {
        const button = element('button', {
            className: [primary ? 'primary' : '', cancel ? 'cancel' : ''].join(' ').trim(),
            text,
            attrs: {type: primary ? 'submit' : 'button'},
        });
        button.addEventListener('click', onClick);
        return button;
    }

    _cancel() {
        return this._button('Cancel', () => this._showPanel(null), {cancel: true});
    }

    _comment(item) {
        const text = element('textarea', {attrs: {'rows': '5', 'aria-label': 'Comment', 'placeholder': 'Write a comment (Markdown)'}});
        const post = this._button('Comment', () => {
            const value = text.value.trim();
            if (!value)
                return;
            this._showPanel(null);
            this._send(item, commentRequests(item, value), 'Comment posted');
        }, {primary: true});
        text.addEventListener('keydown', event => {
            if (event.key === 'Enter' && event.metaKey)
                post.click();
        });
        this._panel('Comment', item, [text], [this._cancel(), post]);
    }

    _close(item) {
        const kindName = item.kind === 'pr' ? (item.platform === 'gitlab' ? 'merge request' : 'pull request') : 'issue';
        const buttons = closeReasons(item).map((reason, index, all) => this._button(
            CLOSE_LABELS[reason] ?? `Close ${kindName}`,
            () => {
                this._showPanel(null);
                this._send(item, closeRequests(item, reason), 'Closed');
            },
            {primary: index === all.length - 1}));
        this._panel(`Close this ${kindName}?`, item, [], [this._cancel(), ...buttons]);
    }

    /** A checklist (or a single choice) with Apply. */
    _picker({title, item, options, selected, single = false, emptyText, onApply}) {
        const name = `pick-${Date.now()}`;
        const list = element('div', {className: 'picker'});
        if (options.length === 0)
            list.append(element('p', {className: 'message', text: emptyText}));
        for (const option of options) {
            const input = element('input', {attrs: {type: single ? 'radio' : 'checkbox', name, value: option.id}});
            input.checked = selected.includes(option.id);
            list.append(element('label', {className: 'pick'}, [input, element('span', {text: option.label})]));
        }
        const apply = this._button('Apply', () => {
            const wanted = [...list.querySelectorAll('input:checked')].map(input => input.value);
            this._showPanel(null);
            onApply(wanted);
        }, {primary: true});
        apply.disabled = options.length === 0;
        this._panel(title, item, [list], [this._cancel(), apply]);
    }

    _pickStatus(item, board) {
        this._picker({
            title: `Move on ${board.title}`,
            item,
            options: board.options.map(option => ({id: option.id, label: option.name})),
            selected: board.optionId ? [board.optionId] : [],
            single: true,
            emptyText: 'This board’s Status field has no options.',
            onApply: ([optionId]) => {
                if (!optionId || optionId === board.optionId)
                    return;
                const name = board.options.find(option => option.id === optionId)?.name ?? '';
                this._send(item, [moveStatusRequest(board, optionId)], `Moved to ${name}`);
            },
        });
    }

    async _cachedList(kind, item, fetch) {
        const key = `${accountForItem(item)}\n${kind}:${item.repo}`;
        const hit = this._cache.get(key);
        if (hit && Date.now() - hit.at < LIST_CACHE_MS)
            return hit.list;
        const list = await fetch();
        this._cache.set(key, {at: Date.now(), list});
        return list;
    }

    async _pickAssignees(item) {
        // GitLab assigns by user id, so keep its members ({id, username}) for the request.
        const gitlab = item.platform === 'gitlab';
        const members = await this._load(item, ({client, token}) => this._cachedList('assignees', item,
            () => gitlab
                ? client.listMembers(token, item.projectId)
                : client.listAssignable(token, item.repo).then(logins => logins.map(username => ({username})))));
        if (!members)
            return;
        const me = this._account(item)?.login ?? null;
        const all = assigneeChoices(item, me, members.map(member => member.username));
        this._picker({
            title: 'Assignees',
            item,
            options: all.map(login => ({id: login, label: login === me ? `${login} (you)` : login})),
            selected: item.assignees,
            emptyText: 'Nobody can be assigned in this repository.',
            onApply: wanted => this._send(item, assigneeRequests(item, wanted, members), 'Assignees updated'),
        });
    }

    async _pickLabels(item) {
        const labels = await this._load(item, ({client, token}) => this._cachedList('labels', item,
            () => item.platform === 'gitlab' ? client.listLabels(token, item.projectId) : client.listLabels(token, item.repo)));
        if (!labels)
            return;
        this._picker({
            title: 'Labels',
            item,
            options: labelChoices(item, labels).map(name => ({id: name, label: name})),
            selected: item.labels.map(label => label.name),
            emptyText: 'This repository has no labels.',
            onApply: wanted => this._send(item, labelRequests(item, wanted), 'Labels updated'),
        });
    }

    /** Fetches what a dialog needs, with the item marked busy. Resolves to null on failure. */
    async _load(item, fetch) {
        const key = itemKey(item);
        this._store.setBusy(key, true);
        try {
            return await fetch(await this._session(item));
        } catch (e) {
            if (e?.name !== 'AbortError')
                this._notify(actionErrorText(e, item));
            return null;
        } finally {
            this._store.setBusy(key, false);
        }
    }

    /** Sends requests in order and stops at the first failure, then reloads the lists. */
    async _send(item, requests, doneText) {
        if (requests.length === 0)
            return;
        const key = itemKey(item);
        this._store.setBusy(key, true);
        try {
            const {client, token} = await this._session(item);
            for (const request of requests)
                await client.send(token, request);
            this._notify(`${doneText}: ${itemText(item)}`);
        } catch (e) {
            if (e?.name !== 'AbortError')
                this._notify(actionErrorText(e, item));
        } finally {
            this._store.setBusy(key, false);
            // Part of a multi-request change may have landed either way; show what's there now.
            await this._store.refresh();
        }
    }
}
