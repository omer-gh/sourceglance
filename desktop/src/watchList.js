// Limit repositories & boards → Watch repositories: which github.com repositories the lists show
// (the `repositories` setting; empty means all), the same as Ubuntu's (src/window/pages/
// accountAccess.js) with the rules in src/shared/repoAccess.js: switching one off from "all" lists
// the rest, listing everything goes back to empty, the last one can't be switched off, and adding
// keeps what's watched. One collapsible group per organization, with a switch for all of it.
import {parseRepoList} from '@shared/model.js';
import {
    MAX_PAGES,
    addWatched,
    availableRepos,
    isWatched,
    mayHaveMore,
    parseRepos,
    parseSearchRepos,
    reposByOrganization,
    reposRequest,
    searchReposRequest,
    setWatched,
} from '@shared/repoAccess.js';

import {ICONS, element, iconNode} from './views.js';

/**
 * A collapsible group (<details>) titled by an organization, with its count and a switch for all
 * of its rows. Returns {group, body, master, count}.
 */
export function accordion(title, label) {
    const master = element('input', {className: 'switch', attrs: {'type': 'checkbox', 'role': 'switch', 'aria-label': label}});
    // The switch works on its own: clicking it doesn't open or close the group.
    master.addEventListener('click', event => event.stopPropagation());
    const count = element('span', {className: 'count'});
    const chevron = iconNode(ICONS.chevron);
    chevron.classList.add('chevron');
    // A grid, as on Ubuntu: chevron, title, then the count and the switch in fixed columns.
    const summary = element('summary', {}, [chevron, element('span', {className: 'title', text: title}), count, master]);
    const body = element('ul', {className: 'rows'});
    const group = element('details', {className: 'accordion'}, [summary, body]);
    return {group, body, master, count};
}

/** A row with a title, an optional line under it, and a switch. */
export function switchRow(title, subtitle, checked, label, onChange) {
    const box = element('input', {className: 'switch', attrs: {'type': 'checkbox', 'role': 'switch', 'aria-label': label}});
    box.checked = checked;
    box.addEventListener('change', () => onChange(box.checked, box));
    const text = element('span', {className: 'who'}, [element('span', {text: title}),
        ...subtitle ? [element('small', {text: subtitle})] : []]);
    return element('li', {}, [element('label', {}, [text, box])]);
}

export class WatchList {
    /** `seenRepos()` lists the repositories seen on github.com items; `names` is a DisplayNames. */
    constructor({settings, clients, names, seenRepos}) {
        this._settings = settings;
        this._clients = clients;
        this._names = names;
        this._seenRepos = seenRepos;
        // The repositories each github.com sign-in can see, asked once per account this session.
        this._available = new Map();
    }

    _watched() {
        return this._settings.get('repositories', []) ?? [];
    }

    // Up to three pages of the repositories a sign-in can see (read-only).
    _repos(account) {
        if (!this._available.has(account.id)) {
            this._available.set(account.id, (async () => {
                const found = [];
                try {
                    const token = await this._clients.tokenFor(account);
                    const client = token ? this._clients.clientFor(account) : null;
                    for (let page = 1; client && page <= MAX_PAGES; page++) {
                        const json = await client.send(token, reposRequest(page));
                        found.push(...parseRepos(json));
                        if (!mayHaveMore(json))
                            break;
                    }
                } catch {
                    // What the lists have seen is still offered.
                }
                return found;
            })());
        }
        return this._available.get(account.id);
    }

