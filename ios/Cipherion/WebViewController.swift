import UIKit
import WebKit

/// Hosts the Cipherion web app and passes call/push events to it (public/native-bridge.js).
final class WebViewController: UIViewController, WKScriptMessageHandler, WKUIDelegate, WKNavigationDelegate {
    private var webView: WKWebView!
    private var loaded = false
    private var ready = false
    private var queue: [[String: Any]] = []
    private var voipToken: String?
    private var alertToken: String?

    #if DEBUG
    private let sandbox = true
    #else
    private let sandbox = false
    #endif

    override func loadView() {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.websiteDataStore = .default()
        config.applicationNameForUserAgent = "CipherioniOS/1"
        config.userContentController.add(WeakHandler(self), name: "cipherion")
        webView = WKWebView(frame: .zero, configuration: config)
        webView.uiDelegate = self
        webView.navigationDelegate = self
        webView.allowsBackForwardNavigationGestures = false
        // The page lays itself out around the notch with env(safe-area-inset-*).
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.isOpaque = false
        webView.backgroundColor = .black
        view = webView
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        preload()
    }

    /// Starts loading the page early (for example while the phone is still ringing),
    /// so the call connects quickly after "Accept".
    func preload() {
        loadViewIfNeeded()
        guard !loaded else { return }
        loaded = true
        webView.load(URLRequest(url: AppConfig.serverURL))
    }

    // MARK: Native → page

    func setVoipToken(_ token: String?) { voipToken = token; sendTokens() }
    func setAlertToken(_ token: String?) { alertToken = token; sendTokens() }

    func answer(call: CallManager.Call) {
        preload()
        var m: [String: Any] = ["type": "answer", "call": call.id]
        if let chat = call.chat { m["chat"] = chat }
        if let account = call.account { m["account"] = account }
        send(m)
    }

    func hangup(callId: String) { send(["type": "end", "call": callId]) }
    func setMuted(callId: String, muted: Bool) { send(["type": "mute", "call": callId, "muted": muted]) }

    func open(url: String) {
        preload()
        send(["type": "open", "url": url])
    }

    private func sendTokens() {
        guard voipToken != nil || alertToken != nil else { return }
        queue.removeAll { $0["type"] as? String == "tokens" }
        var m: [String: Any] = ["type": "tokens", "sandbox": sandbox]
        if let voipToken { m["voip"] = voipToken }
        if let alertToken { m["alert"] = alertToken }
        send(m)
    }

    private func send(_ message: [String: Any]) {
        guard ready else { queue.append(message); return }
        guard let data = try? JSONSerialization.data(withJSONObject: message),
              let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.CipherionNative&&window.CipherionNative.receive(\(json))", completionHandler: nil)
    }

    // MARK: Page → native

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, isTrusted(message.frameInfo.securityOrigin),
              let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "ready":
            ready = true
            sendTokens()
            let pending = queue
            queue.removeAll()
            pending.forEach(send)
        case "callEnded":
            if let call = body["call"] as? String { CallManager.shared.webEnded(callId: call) }
        default:
            break
        }
    }

    // MARK: WebKit

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        // A new page must announce itself again before it can receive events.
        ready = false
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        ready = false
        webView.reload()
    }

    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                 decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        // The system microphone/camera prompt still appears the first time.
        decisionHandler(isTrusted(origin) ? .grant : .deny)
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if url.host == AppConfig.serverURL.host || ["about", "blob", "data"].contains(url.scheme ?? "") {
            decisionHandler(.allow)
        } else {
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
        }
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url { UIApplication.shared.open(url) }
        return nil
    }

    private func isTrusted(_ origin: WKSecurityOrigin) -> Bool {
        origin.protocol == AppConfig.serverURL.scheme && origin.host == AppConfig.serverURL.host
    }
}

/// WKUserContentController retains its handlers; this avoids a retain cycle.
private final class WeakHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
        target?.userContentController(c, didReceive: m)
    }
}
