// Renders the app icon (src/icons/sourceglance-app.svg) as the 1024 px PNG that `tauri icon`
// turns into icon.icns and the other sizes. The tile is scaled to Apple's macOS icon grid:
// 824 px wide, centered, so it matches the size of other apps in the Dock. Run from the repo
// root, then regenerate the icons:
//
//   swift desktop/tools/render-app-icon.swift
//   cd desktop && npx tauri icon src-tauri/icons/app-icon-1024.png -o src-tauri/icons
import AppKit

guard let svg = NSImage(contentsOfFile: "src/icons/sourceglance-app.svg") else {
    fatalError("can't read src/icons/sourceglance-app.svg")
}
let canvas = 1024.0
let tile = 824.0
// In the SVG's 128-unit box, the tile runs from 8 to 120.
let scale = tile / 112.0
let origin = (canvas - tile) / 2 - 8 * scale

let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(canvas), pixelsHigh: Int(canvas),
                           bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                           colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
NSGraphicsContext.current?.imageInterpolation = .high
svg.draw(in: NSRect(x: origin, y: origin, width: 128 * scale, height: 128 * scale))
NSGraphicsContext.restoreGraphicsState()
let out = "desktop/src-tauri/icons/app-icon-1024.png"
try rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
print(out)
