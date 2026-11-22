// The AI assistant: which command-line agent Source Glance can start for an issue or pull
// request, and the prompts and command lines it uses. Pure (no GNOME imports).
//
// Two uses, both on the user's own machine with the user's own sign-in to the agent:
//  - Work on it: the agent opens in a terminal inside the repository's local folder, with the
//    item as its first message. The user supervises it there, like any terminal session.
//  - Suggest a comment: the agent runs once with no tools and prints a draft that fills the
//    comment box. The user reads and edits it; nothing is posted without Comment being pressed.
//
// The instructions an agent is given (what to do, how to behave) are not in this app: a signed-in sync
// server hands them out (lib/sync.js parsePrompts) and the AI buttons stay off without them. This file
// fills in the parts that are about the item. Item titles, descriptions and comments come from other people, so they are untrusted text for
// the agent too (threat model T29): the prompts say so, the suggesting run gets no tools, and the
// working run happens where the user watches it, under the agent's own permission prompts.

import {itemRef} from './model.js';

/** How much of an item's description and comments a suggestion prompt carries. */
export const MAX_PROMPT_BODY = 6000;
export const MAX_PROMPT_COMMENTS = 10;
export const MAX_SUGGESTION_LENGTH = 20000;

/**
 * The agents on offer, in the order the Settings drop-down lists them. `iconName` is a file in
 * src/icons (without .svg) or, for `themeIcon`, a name from the active icon theme. `interactive`
 * and `once` build the command line (after the command itself) for a terminal session and for a
 * single run that prints its answer. `desktop`, where there is one, is the app that handles
 * `scheme` links and builds the link that opens a session there (`uri(folder, prompt)`). `login`
 * is what to run (after the command) to sign the agent in, in a terminal. `downloadUrl` and `docsUrl`
 * are the agent's own pages for installing it and for signing in, offered when it can't be run.
 */
export const AI_PROVIDERS = [
    {
        id: 'claude', name: 'Claude Code', command: 'claude', iconName: 'ai-claude-symbolic',
        interactive: prompt => [prompt],
        once: prompt => ['-p', prompt, '--tools', ''],
        login: ['auth', 'login'],
        downloadUrl: 'https://code.claude.com/docs/en/quickstart',
        docsUrl: 'https://code.claude.com/docs/en/authentication',
        // The desktop app's deep link for a new Code session in a folder, with the prompt typed
        // in for the user to send. Preferred over the terminal when the app is installed.
        desktop: {scheme: 'claude', uri: (folder, prompt) =>
            `claude://code/new?folder=${encodeURIComponent(folder)}&q=${encodeURIComponent(prompt)}`},
    },
    {
        id: 'codex', name: 'Codex', command: 'codex',
        // The ChatGPT desktop app's package (`chatgpt` on the PATH) carries the Codex CLI in its own folder.
        // That copy stands in when there is no `codex` on the PATH.
        bundledIn: {command: 'chatgpt', path: ['resources', 'codex']},
        themeIcon: 'utilities-terminal-symbolic',
        interactive: prompt => [prompt],
        once: prompt => ['exec', '--sandbox', 'read-only', '--skip-git-repo-check', prompt],
        login: ['login'],
        downloadUrl: 'https://developers.openai.com/codex/cli',
        docsUrl: 'https://developers.openai.com/codex/auth',
        // The Codex app's deep link for a new thread in a folder, with the prompt typed in.
        desktop: {scheme: 'codex', uri: (folder, prompt) =>
            `codex://new?path=${encodeURIComponent(folder)}&prompt=${encodeURIComponent(prompt)}`},
    },
    {
        id: 'gemini', name: 'Gemini CLI', command: 'gemini', iconName: 'ai-gemini-symbolic',
        interactive: prompt => ['-i', prompt],
        once: prompt => ['-p', prompt],
        // Gemini has no sign-in command: it asks the first time it runs. --skip-trust keeps it from
        // asking to trust the empty folder it's started in.
        login: ['--skip-trust'],
        downloadUrl: 'https://github.com/google-gemini/gemini-cli',
        docsUrl: 'https://geminicli.com/docs/get-started/authentication/',
    },
];

