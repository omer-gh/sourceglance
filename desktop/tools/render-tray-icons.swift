// Renders the menu-bar icons from the extension's symbolic SVGs (src/icons) as black-on-
// transparent PNGs, which macOS uses as template images. Run from the repo root:
//
//   swift desktop/tools/render-tray-icons.swift
import AppKit

let icons = [
    ("sourceglance-symbolic", "app"),
    ("issue-symbolic", "issues"),
    ("git-pull-request-symbolic", "prs"),
    ("checklist-symbolic", "projects"),
]
let out = "desktop/src-tauri/icons/tray"
try FileManager.default.createDirectory(atPath: out, withIntermediateDirectories: true)

for (source, name) in icons {
    guard let image = NSImage(contentsOfFile: "src/icons/\(source).svg") else {
        fatalError("can't read src/icons/\(source).svg")
    }
    // 16 pt at 2x for Retina menu bars.
    let size = 32
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size,
                               bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                               colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    image.draw(in: NSRect(x: 0, y: 0, width: size, height: size))
    NSGraphicsContext.restoreGraphicsState()
    try rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "\(out)/\(name).png"))
    print("\(out)/\(name).png")
}
