// Dev aid: renders Source Glance's window pages to PNG files, from made-up data only. It draws the
// window's own widgets to a picture (nothing on the desktop is captured) and never touches the
// network. Run it through tools/screenshots/run.sh, which points it at the fixture data and an
// isolated settings file.
//   gjs -m tools/screenshots/capture.js OUT_DIR name=page[:group-by] ...
import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';
import System from 'system';

const HERE = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_parent().get_child('src');
const SCHEMA = 'org.gnome.shell.extensions.sourceglance';
const [OUT, ...shots] = System.programArgs;
GLib.mkdir_with_parents(OUT, 0o755);

const sleep = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
    resolve();
    return GLib.SOURCE_REMOVE;
}));

function save(win, name) {
    const paintable = new Gtk.WidgetPaintable({widget: win});
    const width = win.get_width();
    const height = win.get_height();
    const snapshot = new Gtk.Snapshot();
    paintable.snapshot(snapshot, width, height);
    const texture = win.get_native().get_renderer().render_texture(snapshot.to_node(), null);
    texture.save_to_png(`${OUT}/${name}.png`);
    print(`saved ${name}.png (${width}x${height})`);
}

async function drive(app) {
    const source = Gio.SettingsSchemaSource.new_from_directory(GLib.getenv('SG_SCHEMA_DIR'), Gio.SettingsSchemaSource.get_default(), false);
    const settings = new Gio.Settings({settings_schema: source.lookup(SCHEMA, true)});
    const {fillWindow} = await import('../../src/window/app.js');
    const win = new Adw.ApplicationWindow({application: app, title: 'Source Glance'});
    fillWindow(win, {settings, dir: HERE, version: 'screenshots'});
    win.set_default_size(1280, 800);
    win.present();
    await sleep(2500);
    for (const shot of shots) {
        const [name, rest] = shot.split('=');
        const [page, groupBy] = rest.split(':');
        if (groupBy)
            settings.set_string('group-by', groupBy);
        settings.set_string('open-page', page);
        await sleep(1500);
        save(win, name);
    }
    win.close();
}

globalThis.imports.package.initFormat();
Adw.init();
const app = new Adw.Application({application_id: 'io.github.omer_gh.SourceglanceShots', flags: Gio.ApplicationFlags.NON_UNIQUE});
app.connect('activate', () => {
    app.hold();
    drive(app).catch(e => logError(e)).finally(() => app.release());
});
app.run([]);
