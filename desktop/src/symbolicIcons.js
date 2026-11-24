// Small symbolic icons for the popover menus, drawn for Source Glance to match the ones the
// Ubuntu menus take from the icon theme (THEMED in src/lib/views.js). Each is a 16 × 16 outline
// used as a CSS mask, so it takes the text colour. The GitHub, issue and pull-request icons come
// from src/icons, like on Ubuntu.
const svg = body => `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`)}`;

export const SYMBOLIC = {
    // pan-end-symbolic: the arrow at the end of an item row.
    chevron: svg('<path d="M6 3.5 10.5 8 6 12.5"/>'),
    // checkbox-checked-symbolic: the Issues list, in the menu bar and the tab bar.
    issues: svg('<rect x="2.25" y="2.25" width="11.5" height="11.5" rx="2.5"/><path d="M5 8.25 7.25 10.5 11 5.75"/>'),
    // view-grid-symbolic: Glance.
    glance: svg('<rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/>'),
    // view-list-bullet-symbolic: Tasks.
    tasks: svg('<path d="M6 4h8M6 8h8M6 12h8"/><circle cx="2.75" cy="4" r=".75" fill="#000"/><circle cx="2.75" cy="8" r=".75" fill="#000"/><circle cx="2.75" cy="12" r=".75" fill="#000"/>'),
    // emblem-system-symbolic: Settings.
    settings: svg('<circle cx="8" cy="8" r="2.25"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"/><circle cx="8" cy="8" r="4.75"/>'),
    // help-about-symbolic: About.
    about: svg('<circle cx="8" cy="8" r="6.25"/><path d="M8 7.25V11.5"/><circle cx="8" cy="4.75" r=".75" fill="#000" stroke="none"/>'),
    // dialog-password-symbolic: Sign in….
    signIn: svg('<circle cx="5.25" cy="10.75" r="2.75"/><path d="M7.25 8.75 13.5 2.5M11 5l2 2M12.5 3.5l1.5 1.5"/>'),
    // application-exit-symbolic: Quit.
    quit: svg('<path d="M4 4l8 8M12 4l-8 8"/>'),
    // web-browser-symbolic: Open on GitHub.
    open: svg('<circle cx="8" cy="8" r="6.25"/><path d="M1.75 8h12.5M8 1.75c-2.2 2.4-2.2 10.1 0 12.5M8 1.75c2.2 2.4 2.2 10.1 0 12.5"/>'),
    // chat-message-new-symbolic: Comment….
    comment: svg('<path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"/><path d="M8 5.25v3.5M6.25 7h3.5"/>'),
    // edit-undo-symbolic: Reopen.
    reopen: svg('<path d="M4.5 6.5h6a3 3 0 0 1 0 6H7"/><path d="M6.5 4 4 6.5 6.5 9"/>'),
    // system-users-symbolic: Assignees….
    assignees: svg('<circle cx="6" cy="5.5" r="2.25"/><path d="M2 13c0-2.5 1.8-4 4-4s4 1.5 4 4"/><path d="M10.5 3.5a2.25 2.25 0 0 1 0 4.25M12 9.25c1.3.5 2 1.9 2 3.75"/>'),
    // window-close-symbolic: closing a panel.
    close: svg('<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>'),
    // view-more-symbolic: the ⋯ menu of a group.
    more: svg('<circle cx="3.5" cy="8" r="1.1" fill="#000" stroke="none"/><circle cx="8" cy="8" r="1.1" fill="#000" stroke="none"/><circle cx="12.5" cy="8" r="1.1" fill="#000" stroke="none"/>'),
    // list-add-symbolic: New project.
    add: svg('<path d="M8 3v10M3 8h10"/>'),
    // view-refresh-symbolic: Refresh.
    refresh: svg('<path d="M13 8a5 5 0 1 1-1.46-3.54"/><path d="M13 2.5v3h-3"/>'),
    // adw-external-link-symbolic: links that open in the browser.
    external: svg('<path d="M9 2.5h4.5V7M13.5 2.5 7.5 8.5M11.5 9.5v4h-9v-9h4"/>'),
    // system-run-symbolic: Startup.
    startup: svg('<path d="M8 2v5.5"/><path d="M4.75 4.25a5 5 0 1 0 6.5 0"/>'),
    // user-trash-symbolic: Disband project.
    trash: svg('<path d="M2.5 4.5h11M6 4.5V3h4v1.5M4 4.5l.75 9h6.5l.75-9M6.75 7v4M9.25 7v4"/>'),
    // edit-symbolic: a draft on a project board, and renaming a project.
    draft: svg('<path d="M10.5 2.5l3 3-8 8h-3v-3z"/><path d="M9 4l3 3"/>'),
};
