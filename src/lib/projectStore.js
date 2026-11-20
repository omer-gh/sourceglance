// The projects you defined (lib/projects.js), kept in settings, plus the repositories and
// platform projects seen on loaded items. Names are plain text; nothing is sent to a platform.
import GLib from 'gi://GLib';

import {GITHUB_APP_CLIENT_ID} from './config.js';
import {hostLabel} from './accounts.js';
import {
    buildProjects,
    dropAutomatic,
    gitmodulesRequest,
    normalizeBoardNames,
    normalizeRepoMap,
    parseGitmodules,
    projectNameOf,
    repoKey,
    savedProjects,
    submoduleRepos,
    withSubmodules,
} from './projects.js';

export class ProjectStore {
    constructor(settings, clients) {
        this._settings = settings;
        this._clients = clients;
        this._repos = new Map();
        // Submodule → parent repository, found from each repository's .gitmodules this session.
        this._links = {};
        this._seenBoards = [];
        // Accounts whose sign-in may not read repository files (an answer of 403): their submodules can't be found.
        this._denied = new Set();
        this._checked = new Set();
        this._listeners = [];
        for (const key of ['project-repos', 'project-boards', 'repositories'])
            settings.connect(`changed::${key}`, () => this._notify());
    }

    /** Runs `callback` when a project changed, a new repository was seen, or the watch list changed. */
    connectChanged(callback) {
        this._listeners.push(callback);
    }

    _notify() {
        for (const callback of this._listeners)
            callback();
    }

    /** {repository key: project name} as you saved it. */
    savedRepoMap() {
        return normalizeRepoMap(this._settings.get_value('project-repos').recursiveUnpack());
    }

    /** {repository key: project name}: what you saved, plus the projects submodules join. */
    repoMap() {
        return withSubmodules(this.savedRepoMap(), this._links);
    }

    boardNames() {
        return normalizeBoardNames(this._settings.get_strv('project-boards'));
    }

    /** The project `repo` is in: its saved one, or the repository itself. */
    nameOf(repo) {
        return projectNameOf(repo, this.repoMap());
    }

    /** The submodule's parent repository, or null: shown in the projects under Organizations. */
    parentOf(repo) {
        return this._links[repoKey(repo)] ?? null;
    }

    /** Every repository seen on loaded items this session. */
    seenRepos() {
        return [...this._repos.values()];
    }

    /** Remembers repositories seen on items; tells listeners if any is new. */
    noteRepos(repos) {
        const before = this._repos.size;
        for (const repo of repos) {
            if (typeof repo === 'string' && !this._repos.has(repo.toLowerCase()))
                this._repos.set(repo.toLowerCase(), repo);
        }
        if (this._repos.size > before)
            this._notify();
    }

    /**
     * Reads the .gitmodules of `repos` (once each, on `account`'s platform) so submodules join
     * their parent's project on their own. Read-only; a repository without one just answers 404.
     */
    async discoverSubmodules(account, repos) {
        const todo = repos.filter(repo => repoKey(repo) && !this._checked.has(`${account.id}|${repoKey(repo)}`));
        for (const repo of todo)
            this._checked.add(`${account.id}|${repoKey(repo)}`);
        if (todo.length === 0)
            return;
        // The default GitHub App sign-in deliberately can't read repository files (no code access),
        // so there is nothing to ask: its submodules are grouped by hand.
        if (account.platform === 'github' && account.clientId && account.clientId === GITHUB_APP_CLIENT_ID) {
            if (!this._denied.has(account.id)) {
                this._denied.add(account.id);
                this._notify();
            }
            return;
        }
        let token = null;
        let client = null;
        try {
            token = await this._clients.tokenFor(account);
            client = token ? this._clients.clientFor(account) : null;
        } catch {
            return;
        }
        if (!client)
            return;
        const host = hostLabel(account.base);
        let found = false;
        // A few at a time, so a long list of repositories doesn't flood the platform.
        for (let i = 0; i < todo.length; i += 4) {
            await Promise.all(todo.slice(i, i + 4).map(async repo => {
                try {
                    const json = await client.send(token, gitmodulesRequest(account.platform, repo));
                    if (typeof json?.content !== 'string')
                        return;
                    const text = new TextDecoder().decode(GLib.base64_decode(json.content.replace(/\s/g, '')));
                    for (const child of submoduleRepos(parseGitmodules(text), repo, host)) {
                        if (this._links[repoKey(child)] !== repo) {
                            this._links[repoKey(child)] = repo;
                            found = true;
                        }
                    }
                } catch (e) {
                    // A 404 just means no .gitmodules. A 403 means this sign-in can't read files at all.
                    if (e?.status === 403 && !this._denied.has(account.id)) {
                        this._denied.add(account.id);
                        console.warn(`sourceglance: can't read .gitmodules with the sign-in of ${account.id}: HTTP 403`);
                        found = true;
                    }
                }
            }));
        }
        if (found)
            this._notify();
    }

    /** Accounts whose sign-in can't read repository files (by design for the GitHub App), so their submodules aren't found: [account id]. */
    submoduleDenied() {
        return [...this._denied];
    }

    /** Keeps the names of platform projects seen (e.g. GitHub Project boards), so they stay. */
    noteBoards(names) {
        this._seenBoards = normalizeBoardNames([...this._seenBoards, ...names]);
        const known = this.boardNames();
        const next = normalizeBoardNames([...known, ...names]);
        if (next.length !== known.length)
            this._settings.set_strv('project-boards', next);
    }

    /** Every project to show, by name. */
    projects() {
        // The repositories you watch are projects too, even before any item of theirs has been seen.
        const watched = this._settings.get_strv('repositories');
        return buildProjects({repos: [...this._repos.values(), ...watched], repoMap: this.repoMap(), boardNames: this.boardNames()});
    }

    /**
     * Back to the defaults: every repository is a project of its own, submodules join their
     * parent's, and the platform projects seen this session stay. Drops the projects you made or
     * renamed and the repositories you moved.
     */
    reset() {
        this._settings.set_value('project-repos', new GLib.Variant('a{ss}', {}));
        this._settings.set_strv('project-boards', this._seenBoards);
    }

    /** Saves edited projects; returns the names of the repository projects dropped for having no repository. */
    save(projects) {
        const saved = savedProjects(projects);
        // A submodule left in its parent's project stays automatic: it needs no entry.
        const repoMap = dropAutomatic(saved.repoMap, this._links);
        const {boardNames, removed} = saved;
        this._settings.set_value('project-repos', new GLib.Variant('a{ss}', repoMap));
        this._settings.set_strv('project-boards', boardNames);
        return removed;
    }
}
