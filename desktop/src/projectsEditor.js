// Settings → Projects, the same as Ubuntu's (src/window/pages/projectsPanel.js): your projects,
// each with its repositories as chips. There is no edit mode: press the pencil by a project's
// title to rename it in place (Enter or leaving the box saves, Escape puts the old name back), and
// drag a repository chip onto any project to move it. Every change is saved at once; a project
// made from repositories that has none left goes with its last one, and projects from a platform
// (a GitHub Project board) stay. A project made of repositories has a trash button that disbands it,
// after asking. Reset (in the ⋯ menu) builds them again from the defaults, after asking.
import {cleanProjectName, projectKey, repoKey} from '@shared/projects.js';

import {ICONS, element, iconNode} from './views.js';

export class ProjectsEditor {
    /** `store` is a ProjectStore; `notify(text)` shows a short message. */
    constructor({store, list, note, more, resetBox, resetYes, resetCancel, notify}) {
        this._store = store;
        this._list = list;
        this._note = note;
        this._notify = notify;
        // New projects with no repository yet: shown, but saved only once a repository is dropped in.
        this._pending = [];
        // The project whose title is open, by name key.
        this._editing = '';

        more.addEventListener('click', () => {
            resetBox.hidden = !resetBox.hidden;
            more.setAttribute('aria-expanded', String(!resetBox.hidden));
        });
        resetCancel.addEventListener('click', () => {
            resetBox.hidden = true;
            more.setAttribute('aria-expanded', 'false');
        });
        resetYes.addEventListener('click', async () => {
            resetBox.hidden = true;
            more.setAttribute('aria-expanded', 'false');
            this._pending = [];
            await this._store.reset();
            this._notify('Projects reset to the defaults');
        });
        // New repositories seen, or a project changed elsewhere: show them, unless a title is open.
        store.connectChanged(() => {
            if (!this._editing)
                this.render();
        });
    }

    // The saved projects with the pending ones, as copies to change and save.
    _working() {
        return [...this._store.projects(), ...this._pending].map(project => ({...project, repos: [...project.repos]}));
    }

    // Saves a list; what was only pending and now has a repository is saved too, the rest stays pending.
    async _commit(list) {
        const keep = new Set(list.filter(project => project.repos.length === 0 && project.kind !== 'board')
            .map(project => projectKey(project.name)));
        this._pending = list.filter(project => keep.has(projectKey(project.name)) &&
            this._pending.some(pending => projectKey(pending.name) === projectKey(project.name)));
        const removed = await this._store.save(list);
        const lost = removed.filter(name => !this._pending.some(project => projectKey(project.name) === projectKey(name)));
        if (lost.length)
            this._notify(`Removed projects with no repository: ${lost.join(', ')}`);
        this.render();
    }

    _move(repo, target) {
        const list = this._working();
        for (const project of list)
            project.repos = project.repos.filter(other => other !== repo);
        const into = list.find(project => projectKey(project.name) === projectKey(target.name));
        if (!into)
            return;
        into.repos.push(repo);
        into.repos.sort((a, b) => a.localeCompare(b));
        this._commit(list);
    }

    // Takes a project apart: its repositories go back to being projects of their own.
    _disband(project) {
        const list = this._working().filter(other => projectKey(other.name) !== projectKey(project.name));
        for (const repo of project.repos)
            list.push({name: repo, kind: 'repo', repos: [repo]});
        this._pending = this._pending.filter(other => projectKey(other.name) !== projectKey(project.name));
        this._commit(list);
    }

    _rename(project, text) {
        const name = cleanProjectName(text);
        this._editing = '';
        if (!name || projectKey(name) === projectKey(project.name)) {
            // Nothing to change (an unnamed new project is dropped).
            if (!name)
                this._pending = this._pending.filter(other => projectKey(other.name) !== projectKey(project.name));
            this.render();
            return;
        }
        const list = this._working();
        const found = list.find(other => projectKey(other.name) === projectKey(project.name));
        if (found)
            found.name = name;
        // A repeated name joins that project.
        this._pending = this._pending.map(other => (projectKey(other.name) === projectKey(project.name) ? {...other, name} : other));
        this._commit(list);
    }

    _chip(repo) {
        const parent = this._store.parentOf(repo);
        const chip = element('span', {className: 'chip', text: repo, attrs: {
            draggable: 'true',
            title: parent ? `Submodule of ${parent}. Drag to another project` : 'Drag to another project',
        }});
        chip.addEventListener('dragstart', event => {
            event.dataTransfer.setData('text/plain', repo);
            event.dataTransfer.effectAllowed = 'move';
        });
        return chip;
    }

