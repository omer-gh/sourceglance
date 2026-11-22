// The AI assistant in the window: the agent chosen in Settings → AI assistant, started on an
// issue or pull request in a terminal (work()), or run once for a comment draft (suggest()).
// The command lines, prompts and terminal list are in lib/aiAgents.js.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {gettext as _} from './i18n.js';

import {
    AI_PROVIDERS,
    TERMINALS,
    aiProvider,
    cleanSuggestion,
    isSignInProblem,
    signInState,
    repoFolderKey,
    suggestArgv,
    suggestPrompt,
    workArgv,
    workPrompt,
} from '../lib/aiAgents.js';

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async', 'communicate_utf8_finish');
Gio._promisify(Gtk.FileDialog.prototype, 'select_folder', 'select_folder_finish');

/** A sign-in that hasn't finished by then is stopped. */
const SIGN_IN_TIMEOUT_SECONDS = 300;

/** A suggestion that takes longer than this is stopped. */
const SUGGEST_TIMEOUT_SECONDS = 120;

/** Where a command may live besides the PATH (where its installer puts it). */
function findCommand(command) {
    const onPath = GLib.find_program_in_path(command);
    if (onPath)
        return onPath;
    const local = GLib.build_filenamev([GLib.get_home_dir(), '.local', 'bin', command]);
    return GLib.file_test(local, GLib.FileTest.IS_EXECUTABLE) ? local : null;
}

