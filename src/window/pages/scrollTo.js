// Scrolling a preferences page so a section's heading is at the top (the popover's "Add another
// account" uses it to reach the add buttons).
import GLib from 'gi://GLib';
import Graphene from 'gi://Graphene';
import Gtk from 'gi://Gtk';

/** The first scrolled window inside `widget` (a preferences page keeps its own). */
function findScrolled(widget) {
    for (let child = widget.get_first_child(); child; child = child.get_next_sibling()) {
        if (child instanceof Gtk.ScrolledWindow)
            return child;
        const found = findScrolled(child);
        if (found)
            return found;
    }
    return null;
}

/**
 * Returns scrollTo(id) for `page`, `sections` being the widgets by id. The page may still be settling
 * (just shown, panels filling in), so the position is worked out again every frame until it stops
 * moving. A newer call replaces an older one, and so does scrolling by hand.
 */
export function makeScroller(page, sections) {
    let token = 0;
    return id => {
        const mine = ++token;
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            const scrolled = findScrolled(page);
            if (mine !== token || !scrolled)
                return GLib.SOURCE_REMOVE;
            const adjustment = scrolled.vadjustment;
            let frames = 0;
            let steady = 0;
            let last = null;
            scrolled.add_tick_callback(() => {
                if (mine !== token)
                    return GLib.SOURCE_REMOVE;
                // Moved by hand since our last step: leave it where it is.
                if (last !== null && Math.abs(adjustment.value - last) > 1)
                    return GLib.SOURCE_REMOVE;
                const [ok, point] = sections[id]?.compute_point(scrolled, new Graphene.Point({x: 0, y: 0})) ?? [false, null];
                if (ok) {
                    const before = adjustment.value;
                    // GTK keeps the value within the page's range.
                    adjustment.value = Math.max(0, before + point.y - 12);
                    steady = Math.abs(adjustment.value - before) < 0.5 ? steady + 1 : 0;
                    last = adjustment.value;
                }
                return ++frames < 90 && steady < 8 ? GLib.SOURCE_CONTINUE : GLib.SOURCE_REMOVE;
            });
            return GLib.SOURCE_REMOVE;
        });
    };
}
