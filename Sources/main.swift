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


    // MARK: - Langue des menus
    //
    // Les menus natifs sont construits avant que la page ne se charge : on lit
    // la langue dans les réglages enregistrés, sinon dans celle du système.

    static let LANGUES = ["fr", "en", "de", "it", "nl", "es"]

    static let MENUS: [String: [String: String]] = [
      "fr": ["apropos": "À propos de RummiCard", "masquer": "Masquer RummiCard",
             "masquerAutres": "Masquer les autres", "quitter": "Quitter RummiCard",
             "partie": "Partie", "nouvelle": "Nouvelle partie…", "suivant": "Au suivant\u{202F}!",
             "annuler": "Annuler le dernier mouvement", "refaire": "Refaire",
             "piocher": "Piocher", "magique": "Magique", "trier": "Changer le tri de la main",
             "options": "Options…", "fenetre": "Fenêtre", "reduire": "Réduire",
             "zoom": "Zoom", "plein": "Plein écran", "aide": "Aide", "regles": "Règles du jeu",
             "version": "Version", "compilee": "Compilée le", "fermer": "Fermer",
             "desc": "Les règles du rami, jouées avec 2 jeux de 52 cartes.\nGlissez une carte vers la table : elle se place toute seule au bon endroit, et la table se réorganise si nécessaire."],
      "en": ["apropos": "About RummiCard", "masquer": "Hide RummiCard",
             "masquerAutres": "Hide Others", "quitter": "Quit RummiCard",
             "partie": "Game", "nouvelle": "New Game…", "suivant": "Next player!",
             "annuler": "Undo Last Move", "refaire": "Rewind",
             "piocher": "Draw", "magique": "Magic", "trier": "Change Hand Sorting",
             "options": "Options…", "fenetre": "Window", "reduire": "Minimise",
             "zoom": "Zoom", "plein": "Full Screen", "aide": "Help", "regles": "Rules of the Game",
             "version": "Version", "compilee": "Built on", "fermer": "Close",
             "desc": "The rules of rummy, played with 2 decks of 52 cards.\nDrag a card onto the table: it settles into the right place by itself, and the table rearranges if need be."],
      "de": ["apropos": "Über RummiCard", "masquer": "RummiCard ausblenden",
             "masquerAutres": "Andere ausblenden", "quitter": "RummiCard beenden",
             "partie": "Spiel", "nouvelle": "Neues Spiel…", "suivant": "Weiter!",
             "annuler": "Letzten Zug zurücknehmen", "refaire": "Zug zurück",
             "piocher": "Ziehen", "magique": "Magie", "trier": "Sortierung der Hand wechseln",
             "options": "Einstellungen…", "fenetre": "Fenster", "reduire": "Im Dock ablegen",
             "zoom": "Zoomen", "plein": "Vollbild", "aide": "Hilfe", "regles": "Spielregeln",
             "version": "Fassung", "compilee": "Erstellt am", "fermer": "Schließen",
             "desc": "Die Regeln von Rommé, gespielt mit 2 Kartenspielen zu 52 Blatt.\nZiehen Sie eine Karte auf den Tisch: Sie legt sich von selbst an die richtige Stelle, und der Tisch ordnet sich bei Bedarf neu."],
      "it": ["apropos": "Informazioni su RummiCard", "masquer": "Nascondi RummiCard",
             "masquerAutres": "Nascondi altre", "quitter": "Esci da RummiCard",
             "partie": "Partita", "nouvelle": "Nuova partita…", "suivant": "Al prossimo!",
             "annuler": "Annulla l\u{2019}ultimo movimento", "refaire": "Rigioca",
             "piocher": "Pesca", "magique": "Magia", "trier": "Cambia l\u{2019}ordine della mano",
             "options": "Opzioni…", "fenetre": "Finestra", "reduire": "Riduci",
             "zoom": "Zoom", "plein": "Schermo intero", "aide": "Aiuto", "regles": "Regole del gioco",
             "version": "Versione", "compilee": "Compilata il", "fermer": "Chiudi",
             "desc": "Le regole del ramino, giocate con 2 mazzi da 52 carte.\nTrascini una carta sul tavolo: si sistema da sola al posto giusto, e il tavolo si riorganizza se serve."],
      "nl": ["apropos": "Over RummiCard", "masquer": "Verberg RummiCard",
             "masquerAutres": "Verberg andere", "quitter": "Stop RummiCard",
             "partie": "Spel", "nouvelle": "Nieuw spel…", "suivant": "Volgende!",
             "annuler": "Laatste zet ongedaan maken", "refaire": "Terug",
             "piocher": "Trekken", "magique": "Magie", "trier": "Ordening van de hand wisselen",
             "options": "Instellingen…", "fenetre": "Venster", "reduire": "Minimaliseer",
             "zoom": "Zoom", "plein": "Volledig scherm", "aide": "Help", "regles": "Spelregels",
             "version": "Versie", "compilee": "Gebouwd op", "fermer": "Sluiten",
             "desc": "De regels van rummy, gespeeld met 2 spellen van 52 kaarten.\nSleep een kaart naar de tafel: ze legt zichzelf op de juiste plaats, en de tafel schikt zich zo nodig opnieuw."],
      "es": ["apropos": "Acerca de RummiCard", "masquer": "Ocultar RummiCard",
             "masquerAutres": "Ocultar otros", "quitter": "Salir de RummiCard",
             "partie": "Partida", "nouvelle": "Nueva partida…", "suivant": "¡Al siguiente!",
             "annuler": "Deshacer el último movimiento", "refaire": "Rehacer",
             "piocher": "Robar", "magique": "Magia", "trier": "Cambiar el orden de la mano",
             "options": "Opciones…", "fenetre": "Ventana", "reduire": "Minimizar",
             "zoom": "Zoom", "plein": "Pantalla completa", "aide": "Ayuda", "regles": "Reglas del juego",
             "version": "Versión", "compilee": "Compilada el", "fermer": "Cerrar",
             "desc": "Las reglas del rummy, jugadas con 2 barajas de 52 cartas.\nArrastre una carta a la mesa: se coloca sola en el lugar correcto, y la mesa se reorganiza si hace falta."]
    ]

    private var langue: String = AppDelegate.langueInitiale()

    private static func langueInitiale() -> String {
        if let json = UserDefaults.standard.string(forKey: prefsKey),
           let data = json.data(using: .utf8),
           let d = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let l = d["langue"] as? String, LANGUES.contains(l) {
            return l
        }
        let sys = String((Locale.preferredLanguages.first ?? "fr").prefix(2))
        return LANGUES.contains(sys) ? sys : "en"
    }

    private func M(_ cle: String) -> String {
        return AppDelegate.MENUS[langue]?[cle] ?? AppDelegate.MENUS["fr"]![cle] ?? cle
    }

    // MARK: - Menus

    private func buildMenu() {
        let mainMenu = NSMenu()

        // Menu application
        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: M("apropos"), action: #selector(about), keyEquivalent: "")
            .target = self
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: M("masquer"), action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let hideOthers = appMenu.addItem(withTitle: M("masquerAutres"),
                                         action: #selector(NSApplication.hideOtherApplications(_:)),
                                         keyEquivalent: "h")
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: M("quitter"), action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        mainMenu.addItem(appItem)

        // Menu Partie
        let gameItem = NSMenuItem()
        let gameMenu = NSMenu(title: M("partie"))
        gameMenu.addItem(withTitle: M("nouvelle"), action: #selector(newGame), keyEquivalent: "n").target = self
        gameMenu.addItem(.separator())
        gameMenu.addItem(withTitle: M("suivant"), action: #selector(commitTurn), keyEquivalent: "\r").target = self
        gameMenu.addItem(withTitle: M("annuler"), action: #selector(undoTurn), keyEquivalent: "z").target = self
        let rewind = gameMenu.addItem(withTitle: M("refaire"),
                                      action: #selector(rewindAI), keyEquivalent: "z")
        rewind.keyEquivalentModifierMask = [.command, .shift]
        rewind.target = self
        gameMenu.addItem(withTitle: M("piocher"), action: #selector(drawCard), keyEquivalent: "p").target = self
        gameMenu.addItem(withTitle: M("magique"), action: #selector(autoPlay), keyEquivalent: "j").target = self
        gameMenu.addItem(withTitle: M("trier"), action: #selector(sortHand), keyEquivalent: "t").target = self
        gameMenu.addItem(.separator())
        gameMenu.addItem(withTitle: M("options"), action: #selector(showOptions), keyEquivalent: ",").target = self
        gameItem.submenu = gameMenu
        mainMenu.addItem(gameItem)

        // Menu Fenêtre
        let winItem = NSMenuItem()
        let winMenu = NSMenu(title: M("fenetre"))
        winMenu.addItem(withTitle: M("reduire"), action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        winMenu.addItem(withTitle: M("zoom"), action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        winMenu.addItem(.separator())
        let full = winMenu.addItem(withTitle: M("plein"),
                                   action: #selector(NSWindow.toggleFullScreen(_:)),
                                   keyEquivalent: "f")
        full.keyEquivalentModifierMask = [.command, .control]
        winItem.submenu = winMenu
        mainMenu.addItem(winItem)
        NSApp.windowsMenu = winMenu

        // Menu Aide
        let helpItem = NSMenuItem()
        let helpMenu = NSMenu(title: M("aide"))
        helpMenu.addItem(withTitle: M("regles"), action: #selector(showRules), keyEquivalent: "?").target = self
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
        \(M("version")) \(Self.version)
        \(M("compilee")) \(Self.buildDate)

        \(M("desc"))

        \(Self.copyright)
        """
        alert.addButton(withTitle: M("fermer"))
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
        // La langue a changé dans le jeu : les menus suivent.
        if let l = dict["langue"] as? String, Self.LANGUES.contains(l), l != langue {
            langue = l
            buildMenu()
        }
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