/** `path` with its symbolic links followed (a few levels at most). */
function resolveLinks(path) {
    let file = Gio.File.new_for_path(path);
    for (let level = 0; level < 8; level++) {
        const info = file.query_info('standard::symlink-target', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
        if (!info.has_attribute('standard::symlink-target'))
            break;
        file = file.get_parent().resolve_relative_path(info.get_symlink_target());
    }
    return file.get_path();
}

/**
 * The agent's command: its own, or the copy inside the package of the app named by `bundledIn`
 * (found through the PATH, like any command; the copy sits in that package's own folder).
 */
function findProgram(provider) {
    const own = findCommand(provider.command);
    if (own || !provider.bundledIn)
        return own;
    const host = findCommand(provider.bundledIn.command);
    if (!host)
        return null;
    try {
        const bundled = GLib.build_filenamev([GLib.path_get_dirname(resolveLinks(host)), ...provider.bundledIn.path]);
        return GLib.file_test(bundled, GLib.FileTest.IS_EXECUTABLE) ? bundled : null;
    } catch {
        return null;
    }
}

export class AiAssistant {
    /** `settings` is the extension's Gio.Settings, `icons` the window's icon folder (a Gio.File). */
    /** `sync` is the SyncService: its server hands out the instructions, and the AI buttons are off without them. */
    constructor({window, settings, toast, iconDir, sync}) {
        this._sync = sync;
        this._window = window;
        this._settings = settings;
        this._toast = toast;
        this._iconDir = iconDir;
        this._watch = 0;
        this._signInCallbacks = [];
        window.connect('close-request', () => {
            this._stopWatching();
            return false;
        });
        this._hasKeys = settings.settings_schema.has_key('ai-provider') && settings.settings_schema.has_key('repo-folders')
            && settings.settings_schema.has_key('ai-instructions');
    }

    /** The chosen agent, or null when none is (or this version's settings can't hold the choice). */
    get provider() {
        return this._hasKeys ? aiProvider(this._settings.get_string('ai-provider')) : null;
    }

    /** Whether the AI buttons may work: a sync server has signed this computer in and given the instructions. */
    get enabled() {
        return this._sync?.aiReady ?? false;
    }

    /** Whether a sync server has signed this computer in (the instructions may still be on their way). */
    get signedIn() {
        return this._sync?.signedIn ?? false;
    }

    /** Whether the AI buttons are turned on for the server (the switch in Settings → Sync server). */
    get featureOn() {
        return this._sync?.featureAi ?? false;
    }

    /** The server's instructions, or null. */
    get prompts() {
        return this._sync?.prompts ?? null;
    }

    /** Why the buttons are off, for their tooltips. */
    get disabledReason() {
        if (!this._sync?.available)
            return _('The AI assistant needs a sync server, which this version can’t use');
        if (!this._sync.signedIn)
            return _('Sign in to a sync server (Settings → Sync server) to use the AI assistant');
        return this._sync.featureAi
            ? _('Waiting for the sync server’s AI instructions. Try Sync now in Settings → Sync server.')
            : _('The AI assistant is turned off (Settings → Sync server)');
    }

    /** The user's own additions to what an agent is told (Settings). */
    get additions() {
        return this._hasKeys ? this._settings.get_string('ai-instructions') : '';
    }

    /** Runs `callback` when the choice changes. Returns the id for disconnect(). */
    onChanged(callback) {
        return this._hasKeys ? this._settings.connect('changed::ai-provider', callback) : 0;
    }

    /** The agent's icon: its own, or one from the icon theme. */
    icon(provider) {
        if (provider.themeIcon)
            return Gio.ThemedIcon.new(provider.themeIcon);
        return Gio.FileIcon.new(this._iconDir.get_child(`${provider.iconName}.svg`));
    }

    /** The agents for the Settings drop-down, with None first. */
    get choices() {
        return [{id: '', name: _('None')}, ...AI_PROVIDERS];
    }

    /** Local folders by repository, from settings (lower case owner/name to path). */
    folders() {
        return this._hasKeys ? this._settings.get_value('repo-folders').deepUnpack() : {};
    }

    setFolder(key, path) {
        const folders = {...this.folders()};
        if (path)
            folders[key] = path;
        else
            delete folders[key];
        this._settings.set_value('repo-folders', new GLib.Variant('a{ss}', folders));
    }

    /** The repository's folder if one is saved and still there, else null. */
    folderFor(item) {
        const path = this.folders()[repoFolderKey(item)];
        return path && GLib.file_test(path, GLib.FileTest.IS_DIR) ? path : null;
    }

    /** Asks for the repository's folder (the first time, or when it has moved), and remembers it. */
    async _chooseFolder(item) {
        const dialog = new Gtk.FileDialog({title: _('Where is %s on this computer?').format(item.repo), modal: true});
        try {
            const file = await dialog.select_folder(this._window, null);
            const path = file?.get_path() ?? null;
            if (path)
                this.setFolder(repoFolderKey(item), path);
            return path;
        } catch {
            // Dismissed.
            return null;
        }
    }

    /** Starts the agent in a terminal inside the repository's folder, with the item as its first message. */
    async work(item, details = null) {
        const provider = this.provider;
        if (!provider)
            return;
        if (!this.enabled) {
            this._toast(this.disabledReason);
            return;
        }
        // The desktop app, when there is one, comes first; the terminal is the fallback.
        const desktop = provider.desktop && Gio.AppInfo.get_default_for_uri_scheme(provider.desktop.scheme);
        const program = findProgram(provider);
        if (!desktop && !program) {
            this._toast(_('%s isn’t installed, or isn’t on your PATH').format(provider.name));
            return;
        }
        const folder = this.folderFor(item) ?? await this._chooseFolder(item);
        if (!folder)
            return;
        if (desktop) {
            try {
                Gio.AppInfo.launch_default_for_uri(provider.desktop.uri(folder, workPrompt(item, details, this.additions, this.prompts)), null);
                this._toast(_('%s opened in %s').format(provider.name, GLib.path_get_basename(folder)));
                return;
            } catch (e) {
                if (!program) {
                    this._toast(_('Couldn’t open %s: %s').format(provider.name, e.message));
                    return;
                }
            }
        }
        this._inTerminal(folder, workArgv(provider, program, item, details, this.additions, this.prompts), _('%s opened in %s').format(provider.name, GLib.path_get_basename(folder)));
    }

    /** Opens the first terminal program found, running `command` in `folder`; `done` is the toast. */
    _inTerminal(folder, command, done) {
        for (const terminal of TERMINALS) {
            const path = GLib.find_program_in_path(terminal.program);
            if (!path)
                continue;
            try {
                const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.NONE});
                launcher.set_cwd(folder);
                launcher.spawnv([path, ...terminal.argv(folder, command)]);
                this._toast(done);
            } catch (e) {
                this._toast(_('Couldn’t open a terminal: %s').format(e.message));
            }
            return;
        }
        this._toast(_('No terminal program was found'));
    }

    /** Whether the chosen agent is signed in: {signedIn, account}, or null when that can't be told. */
    async signInState() {
        const provider = this.provider;
        const program = provider?.status && findProgram(provider);
        if (!program)
            return null;
        try {
            const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE});
            launcher.set_cwd(GLib.get_tmp_dir());
            const process = launcher.spawnv([program, ...provider.status.args]);
            // Some agents say it on stderr.
            const [stdout, stderr] = await process.communicate_utf8_async(null, null);
            return signInState(provider, `${stdout ?? ''}\n${stderr ?? ''}`);
        } catch {
            return null;
        }
    }

    /** Signs the chosen agent in: its own sign-in, in a terminal, where you finish it in the browser. */
    signIn() {
        const provider = this.provider;
        if (!provider)
            return;
        const program = findProgram(provider);
        if (!program) {
            this._toast(_('%s isn’t installed, or isn’t on your PATH').format(provider.name));
            return;
        }
        this._watchSignIn(provider);
        if (provider.headlessLogin)
            this._signInHeadless(provider, program);
        else
            this._signInInTerminal(provider, program);
    }

    /** An empty folder of our own to sign in from, so no agent sees (or asks to trust) your home folder. */
    _signInFolder() {
        const folder = GLib.build_filenamev([GLib.get_user_cache_dir(), 'sourceglance', 'sign-in']);
        GLib.mkdir_with_parents(folder, 0o700);
        return folder;
    }

    _signInInTerminal(provider, program) {
        this._inTerminal(this._signInFolder(), [program, ...provider.login],
            _('Sign in to %s in the terminal, then try again').format(provider.name));
    }

    /**
     * Runs the sign-in with no terminal: the agent opens the browser itself, and the watch (above)
     * brings this window back once it's signed in. If the agent fails, or stops short of
     * finishing, the toast offers the terminal, where it can ask for what it needs.
     */
    async _signInHeadless(provider, program) {
        this._toast(_('Finish signing in to %s in your browser').format(provider.name));
        let process = null;
        let timeout = 0;
        try {
            const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE});
            launcher.set_cwd(this._signInFolder());
            process = launcher.spawnv([program, ...provider.login]);
            timeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, SIGN_IN_TIMEOUT_SECONDS, () => {
                timeout = 0;
                process.force_exit();
                return GLib.SOURCE_REMOVE;
            });
            // Nothing to send on stdin: an agent that wants a pasted code fails here, and the toast offers the terminal.
            const [stdout, stderr] = await process.communicate_utf8_async(null, null);
            if (process.get_successful())
                return;
            if (this._watch && this.provider === provider) {
                this._stopWatching();
                const reason = [stderr, stdout].flatMap(out => (out ?? '').split('\n')).map(line => line.trim()).find(Boolean);
                this._toast(reason ? _('%s sign-in: %s').format(provider.name, reason.slice(0, 120))
                    : _('%s sign-in didn’t finish').format(provider.name),
                {label: _('Use terminal'), onClick: () => this._signInInTerminal(provider, program)});
            }
        } catch (e) {
            this._stopWatching();
            this._toast(_('Couldn’t start the sign-in: %s').format(e.message),
                {label: _('Use terminal'), onClick: () => this._signInInTerminal(provider, program)});
        } finally {
            if (timeout)
                GLib.source_remove(timeout);
        }
    }

    /**
     * After Sign in, the terminal and the browser take the focus. Check every few seconds
     * (for up to 5 minutes) and, once the agent is signed in, bring this window back and say so.
     */
    _watchSignIn(provider) {
        if (!provider.status)
            return;
        if (this._watch)
            GLib.source_remove(this._watch);
        let checks = 0;
        this._watch = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 3, () => {
            checks++;
            this.signInState().then(state => {
                if (!this._watch || this.provider !== provider)
                    return;
                if (state?.signedIn) {
                    this._stopWatching();
                    this._window.present();
                    this._toast(_('Signed in to %s').format(provider.name));
                    for (const callback of this._signInCallbacks)
                        callback();
                } else if (checks >= 100) {
                    this._stopWatching();
                }
            });
            return this._watch ? GLib.SOURCE_CONTINUE : GLib.SOURCE_REMOVE;
        });
    }

    _stopWatching() {
        if (this._watch)
            GLib.source_remove(this._watch);
        this._watch = 0;
    }

    /** Runs `callback` when a sign-in started here has completed. */
    onSignedIn(callback) {
        this._signInCallbacks.push(callback);
    }

    /**
     * Runs the agent once, with no tools, for a comment draft on `item`. `details` is the
     * preview's description and comments (or null), `hint` what's typed in the comment box.
     * Returns the text, or null after a toast says why not.
     */
    async suggest(item, details, hint) {
        const provider = this.provider;
        if (!provider)
            return null;
        if (!this.enabled) {
            this._toast(this.disabledReason);
            return null;
        }
        const program = findProgram(provider);
        if (!program) {
            this._toast(_('%s isn’t installed, or isn’t on your PATH').format(provider.name));
            return null;
        }
        const argv = suggestArgv(provider, program, suggestPrompt(item, details, hint, this.prompts));
        let process = null;
        let timeout = 0;
        try {
            // Not in the repository's folder: the run has no use for it and needs no files.
            const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE});
            launcher.set_cwd(GLib.get_tmp_dir());
            process = launcher.spawnv(argv);
            timeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, SUGGEST_TIMEOUT_SECONDS, () => {
                timeout = 0;
                process.force_exit();
                return GLib.SOURCE_REMOVE;
            });
            // Nothing to send on stdin; the pipe is closed at once so the agent doesn't wait on it.
            const [stdout, stderr] = await process.communicate_utf8_async(null, null);
            const text = process.get_successful() ? cleanSuggestion(stdout) : '';
            if (text)
                return text;
            // Say why, in the agent's own words, when it said any (e.g. its sign-in expired).
            const reason = [stderr, stdout].flatMap(out => (out ?? '').split('\n')).map(line => line.trim()).find(Boolean);
            if (isSignInProblem(`${reason} ${stderr}`)) {
                this._toast(_('%s isn’t signed in').format(provider.name), {label: _('Sign in'), onClick: () => this.signIn()});
            } else {
                this._toast(reason ? _('%s: %s').format(provider.name, reason.slice(0, 160))
                    : _('%s didn’t give a suggestion').format(provider.name));
            }
        } catch (e) {
            this._toast(_('Couldn’t run %s: %s').format(provider.name, e.message));
        } finally {
            if (timeout)
                GLib.source_remove(timeout);
        }
        return null;
    }
}
