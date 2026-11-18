import AppKit
import SwiftUI
import WebKit

/// Всё, что интерфейс дашборда должен знать от оболочки.
struct WebState: Equatable {
    var payloadJSON: String?
    var savedAt: Date?
    var loading: Bool
    var error: String?
    var configured: Bool
    var alarms: [String: Bool]
}

/// Сообщения из интерфейса (window.webkit.messageHandlers.app.postMessage).
enum WebAction {
    case refresh
    case settings
    case setAlarms(Any?)

    init?(body: Any) {
        if let text = body as? String {
            switch text {
            case "refresh": self = .refresh
            case "settings": self = .settings
            default: return nil
            }
            return
        }
        if let dict = body as? [String: Any], (dict["type"] as? String) == "setAlarms" {
            self = .setAlarms(dict["alarms"])
            return
        }
        return nil
    }
}

enum WebAssets {
    /// web/dist внутри .app (Contents/Resources/web). Для разработки — переменная PIRANHAS_WEB_DIR.
    static func indexURL() -> URL? {
        if let dir = ProcessInfo.processInfo.environment["PIRANHAS_WEB_DIR"] {
            let url = URL(fileURLWithPath: dir).appendingPathComponent("index.html")
            if FileManager.default.fileExists(atPath: url.path) { return url }
        }
        return Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "web")
    }
}

/// Интерфейс дашборда (web/dist) в WKWebView. Данные приходят из Swift,
/// страница в сеть не ходит (CSP: default-src 'none').
struct DashboardWebView: NSViewRepresentable {
    let state: WebState
    let onAction: (WebAction) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onAction: onAction)
    }

    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(context.coordinator, name: "app")
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        context.coordinator.webView = webView
        if let index = WebAssets.indexURL() {
            webView.loadFileURL(index, allowingReadAccessTo: index.deletingLastPathComponent())
        } else {
            webView.loadHTMLString(
                "<p style='font-family:-apple-system;padding:24px'>Не найдены файлы интерфейса (web). Пересоберите приложение.</p>",
                baseURL: nil
            )
        }
        context.coordinator.push(state)
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        context.coordinator.onAction = onAction
        context.coordinator.push(state)
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        weak var webView: WKWebView?
        var onAction: (WebAction) -> Void
        private var pageReady = false
        private var pending: WebState?
        private var lastSent: WebState?

        init(onAction: @escaping (WebAction) -> Void) {
            self.onAction = onAction
        }

        func push(_ state: WebState) {
            pending = state
            flush()
        }

        private func flush() {
            guard pageReady, let state = pending, let webView else { return }
            pending = nil
            guard state != lastSent else { return }
            lastSent = state
            webView.evaluateJavaScript(Self.script(for: state), completionHandler: nil)
        }

        static func script(for state: WebState) -> String {
            var meta: [String: Any] = [
                "loading": state.loading,
                "configured": state.configured,
            ]
            meta["savedAt"] = state.savedAt.map { ISO8601DateFormatter().string(from: $0) } ?? NSNull()
            meta["error"] = state.error ?? NSNull()
            meta["alarms"] = state.alarms
            let metaJSON = (try? JSONSerialization.data(withJSONObject: meta))
                .flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
            // payloadJSON уже проверен PayloadValidator: это валидный JSON-объект.
            let payload = state.payloadJSON ?? "null"
            return "window.PiranhasApp && window.PiranhasApp.render(\(payload), \(metaJSON));"
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            pageReady = true
            if pending == nil { pending = lastSent }
            lastSent = nil
            flush()
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let action = WebAction(body: message.body) else { return }
            onAction(action)
        }
    }
}