    /**
     * Draws the section for `account` into `container`: a search for public repositories, then one
     * group per organization. Returns a function that stops listening for changes.
     */
    render(account, container) {
        const search = element('input', {className: 'search', attrs: {'type': 'search', 'spellcheck': 'false',
            'placeholder': 'Find a public repository to add', 'aria-label': 'Find a public repository to add'}});
        search.disabled = true;
        const results = element('ul', {className: 'results'});
        const groups = element('div', {className: 'groups'}, [element('p', {className: 'hint', text: 'Loading…'})]);
        container.replaceChildren(search, results, groups);

        let all = [];
        const known = repo => all.some(other => other.toLowerCase() === repo.toLowerCase());
        const save = next => this._settings.set('repositories', next)
            .catch(e => console.error('sourceglance: saving the watch list failed', e));

        // Each organization's group stays open or closed across redraws.
        const open = new Set();
        const draw = () => {
            const watched = this._watched();
            if (all.length === 0) {
                groups.replaceChildren(element('p', {className: 'hint', text: 'No repositories found'}));
                return;
            }
            groups.replaceChildren(...reposByOrganization(all).map(({organization, repos}) => {
                const on = repos.filter(repo => isWatched(watched, repo)).length;
                const title = this._names.label(account, organization);
                const {group, body, master, count} = accordion(title, `Watch all repositories of ${organization}`);
                group.open = open.has(organization.toLowerCase());
                group.addEventListener('toggle', () => {
                    if (group.open)
                        open.add(organization.toLowerCase());
                    else
                        open.delete(organization.toLowerCase());
                });
                count.textContent = `${on}/${repos.length}`;
                master.checked = on > 0;
                master.addEventListener('change', () => save(setWatched(this._watched(), all, repos, master.checked)));
                body.replaceChildren(...repos.map(repo => switchRow(repo, '', isWatched(watched, repo), `Watch ${repo}`, (checked, box) => {
                    const next = setWatched(this._watched(), all, [repo], checked);
                    // A change the list refused (the last ones can't go off) puts the switch back.
                    if (next === this._watched())
                        box.checked = !checked;
                    else
                        save(next);
                })));
                return group;
            }));
        };

        const addRepos = repos => {
            const fresh = repos.filter(repo => !known(repo));
            if (fresh.length === 0)
                return;
            const next = addWatched(this._watched(), all, fresh);
            all = availableRepos([...all, ...fresh]);
            save(next);
        };

        // Searches GitHub 0.4 s after you stop typing, from two characters; an older answer never
        // replaces a newer one. It finds public repositories to add; it doesn't filter the list.
        let query = 0;
        let timer = null;
        const showResults = found => results.replaceChildren(...found.map(({name, description, stars}) => {
            const add = element('button', {className: 'flat', text: known(name) ? 'Added' : 'Add', attrs: {type: 'button'}});
            add.disabled = known(name);
            add.addEventListener('click', () => {
                addRepos([name]);
                add.textContent = 'Added';
                add.disabled = true;
            });
            return element('li', {}, [
                element('span', {className: 'who'}, [element('span', {text: name}),
                    element('small', {text: [stars > 0 ? `★ ${stars.toLocaleString()}` : '', description].filter(Boolean).join(' · ')})]),
                add,
            ]);
        }));
        search.addEventListener('input', () => {
            clearTimeout(timer);
            const text = search.value.trim();
            const mine = ++query;
            if (text.length < 2) {
                showResults([]);
                return;
            }
            timer = setTimeout(async () => {
                let found;
                try {
                    const token = await this._clients.tokenFor(account);
                    const client = token ? this._clients.clientFor(account) : null;
                    found = client ? parseSearchRepos(await client.send(token, searchReposRequest(text))) : [];
                } catch {
                    found = [];
                }
                if (mine === query)
                    showResults(found);
            }, 400);
        });
        // A full owner/name you type is added on Enter, without waiting for a search.
        search.addEventListener('keydown', event => {
            if (event.key !== 'Enter')
                return;
            event.preventDefault();
            const {repos, invalid} = parseRepoList(search.value);
            if (invalid.length > 0 || repos.length === 0)
                return;
            addRepos(repos);
            search.value = '';
            showResults([]);
        });

        const stop = this._settings.connect(key => {
            if (key === 'repositories')
                draw();
        });
        (async () => {
            const found = await this._repos(account);
            // Repositories already on the list that this sign-in doesn't show (a public one) are here too.
            all = availableRepos(found, [...this._seenRepos(), ...this._watched()]);
            search.disabled = false;
            draw();
        })();
        return () => {
            stop();
            clearTimeout(timer);
            query++;
        };
    }
}
