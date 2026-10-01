// RummiCard — © 2026 Richard Boulais & Claude
// Génère les PNG de l'icône de l'app (dessin vectoriel, une passe par taille).
import AppKit
import Foundation

func drawCard(center: NSPoint, angle: CGFloat, w: CGFloat, h: CGFloat,
              glyph: String, color: NSColor, rank: String, S: CGFloat) {
    NSGraphicsContext.saveGraphicsState()
    let t = NSAffineTransform()
    t.translateX(by: center.x, yBy: center.y)
    t.rotate(byDegrees: angle)
    t.concat()

    let r = NSRect(x: -w / 2, y: -h / 2, width: w, height: h)
    let path = NSBezierPath(roundedRect: r, xRadius: w * 0.14, yRadius: w * 0.14)

    let shadow = NSShadow()
    shadow.shadowColor = NSColor(white: 0, alpha: 0.42)
    shadow.shadowBlurRadius = S * 0.035
    shadow.shadowOffset = NSSize(width: 0, height: -S * 0.012)
    shadow.set()
    NSColor(srgbRed: 0.995, green: 0.988, blue: 0.962, alpha: 1).setFill()
    path.fill()

    let noShadow = NSShadow()
    noShadow.shadowColor = .clear
    noShadow.set()

    // Grand symbole centré
    let gSize = h * 0.46
    let gAttrs: [NSAttributedString.Key: Any] = [
        .font: NSFont.systemFont(ofSize: gSize),
        .foregroundColor: color
    ]
    let g = NSAttributedString(string: glyph, attributes: gAttrs)
    let gs = g.size()
    g.draw(at: NSPoint(x: -gs.width / 2, y: -gs.height / 2 - h * 0.02))

    // Valeur en haut à gauche (omise aux très petites tailles)
    if S >= 64 {
        let rAttrs: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: h * 0.26, weight: .bold),
            .foregroundColor: color
        ]
        let a = NSAttributedString(string: rank, attributes: rAttrs)
        a.draw(at: NSPoint(x: -w / 2 + w * 0.12, y: h / 2 - a.size().height * 0.95))
    }
    NSGraphicsContext.restoreGraphicsState()
}

func render(_ S: CGFloat) -> NSBitmapImageRep {
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(S), pixelsHigh: Int(S),
                              bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                              colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    NSGraphicsContext.current?.imageInterpolation = .high

    // Fond : carré arrondi vert feutre
    let inset = S * 0.05
    let box = NSRect(x: inset, y: inset, width: S - 2 * inset, height: S - 2 * inset)
    let bg = NSBezierPath(roundedRect: box, xRadius: S * 0.225, yRadius: S * 0.225)
    let grad = NSGradient(colors: [
        NSColor(srgbRed: 0.13, green: 0.47, blue: 0.39, alpha: 1),
        NSColor(srgbRed: 0.04, green: 0.21, blue: 0.17, alpha: 1)
    ])!
    grad.draw(in: bg, angle: -90)

    // Liseré clair
    NSColor(white: 1, alpha: 0.16).setStroke()
    bg.lineWidth = S * 0.012
    bg.stroke()

    let w = S * 0.37, h = S * 0.51
    drawCard(center: NSPoint(x: S * 0.355, y: S * 0.50), angle: 15, w: w, h: h,
             glyph: "\u{2660}", color: NSColor(srgbRed: 0.14, green: 0.16, blue: 0.21, alpha: 1),
             rank: "7", S: S)
    drawCard(center: NSPoint(x: S * 0.625, y: S * 0.455), angle: -8, w: w, h: h,
             glyph: "\u{2665}", color: NSColor(srgbRed: 0.83, green: 0.17, blue: 0.24, alpha: 1),
             rank: "8", S: S)

    NSGraphicsContext.current?.flushGraphics()
    NSGraphicsContext.restoreGraphicsState()
    return rep
}

let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "."
for size in [16, 32, 64, 128, 256, 512, 1024] {
    let rep = render(CGFloat(size))
    guard let data = rep.representation(using: .png, properties: [:]) else { continue }
    try? data.write(to: URL(fileURLWithPath: "\(out)/icon_\(size).png"))
}
print("icônes générées dans \(out)")