/** The default agent; '' (None) turns the buttons off. */
export const DEFAULT_AI_PROVIDER = 'claude';

/** The provider with this id, or null (including for ''). */
export function aiProvider(id) {
    return AI_PROVIDERS.find(provider => provider.id === id) ?? null;
}

/** The lookup key for a repository's local folder: lower case, like the project names. */
export function repoFolderKey(item) {
    return typeof item?.repo === 'string' ? item.repo.toLowerCase() : '';
}

/** "issue", "pull request" or "merge request" for the prompts. */
function kindWord(item) {
    if (item.kind !== 'pr')
        return 'issue';
    return item.platform === 'gitlab' ? 'merge request' : 'pull request';
}

/** The platform's command-line tool, which the agent can use to read the item. */
function cliHint(item) {
    const gitlab = item.platform === 'gitlab';
    const tool = gitlab ? 'glab' : 'gh';
    const noun = item.kind === 'pr' ? (gitlab ? 'mr' : 'pr') : 'issue';
    return `${tool} ${noun} view ${item.number}`;
}

/** One line of text, however long or multi-line the platform's title is. */
function oneLine(text, max = 200) {
    const line = String(text ?? '').replace(/\s+/g, ' ').trim();
    return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** What a working session's first message carries of the description and comments. */
const WORK_BODY = 4000;
const WORK_COMMENTS = 5;
const WORK_COMMENT = 800;

/** The most of the user's own additions a launch message carries. */
export const MAX_ADDITIONS = 4000;

/** `text` with {name} replaced from `vars`; an unknown {name} is left as it is. */
export function fillTemplate(text, vars) {
    return String(text).replace(/\{([a-z]+)\}/g, (whole, name) => (name in vars ? vars[name] : whole));
}

/** The words that name an item in an instruction, e.g. "issue owner/repo#12". */
function itemWords(item) {
    return `${kindWord(item)} ${item.repo}${itemRef(item)}`;
}

/** The instructions as the Settings page shows them, with a placeholder for the platform command. */
export function instructionsText(prompts) {
    return prompts.work.lines.map(line => fillTemplate(line, {cli: 'gh issue view <number>'})).join('\n\n');
}

/**
 * The first message of a working session: the item's title and link and, when Source Glance has them (`details`,
 * parseDetails()'s result), its description and latest comments, cut to fit (agents often can't reach the
 * platform themselves: a sandbox without network, a private repository), then the server's `prompts.work`
 * and the user's own `additions`, if any.
 */
export function workPrompt(item, details, additions, prompts) {
    const vars = {item: itemWords(item), title: oneLine(item.title), cli: cliHint(item)};
    const lines = [fillTemplate(prompts.work.intro, vars)];
    if (item.url)
        lines.push(`Link: ${item.url}`);
    if (details) {
        lines.push('', 'Description:', capped(details.body, WORK_BODY) || '(none)');
        const comments = (details.comments ?? []).slice(-WORK_COMMENTS);
        if (comments.length) {
            lines.push('', 'Latest comments, oldest first:');
            for (const comment of comments)
                lines.push(`- ${comment.author ?? 'someone'}: ${capped(comment.body, WORK_COMMENT)}`);
        }
        lines.push('', 'That is what Source Glance could read for you; it may be cut and it may be out of date.');
    }
    lines.push('', ...prompts.work.lines.map(line => fillTemplate(line, vars)));
    const mine = String(additions ?? '').trim();
    if (mine)
        lines.push('', 'My additions:', mine.length > MAX_ADDITIONS ? mine.slice(0, MAX_ADDITIONS) : mine);
    return lines.join('\n');
}

/** Text capped to `max` characters, with a note when it was cut. */
function capped(text, max) {
    const value = String(text ?? '').trim();
    return value.length > max ? `${value.slice(0, max)}\n[cut]` : value;
}

/**
 * The prompt for a comment draft. `details` is parseDetails()'s result (description and
 * comments, either may be missing); `hint` is what the user typed in the box, if anything;
 * `prompts` the server's instructions.
 */
export function suggestPrompt(item, details, hint, prompts) {
    const vars = {item: itemWords(item), title: oneLine(item.title)};
    const lines = [...prompts.suggest.intro.map(line => fillTemplate(line, vars)), '', `Title: ${oneLine(item.title)}`];
    if (item.url)
        lines.push(`Link: ${item.url}`);
    const body = capped(details?.body, MAX_PROMPT_BODY);
    lines.push('', 'Description:', body || '(none)');
    const comments = (details?.comments ?? []).slice(-MAX_PROMPT_COMMENTS);
    if (comments.length) {
        lines.push('', 'Latest comments, oldest first:');
        for (const comment of comments)
            lines.push(`- ${comment.author ?? 'someone'}: ${capped(comment.body, 1500)}`);
    }
    const wish = String(hint ?? '').trim();
    lines.push('', wish ? `${prompts.suggest.hint}\n${capped(wish, 2000)}` : prompts.suggest.noHint);
    return lines.join('\n');
}

/** Whether an agent's error line says it isn't signed in (or its sign-in ran out). */
export function isSignInProblem(text) {
    return /oauth|authenticat|sign.?in|log.?in|unauthori[sz]ed|credential|api key|\b401\b/i.test(String(text ?? ''));
}

/** An agent's printed answer, ready for the comment box: trimmed, and not wrapped in a code fence. */
export function cleanSuggestion(output) {
    let text = String(output ?? '').replace(/\r\n/g, '\n').trim();
    const fenced = /^```(?:markdown|md)?\n([\s\S]*)\n```$/.exec(text);
    if (fenced)
        text = fenced[1].trim();
    return text.length > MAX_SUGGESTION_LENGTH ? text.slice(0, MAX_SUGGESTION_LENGTH) : text;
}

/** The command line (program first) for a working session; `program` is the agent's resolved path. */
export function workArgv(provider, program, item, details, additions, prompts) {
    return [program, ...provider.interactive(workPrompt(item, details, additions, prompts))];
}

/** The command line (program first) for a one-off suggestion. */
export function suggestArgv(provider, program, prompt) {
    return [program, ...provider.once(prompt)];
}

/**
 * Terminal programs to try, in order, each as {program, argv(dir, command)}: how to start
 * `command` (an argv) with `dir` as its working folder. The first one installed is used.
 */
export const TERMINALS = [
    {program: 'ptyxis', argv: (dir, command) => ['-d', dir, '--', ...command]},
    {program: 'gnome-terminal', argv: (dir, command) => [`--working-directory=${dir}`, '--', ...command]},
    {program: 'kgx', argv: (dir, command) => [`--working-directory=${dir}`, '-e', shellLine(command)]},
    {program: 'konsole', argv: (dir, command) => ['--workdir', dir, '-e', ...command]},
    {program: 'xfce4-terminal', argv: (dir, command) => [`--working-directory=${dir}`, '-x', ...command]},
    {program: 'kitty', argv: (dir, command) => ['--directory', dir, ...command]},
    {program: 'alacritty', argv: (dir, command) => ['--working-directory', dir, '-e', ...command]},
    {program: 'x-terminal-emulator', argv: (dir, command) => ['-e', ...command]},
    {program: 'xterm', argv: (dir, command) => ['-e', ...command]},
];

/** A command as one shell line, each word single-quoted (for terminals that take a string). */
export function shellLine(command) {
    return command.map(word => `'${String(word).replaceAll("'", "'\\''")}'`).join(' ');
}