    // The title, with a pencil beside it that swaps the title for a text box.
    _titleLine(project) {
        const line = element('div', {className: 'title'});
        const open = () => {
            this._editing = projectKey(project.name);
            const input = element('input', {attrs: {'type': 'text', 'maxlength': '60', 'aria-label': 'Project name'}});
            input.value = project.name;
            let done = false;
            const finish = text => {
                if (done)
                    return;
                done = true;
                this._rename(project, text);
            };
            input.addEventListener('keydown', event => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    finish(input.value);
                } else if (event.key === 'Escape') {
                    event.preventDefault();
                    finish(project.name);
                }
            });
            input.addEventListener('blur', () => finish(input.value));
            line.replaceChildren(input);
            input.focus();
            input.select();
        };
        const pencil = element('button', {className: 'flat', attrs: {'type': 'button', 'title': 'Rename this project',
            'aria-label': `Rename ${project.name}`}}, [iconNode(ICONS.draft)]);
        pencil.addEventListener('click', open);
        line.append(element('span', {text: project.name}), pencil);
        if (project.kind === 'board')
            line.append(element('small', {text: 'From a platform'}));
        // A project that was just made opens its title right away.
        if (this._editing === projectKey(project.name))
            queueMicrotask(open);
        return line;
    }

    _projectRow(project) {
        const chips = element('div', {className: 'chips'}, project.repos.map(repo => this._chip(repo)));
        if (project.repos.length === 0)
            chips.append(element('span', {className: 'empty', text: 'Drop repositories here'}));
        const end = element('div', {className: 'end'});
        // A repository alone in the project named after it isn't a group: nothing to take apart.
        const grouped = project.kind === 'repo' &&
            !(project.repos.length === 1 && projectKey(project.name) === repoKey(project.repos[0]));
        const content = element('div', {className: 'project'}, [this._titleLine(project), chips]);
        if (grouped) {
            const trash = element('button', {className: 'flat', attrs: {'type': 'button', 'title': 'Disband project',
                'aria-label': `Disband ${project.name}`}}, [iconNode(ICONS.trash)]);
            const confirm = element('div', {className: 'confirm', attrs: {hidden: ''}}, [
                element('p', {}, [element('strong', {text: `Disband “${project.name}”?`}),
                    ' Its repositories become projects of their own again. Nothing is deleted.']),
            ]);
            const cancel = element('button', {text: 'Cancel', attrs: {type: 'button'}});
            const yes = element('button', {className: 'danger', text: 'Disband', attrs: {type: 'button'}});
            confirm.append(element('div', {className: 'row-buttons'}, [cancel, yes]));
            trash.addEventListener('click', () => {
                confirm.hidden = !confirm.hidden;
            });
            cancel.addEventListener('click', () => {
                confirm.hidden = true;
            });
            yes.addEventListener('click', () => this._disband(project));
            end.append(trash);
            content.append(confirm);
        }
        const row = element('li', {}, [content, end]);
        // Drop a chip here to move its repository into this project.
        row.addEventListener('dragover', event => {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            row.classList.add('drop-target');
        });
        row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
        row.addEventListener('drop', event => {
            event.preventDefault();
            row.classList.remove('drop-target');
            const repo = event.dataTransfer.getData('text/plain');
            if (repo)
                this._move(repo, project);
        });
        return row;
    }

    _newProjectRow() {
        const add = element('button', {className: 'flat new-project', attrs: {type: 'button'}}, [iconNode(ICONS.add), 'New project']);
        add.addEventListener('click', () => {
            const all = [...this._store.projects(), ...this._pending];
            let name = 'New project';
            for (let n = 2; all.some(project => projectKey(project.name) === projectKey(name)); n++)
                name = `New project ${n}`;
            this._pending.push({name, kind: 'repo', repos: []});
            this._editing = projectKey(name);
            this.render();
        });
        return element('li', {}, [add]);
    }

    /** Draws the list again, unless a title is being edited. */
    render() {
        if (this._editing && this._list.contains(document.activeElement))
            return;
        const projects = [...this._store.projects(), ...this._pending];
        this._list.replaceChildren(...projects.map(project => this._projectRow(project)), this._newProjectRow());
        this._note.hidden = this._store.submoduleDenied().length === 0;
    }
}
