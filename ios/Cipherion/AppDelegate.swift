import PushKit
import UIKit
import UserNotifications

enum AppConfig {
    /// Set CipherionServerURL in Info.plist to use another server.
    static let serverURL: URL = {
        let value = Bundle.main.object(forInfoDictionaryKey: "CipherionServerURL") as? String
        return URL(string: value ?? "") ?? URL(string: "https://cipherion-messenger.onrender.com")!
    }()
}

@main
final class AppDelegate: UIResponder, UIApplicationDelegate, PKPushRegistryDelegate, UNUserNotificationCenterDelegate {
    var window: UIWindow?
    private let web = WebViewController()
    private var voipRegistry: PKPushRegistry?

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        CallManager.shared.web = web

        // Register for VoIP pushes first: when iOS wakes the app for a call,
        // the push is delivered only after this registry exists.
        let registry = PKPushRegistry(queue: .main)
        registry.delegate = self
        registry.desiredPushTypes = [.voIP]
        voipRegistry = registry

        let center = UNUserNotificationCenter.current()
        center.delegate = self
        center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            guard granted else { return }
            DispatchQueue.main.async { application.registerForRemoteNotifications() }
        }

        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = web
        window.makeKeyAndVisible()
        self.window = window
        return true
    }

    // MARK: Message notifications

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        web.setAlertToken(deviceToken.hex)
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        // The open app shows new messages itself.
        completionHandler([])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        if let url = response.notification.request.content.userInfo["url"] as? String { web.open(url: url) }
        completionHandler()
    }

    // MARK: Calls (PushKit)

    func pushRegistry(_ registry: PKPushRegistry, didUpdate credentials: PKPushCredentials, for type: PKPushType) {
        web.setVoipToken(credentials.token.hex)
    }

    func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {
        web.setVoipToken(nil)
    }

    func pushRegistry(_ registry: PKPushRegistry, didReceiveIncomingPushWith payload: PKPushPayload,
                      for type: PKPushType, completion: @escaping () -> Void) {
        CallManager.shared.handlePush(payload.dictionaryPayload, completion: completion)
    }
}

private extension Data {
    var hex: String { map { String(format: "%02x", $0) }.joined() }
}
