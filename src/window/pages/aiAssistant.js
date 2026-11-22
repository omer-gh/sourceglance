// Settings → AI assistant: which agent the AI buttons use, and where each repository is on this
// computer (asked for the first time the assistant opens on it).
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import {gettext as _} from '../i18n.js';

import {instructionsText} from '../../lib/aiAgents.js';
import {LOCK_ICON} from './common.js';

/** `ctx` is {settings, ai, sync, openPage}. Returns the page. */
export function buildAiPage({settings, ai, sync, openPage}) {
    const page = new Adw.PreferencesPage();
    const choices = ai.choices;

    // Locked until a sync server is connected: it provides the instructions the agents are given.
    const locked = new Adw.PreferencesGroup();
    const lockRow = new Adw.ActionRow({title: _('Connect to a secure server first'),
        subtitle: _('The AI assistant takes its instructions from a Source Glance server. Sign in to Source Glance Cloud, or to your own server, to unlock it.'),
        css_classes: ['sourceglance-privacy-note']});
    lockRow.add_prefix(new Gtk.Image({icon_name: LOCK_ICON}));
    const connect = new Gtk.Button({label: _('Connect to a server'), valign: Gtk.Align.CENTER, css_classes: ['suggested-action']});
    connect.connect('clicked', () => openPage?.('settings-sync'));
    lockRow.add_suffix(connect);
    locked.add(lockRow);
    page.add(locked);

    const agent = new Adw.PreferencesGroup({title: _('AI assistant'),
        description: _('Adds a button to each issue and pull request that opens the agent in a terminal in the repository’s folder, and a Suggest button to the comment box. The agent runs on this computer with your own sign-in to it.')});
    const row = new Adw.ComboRow({title: _('Agent'), subtitle: _('Must be installed; Source Glance only starts it'),
        model: Gtk.StringList.new(choices.map(choice => choice.name))});
    const icon = new Gtk.Image();
    row.add_prefix(icon);
    const showChoice = () => {
        const provider = ai.provider;
        icon.visible = Boolean(provider);
        if (provider)
            icon.set_from_gicon(ai.icon(provider));
        row.selected = Math.max(0, choices.findIndex(choice => choice.id === (provider?.id ?? '')));
    };
    row.connect('notify::selected', () => {
        const id = choices[row.selected]?.id ?? '';
        if (id !== (ai.provider?.id ?? ''))
            settings.set_string('ai-provider', id);
    });
    settings.connect('changed::ai-provider', showChoice);
    showChoice();
    agent.add(row);
    page.add(agent);

    // Said plainly, where the folders are listed: all Source Glance keeps is the text of each path.
    const privacy = new Adw.PreferencesGroup();
    const note = new Adw.ActionRow({title: _('Source Glance only knows these paths'),
        subtitle: _('It has no access to the files, folders, code or data inside them: it never reads or writes anything there. The agent you launch works in the folder under its own permissions.'),
        css_classes: ['sourceglance-privacy-note']});
    note.add_prefix(new Gtk.Image({icon_name: 'security-high-symbolic'}));
    privacy.add(note);
    page.add(privacy);

    // What an agent is told when launched: ours (read only) and the user's own additions.
    const prompt = new Adw.PreferencesGroup({title: _('Instructions to the agent'),
        description: _('Given to the agent with the issue or pull request when you launch it. They come from your sync server, so the AI assistant works only while you are signed in to one (Settings → Sync server). Your additions go at the end.')});
    const ours = new Gtk.Label({label: '', wrap: true, wrap_mode: 2 /* WORD_CHAR */, xalign: 0, hexpand: true,
        selectable: true, css_classes: ['caption']});
    ours.update_property([Gtk.AccessibleProperty.LABEL], [_('Source Glance’s instructions (read only)')]);
    const oursBox = new Gtk.Box({hexpand: true, margin_top: 8, margin_bottom: 8, margin_start: 10, margin_end: 10});
    oursBox.append(ours);
    const oursFrame = new Gtk.ScrolledWindow({child: oursBox, min_content_height: 200,
        hscrollbar_policy: Gtk.PolicyType.NEVER});
    // The instructions come from the sync server; without them there is nothing to show and the AI buttons are off.
    const showOurs = () => {
        const prompts = ai.prompts;
        ours.label = prompts ? instructionsText(prompts)
            : _('Sign in to a sync server (Settings → Sync server) to see the instructions and use the AI assistant.');
    };
    sync.onChanged(showOurs);
    showOurs();
    prompt.add(new Gtk.Frame({child: oursFrame}));
    const mine = new Gtk.TextView({wrap_mode: Gtk.WrapMode.WORD_CHAR, top_margin: 8, bottom_margin: 8,
        left_margin: 10, right_margin: 10, accepts_tab: false});
    mine.update_property([Gtk.AccessibleProperty.LABEL], [_('Your additions')]);
    mine.buffer.text = settings.get_string('ai-instructions');
    mine.buffer.connect('changed', () => {
        if (mine.buffer.text !== settings.get_string('ai-instructions'))
            settings.set_string('ai-instructions', mine.buffer.text);
    });
    prompt.add(new Gtk.Label({label: _('Your additions'), xalign: 0, margin_top: 12, css_classes: ['heading']}));
    prompt.add(new Gtk.Frame({child: new Gtk.ScrolledWindow({child: mine, min_content_height: 110,
        hscrollbar_policy: Gtk.PolicyType.NEVER})}));
    page.add(prompt);

    const folders = new Adw.PreferencesGroup({title: _('Repository folders'),
        description: _('Where each repository is on this computer. Asked for the first time you use the assistant on a repository; kept only in Source Glance.')});
    page.add(folders);
    let rows = [];
    const showFolders = () => {
        for (const old of rows)
            folders.remove(old);
        rows = [];
        const entries = Object.entries(ai.folders()).sort(([a], [b]) => a.localeCompare(b));
        if (entries.length === 0) {
            const none = new Adw.ActionRow({title: _('No folders yet'), sensitive: false});
            folders.add(none);
            rows.push(none);
            return;
        }
        for (const [repo, path] of entries) {
            const entry = new Adw.ActionRow({title: repo, subtitle: path});
            entry.add_css_class('property');
            const forget = new Gtk.Button({icon_name: 'user-trash-symbolic', valign: Gtk.Align.CENTER,
                css_classes: ['flat'], tooltip_text: _('Forget this folder')});
            forget.update_property([Gtk.AccessibleProperty.LABEL], [_('Forget the folder of %s').format(repo)]);
            forget.connect('clicked', () => ai.setFolder(repo, null));
            entry.add_suffix(forget);
            folders.add(entry);
            rows.push(entry);
        }
    };
    settings.connect('changed::repo-folders', showFolders);
    showFolders();
    const showLock = () => {
        const on = ai.enabled;
        locked.visible = !on;
        agent.sensitive = on;
        prompt.sensitive = on;
        privacy.sensitive = on;
        folders.sensitive = on;
        const off = ai.signedIn && !ai.featureOn;
        lockRow.title = !ai.signedIn ? _('Connect to a secure server first') : off ? _('Turned off') : _('Waiting for the server');
        lockRow.subtitle = !ai.signedIn
            ? _('The AI assistant takes its instructions from a Source Glance server. Sign in to Source Glance Cloud, or to your own server, to unlock it.')
            : off
                ? _('You turned the AI button off for this server. Turn “Launch in AI button” back on in Settings → Sync server.')
                : _('You are signed in, but the server’s AI instructions have not arrived yet. Press Sync now in Settings → Sync server.');
        connect.label = ai.signedIn ? _('Open Sync server') : _('Connect to a server');
    };
    sync.onChanged(showLock);
    showLock();
    return page;
}
