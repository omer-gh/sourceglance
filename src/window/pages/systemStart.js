// Settings → Startup: starting with your session and the app icon, on a page of its own.
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';

import {gettext as _} from '../i18n.js';

/** `ctx` is {settings}. Returns the page. */
export function buildStartupPage({settings}) {
    const page = new Adw.PreferencesPage();
    const startup = new Adw.PreferencesGroup({title: _('Startup')});
    const autostartRow = new Adw.SwitchRow({
        title: _('Start automatically'),
        subtitle: _('Show Source Glance in the top bar when you log in'),
    });
    settings.bind('start-automatically', autostartRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    startup.add(autostartRow);

    const launcherRow = new Adw.SwitchRow({
        title: _('Show in app grid'),
        subtitle: _('An app icon that starts Source Glance and opens this window'),
    });
    settings.bind('app-launcher', launcherRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    startup.add(launcherRow);
    page.add(startup);
    return page;
}
