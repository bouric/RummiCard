// RummiCard — © 2026 Richard Boulais & Claude
//
//  RummiCard — hôte natif macOS
//  Une fenêtre AppKit qui héberge le jeu (WKWebView, ressources locales).
//

import AppKit
import WebKit

/// Échappe une chaîne pour l'insérer telle quelle dans du JavaScript.
func jsLiteral(_ s: String) -> String {
    var out = "\""
    for ch in s.unicodeScalars {
        switch ch {
        case "\"": out += "\\\""
        case "\\": out += "\\\\"
        case "\n": out += "\\n"
        default:
            if ch.value < 0x20 {
                out += String(format: "\\u%04x", ch.value)
            } else {
                out.unicodeScalars.append(ch)
            }
        }
    }
    return out + "\""
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate,
                        WKScriptMessageHandler {

    static let info = Bundle.main.infoDictionary ?? [:]
    static let version = info["CFBundleShortVersionString"] as? String ?? "—"
    static let buildDate = info["RCBuildDate"] as? String ?? "—"
    static let copyright = info["NSHumanReadableCopyright"] as? String ?? ""
    static let prefsKey = "RCPreferences"

    var window: NSWindow!
    var web: WKWebView!

    // MARK: - Cycle de vie

    func applicationDidFinishLaunching(_ note: Notification) {
        NSApp.setActivationPolicy(.regular)
        NSApp.appearance = NSAppearance(named: .darkAqua)
        buildMenu()

        let config = WKWebViewConfiguration()
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")
        config.defaultWebpagePreferences.allowsContentJavaScript = true

        // Les réglages du joueur sont conservés d'une partie à l'autre.
        config.userContentController.add(self, name: "prefs")
        let saved = UserDefaults.standard.string(forKey: Self.prefsKey) ?? "null"

        // La page affiche la version et le copyright du bundle.
        let stamp = "window.APP_VERSION=\(jsLiteral(Self.version));" +
                    "window.APP_BUILD=\(jsLiteral(Self.buildDate));" +
                    "window.APP_COPYRIGHT=\(jsLiteral(Self.copyright));" +
                    "window.APP_PREFS=\(saved);"
        config.userContentController.addUserScript(
            WKUserScript(source: stamp, injectionTime: .atDocumentStart, forMainFrameOnly: true))

        web = WKWebView(frame: NSRect(x: 0, y: 0, width: 1280, height: 840), configuration: config)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.allowsBackForwardNavigationGestures = false
        web.setValue(false, forKey: "drawsBackground")

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1280, height: 840),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false)
        window.title = "RummiCard"
        window.minSize = NSSize(width: 1000, height: 680)
        window.backgroundColor = NSColor(calibratedRed: 0.04, green: 0.06, blue: 0.09, alpha: 1)
        window.contentView = web
        window.isReleasedWhenClosed = false
        if !window.setFrameUsingName("RummiCardMain") { window.center() }
        window.setFrameAutosaveName("RummiCardMain")
        window.makeKeyAndOrderFront(nil)

        loadGame()
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { window.makeKeyAndOrderFront(nil) }
        return true
    }

    private func loadGame() {
        guard let url = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "web") else {
            let alert = NSAlert()
            alert.messageText = "Ressources introuvables"
            alert.informativeText = "Le dossier web/ est absent du bundle de l’application."
            alert.runModal()
            NSApp.terminate(nil)
            return
        }
        web.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
    }

    // MARK: - Menus

    private func buildMenu() {
        let mainMenu = NSMenu()

        // Menu application
        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "À propos de RummiCard", action: #selector(about), keyEquivalent: "")
            .target = self
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Masquer RummiCard", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let hideOthers = appMenu.addItem(withTitle: "Masquer les autres",
                                         action: #selector(NSApplication.hideOtherApplications(_:)),
                                         keyEquivalent: "h")
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quitter RummiCard", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        mainMenu.addItem(appItem)

        // Menu Partie
        let gameItem = NSMenuItem()
        let gameMenu = NSMenu(title: "Partie")
        gameMenu.addItem(withTitle: "Nouvelle partie…", action: #selector(newGame), keyEquivalent: "n").target = self
        gameMenu.addItem(.separator())
        gameMenu.addItem(withTitle: "Valider le tour", action: #selector(commitTurn), keyEquivalent: "\r").target = self
        gameMenu.addItem(withTitle: "Annuler le tour", action: #selector(undoTurn), keyEquivalent: "z").target = self
        let rewind = gameMenu.addItem(withTitle: "Refaire mon tour",
                                      action: #selector(rewindAI), keyEquivalent: "z")
        rewind.keyEquivalentModifierMask = [.command, .shift]
        rewind.target = self
        gameMenu.addItem(withTitle: "Piocher", action: #selector(drawCard), keyEquivalent: "p").target = self
        gameMenu.addItem(withTitle: "Jouer au mieux", action: #selector(autoPlay), keyEquivalent: "j").target = self
        gameMenu.addItem(withTitle: "Trier la main", action: #selector(sortHand), keyEquivalent: "t").target = self
        gameMenu.addItem(.separator())
        gameMenu.addItem(withTitle: "Options…", action: #selector(showOptions), keyEquivalent: ",").target = self
        gameItem.submenu = gameMenu
        mainMenu.addItem(gameItem)

        // Menu Fenêtre
        let winItem = NSMenuItem()
        let winMenu = NSMenu(title: "Fenêtre")
        winMenu.addItem(withTitle: "Réduire", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        winMenu.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        winMenu.addItem(.separator())
        let full = winMenu.addItem(withTitle: "Plein écran",
                                   action: #selector(NSWindow.toggleFullScreen(_:)),
                                   keyEquivalent: "f")
        full.keyEquivalentModifierMask = [.command, .control]
        winItem.submenu = winMenu
        mainMenu.addItem(winItem)
        NSApp.windowsMenu = winMenu

        // Menu Aide
        let helpItem = NSMenuItem()
        let helpMenu = NSMenu(title: "Aide")
        helpMenu.addItem(withTitle: "Règles du jeu", action: #selector(showRules), keyEquivalent: "?").target = self
        helpItem.submenu = helpMenu
        mainMenu.addItem(helpItem)
        NSApp.helpMenu = helpMenu

        NSApp.mainMenu = mainMenu
    }

    private func js(_ code: String) {
        web.evaluateJavaScript(code, completionHandler: nil)
    }

    @objc private func newGame()    { js("window.RC && RC.showMenu()") }
    @objc private func commitTurn() { js("document.getElementById('commit').click()") }
    @objc private func undoTurn()   { js("document.getElementById('undo').click()") }
    @objc private func drawCard()   { js("document.getElementById('draw').click()") }
    @objc private func autoPlay()   { js("document.getElementById('auto').click()") }
    @objc private func sortHand()   { js("document.getElementById('sort').click()") }
    @objc private func showRules()  { js("window.RC && RC.showRules()") }
    @objc private func rewindAI()   { js("document.getElementById('rewind').click()") }
    @objc private func showOptions() { js("window.RC && RC.showOptions()") }

    @objc private func about() {
        let alert = NSAlert()
        alert.messageText = "RummiCard"
        alert.informativeText = """
        Version \(Self.version)
        Compilée le \(Self.buildDate)

        Les règles du rami, jouées avec 2 jeux de 52 cartes.
        Glissez une carte vers la table : elle se place toute seule \
        au bon endroit, et la table se réorganise si nécessaire.

        \(Self.copyright)
        """
        alert.addButton(withTitle: "Fermer")
        alert.runModal()
    }

    // MARK: - Réglages persistants

    func userContentController(_ controller: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard message.name == "prefs",
              let dict = message.body as? [String: Any],
              JSONSerialization.isValidJSONObject(dict),
              let data = try? JSONSerialization.data(withJSONObject: dict),
              let json = String(data: data, encoding: .utf8) else { return }
        UserDefaults.standard.set(json, forKey: Self.prefsKey)
    }

    // MARK: - WKUIDelegate (confirm / alert du jeu)

    func webView(_ webView: WKWebView,
                 runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping () -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.runModal()
        completionHandler()
    }

    func webView(_ webView: WKWebView,
                 runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "Continuer")
        alert.addButton(withTitle: "Annuler")
        completionHandler(alert.runModal() == .alertFirstButtonReturn)
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
