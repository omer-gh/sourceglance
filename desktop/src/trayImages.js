// The menu-bar images: each list's icon with its count in a blue pill, like the blue block
// the Ubuntu top bar puts behind our items. macOS can only tint one-colour ("template")
// images to match the menu bar, so the icons are drawn here in the menu bar's text colour
// and redrawn when the appearance changes; the pill reads well on any menu bar.
import appIcon from '../../src/icons/sourceglance-symbolic.svg';
import {ICONS} from './views.js';

const SCALE = 2; // Retina; Tauri shows tray images 18 pt high.
const HEIGHT = 18 * SCALE;
const ICON = 16 * SCALE;
const PILL_HEIGHT = 14 * SCALE;
const PILL_PADDING = 4 * SCALE;
const ICON_GAP = 3 * SCALE;
const PART_GAP = 7 * SCALE;
const FONT = `600 ${11 * SCALE}px -apple-system, BlinkMacSystemFont, sans-serif`;
const NAME_FONT = `500 ${13 * SCALE}px -apple-system, BlinkMacSystemFont, sans-serif`;
const NAME_GAP = 5 * SCALE;
const BLUE = '#3584e4';
const RED = '#e01b24';

export const LIST_ICONS = {app: appIcon, issues: ICONS.issues, prs: ICONS.pr, boards: ICONS.boards};

const images = new Map();
const drawn = new Map();

function load(url) {
    if (!images.has(url)) {
        images.set(url, new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error(`sourceglance: can't load ${url}`));
            image.src = url;
        }));
    }
    return images.get(url);
}

/** The menu bar's text colour: white on a dark menu bar, black on a light one. */
export function darkMenuBar() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

async function tintedIcon(url, color) {
    const canvas = document.createElement('canvas');
    canvas.width = ICON;
    canvas.height = ICON;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(await load(url), 0, 0, ICON, ICON);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, ICON, ICON);
    return canvas;
}

/**
 * One menu-bar item's image, as PNG bytes. `parts` is a list of `{icon}` (an icon URL),
 * `{name}` (text in the menu bar's colour) and `{pill, alert}` (a count, or "!" in red when
 * `alert` is set).
 */
export async function drawItem(parts, dark = darkMenuBar()) {
    const key = JSON.stringify([parts, dark]);
    if (drawn.has(key))
        return drawn.get(key);
    const color = dark ? '#ffffff' : '#000000';
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = FONT;
    const widths = parts.map(part => {
        if (part.icon)
            return ICON;
        if (part.name !== undefined) {
            ctx.font = NAME_FONT;
            const width = Math.ceil(ctx.measureText(part.name).width);
            ctx.font = FONT;
            return width;
        }
        return Math.max(PILL_HEIGHT, Math.ceil(ctx.measureText(part.pill).width) + 2 * PILL_PADDING);
    });
    // Space before a part: small after an icon or a name, bigger between lists.
    const gap = index => {
        const previous = parts[index - 1];
        if (parts[index].name !== undefined)
            return NAME_GAP;
        return previous.icon || previous.name !== undefined ? ICON_GAP : PART_GAP;
    };
    let width = 0;
    parts.forEach((part, index) => {
        if (index > 0)
            width += gap(index);
        width += widths[index];
    });
    canvas.width = Math.max(width, 1);
    canvas.height = HEIGHT;
    let x = 0;
    for (const [index, part] of parts.entries()) {
        if (index > 0)
            x += gap(index);
        if (part.icon) {
            ctx.drawImage(await tintedIcon(part.icon, color), x, (HEIGHT - ICON) / 2);
        } else if (part.name !== undefined) {
            ctx.fillStyle = color;
            ctx.font = NAME_FONT;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(part.name, x, HEIGHT / 2 + SCALE / 2);
        } else {
            const y = (HEIGHT - PILL_HEIGHT) / 2;
            ctx.fillStyle = part.alert ? RED : BLUE;
            ctx.beginPath();
            ctx.roundRect(x, y, widths[index], PILL_HEIGHT, PILL_HEIGHT / 2);
            ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.font = FONT;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(part.pill, x + widths[index] / 2, HEIGHT / 2 + SCALE / 2);
        }
        x += widths[index];
    }
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
    drawn.set(key, bytes);
    return bytes;
}

/** The Grouped layout's one count: every list added up, "25+" if any was cut off (as on Ubuntu). */
export function totalBadge(badges) {
    const counts = badges.filter(text => /^\d+\+?$/.test(text));
    if (counts.length === 0)
        return '';
    const total = counts.reduce((sum, text) => sum + Number.parseInt(text, 10), 0);
    return counts.some(text => text.endsWith('+')) ? `${total}+` : String(total);
}

/**
 * The images for every menu-bar item, like the Ubuntu top bar: the Source Glance item with its
 * name (and in the Grouped layout the total of every list), then each list's icon and count.
 * `counts` maps each list to its badge text; `problem` adds the red "!", as on Ubuntu.
 */
export async function trayImages({layout, buttons, counts, problem}) {
    const alert = problem ? [{pill: '!', alert: true}] : [];
    const app = [{icon: appIcon}, {name: 'Source Glance'}, ...alert];
    const result = {};
    if (layout === 'tabs') {
        const total = totalBadge(buttons.map(id => counts[id] ?? ''));
        result.app = await drawItem([...app, ...total ? [{pill: total}] : []]);
        return result;
    }
    result.app = await drawItem(app);
    for (const id of buttons)
        result[id] = await drawItem([{icon: LIST_ICONS[id]}, {pill: counts[id] || '0'}]);
    return result;
}
