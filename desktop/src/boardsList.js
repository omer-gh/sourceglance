// Limit repositories & boards → Project boards: every project board of a GitHub account, one
// collapsible group per organization or user that owns it, with a switch for all of its boards,
// as in Ubuntu's (src/window/pages/accountAccess.js). Hidden boards (the `hidden-boards` setting,
// by address) leave the popovers, the window and the menu-bar counts alike.
import {boardKey, boardOwner, setHiddenBoards} from '@shared/projects.js';

import {element} from './views.js';
import {accordion, switchRow} from './watchList.js';

export class BoardsList {
    /** `names` is a DisplayNames, for the owners' names. */
    constructor({settings, names}) {
        this._settings = settings;
        this._names = names;
    }

    _hidden() {
        return this._settings.get('hidden-boards', []) ?? [];
    }

    _save(keys, hide) {
        this._settings.set('hidden-boards', setHiddenBoards(this._hidden(), keys, hide))
            .catch(e => console.error('sourceglance: saving hidden boards failed', e));
    }

    /**
     * Draws `source`'s boards (its full list, hidden ones too) into `container`. Returns a function
     * that stops listening for changes.
     */
    render(account, source, container) {
        const open = new Set();
        const draw = () => {
            const boards = source?.allBoards ?? [];
            if (boards.length === 0) {
                container.replaceChildren(element('p', {className: 'hint', text: source?.boardsError
                    ? 'Can’t read the project boards of this account. Organization boards need the Source Glance app installed on the organization.'
                    : 'No project boards found'}));
                return;
            }
            const hidden = this._hidden();
            const owners = new Map();
            for (const board of boards) {
                const login = boardOwner(board);
                if (!owners.has(login.toLowerCase()))
                    owners.set(login.toLowerCase(), {login, boards: []});
                owners.get(login.toLowerCase()).boards.push(board);
            }
            container.replaceChildren(...[...owners.values()].sort((a, b) => a.login.localeCompare(b.login)).map(({login, boards: own}) => {
                const keys = own.map(board => boardKey(board));
                const shown = keys.filter(key => !hidden.includes(key)).length;
                const title = login ? this._names.label(account, login) : 'Other boards';
                const {group, body, master, count} = accordion(title, `Show all project boards of ${title}`);
                group.open = open.has(login.toLowerCase());
                group.addEventListener('toggle', () => {
                    if (group.open)
                        open.add(login.toLowerCase());
                    else
                        open.delete(login.toLowerCase());
                });
                count.textContent = `${shown}/${keys.length}`;
                master.checked = shown > 0;
                master.addEventListener('change', () => this._save(keys, !master.checked));
                body.replaceChildren(...own.map(board => switchRow(board.title, board.url ? board.url.replace(/^https:\/\//, '') : '',
                    !hidden.includes(boardKey(board)), `Show ${board.title}`, checked => this._save([boardKey(board)], !checked))));
                return group;
            }));
        };
        draw();
        return this._settings.connect(key => {
            if (key === 'hidden-boards')
                draw();
        });
    }
}
