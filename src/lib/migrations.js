// One-time changes to saved settings when a name changes (docs/naming.md → Saved values).
// Each one is safe to run on every start: it writes only what still has the old name.
import GLib from 'gi://GLib';

import {renameLegacyBoards} from './model.js';

const ID_LISTS = ['toolbar-buttons', 'widgets', 'widgets-off-desktop', 'collapsed-groups', 'collapsed-sections'];
// Settings keyed by widget id, with the type of their value.
const ID_MAPS = {'widget-opacities': 'a{si}', 'widget-sizes': 'a{ss}', 'widget-layout': 'a{s(ii)}', 'widget-positions': 'a{s(ii)}'};

/** Projects → Project Boards: the stored list id `projects` becomes `boards`. */
export function migrateBoardsRename(settings) {
    for (const key of ID_LISTS) {
        const old = settings.get_strv(key);
        const next = [...new Set(old.map(renameLegacyBoards))];
        if (next.length !== old.length || next.some((id, i) => id !== old[i]))
            settings.set_strv(key, next);
    }
    for (const [key, type] of Object.entries(ID_MAPS)) {
        const old = settings.get_value(key).recursiveUnpack();
        if (!Object.hasOwn(old, 'projects'))
            continue;
        const next = {};
        for (const [id, value] of Object.entries(old))
            next[renameLegacyBoards(id)] = value;
        settings.set_value(key, new GLib.Variant(type, next));
    }
    const widgets = settings.get_strv('custom-widgets');
    const renamed = widgets.map(text => {
        try {
            const def = JSON.parse(text);
            if (def?.kind !== 'projects' && def?.icon !== 'projects')
                return text;
            return JSON.stringify({...def, kind: renameLegacyBoards(def.kind), icon: renameLegacyBoards(def.icon)});
        } catch {
            return text;
        }
    });
    if (renamed.some((text, i) => text !== widgets[i]))
        settings.set_strv('custom-widgets', renamed);
    const page = settings.get_string('open-page');
    if (page === 'projects')
        settings.set_string('open-page', 'boards');
}
