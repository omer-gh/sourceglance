// Accounts → an account's Limit repositories & boards, in a panel at the window's right, as on
// Ubuntu (src/window/pages/accountAccess.js): where to widen or narrow what the sign-in can reach
// (GitHub's own page), which repositories the github.com lists watch, and which project boards
// show. All of it is kept in Source Glance's settings; nothing changes on GitHub.
import {GITHUB_COM, accountTitle, githubUrls} from '@shared/accounts.js';
import {appInstallUrl} from '@shared/model.js';
import {GITHUB_APP_SLUG} from '@lib/config.js';

import {openLink} from './platform/tauri.js';
import {isGitHubApp} from './projectStore.js';
import {ICONS, element, iconNode} from './views.js';

export class AccessPanel {
    /** `watchList` and `boardsList` draw the two lists; `sourceOf(account)` gives its loaded lists. */
    constructor({panel, title, subtitle, body, close, watchList, boardsList, sourceOf}) {
        this._panel = panel;
        this._title = title;
        this._subtitle = subtitle;
        this._body = body;
        this._watchList = watchList;
        this._boardsList = boardsList;
        this._sourceOf = sourceOf;
        this._owner = null;
        this._stops = [];
        close.addEventListener('click', () => this.hide());
    }

    /** Opens the panel for `account`, or closes it if it's already open for that account. */
    toggle(account) {
        if (this._owner === account.id) {
            this.hide();
            return;
        }
        this.show(account);
    }

    hide() {
        for (const stop of this._stops)
            stop();
        this._stops = [];
        this._owner = null;
        this._panel.hidden = true;
        this._body.replaceChildren();
    }

    show(account) {
        this.hide();
        this._owner = account.id;
        this._title.textContent = 'Limit repositories & boards';
        this._subtitle.textContent = accountTitle(account);
        const sections = [];

        // What the sign-in can reach is decided on GitHub: first, since it widens everything below.
        const usesApp = isGitHubApp(account);
        const dotCom = account.base === GITHUB_COM;
        const accessUrl = usesApp ? appInstallUrl(GITHUB_APP_SLUG)
            : dotCom ? 'https://github.com/settings/personal-access-tokens' : githubUrls(account.base).newToken.replace(/\/new$/, '');
        if (accessUrl) {
            const link = element('button', {className: 'row link', attrs: {type: 'button'}}, [
                element('span', {className: 'who'}, [
                    element('span', {text: usesApp ? 'Limit or expand the repositories this app can reach' : 'Limit or expand what this token can reach'}),
                    element('small', {text: usesApp ? 'Pick the repositories the Source Glance app may change and, if private, see'
                        : 'Change the token’s repositories and permissions on GitHub'}),
                ]),
                iconNode(ICONS.external),
            ]);
            link.addEventListener('click', () => openLink(accessUrl).catch(e => console.warn('sourceglance: link refused', e)));
            sections.push(element('section', {}, [element('h3', {text: 'Access on GitHub'}), link]));
        }

        // Repositories to watch: github.com only (the lists load other instances in full).
        if (dotCom) {
            const lists = element('div', {className: 'watch'});
            sections.push(element('section', {}, [
                element('h3', {text: 'Watch repositories'}),
                element('p', {className: 'hint', text: 'Choose which repositories show in your lists, and search GitHub for public ones to add. Switch an organization off to stop watching all of its repositories.'}),
                lists,
            ]));
            this._stops.push(this._watchList.render(account, lists));
        }

        const boards = element('div', {className: 'boards'});
        sections.push(element('section', {}, [
            element('h3', {text: 'Project boards'}),
            element('p', {className: 'hint', text: 'Switch an organization off to hide all of its boards, or untick single ones. Hidden boards stay in Source Glance’s settings and nothing changes on GitHub.'}),
            boards,
        ]));
        this._stops.push(this._boardsList.render(account, this._sourceOf(account), boards));

        this._body.replaceChildren(...sections);
        this._panel.hidden = false;
    }

    /** The account whose panel is open, if any. */
    get owner() {
        return this._owner;
    }
}
