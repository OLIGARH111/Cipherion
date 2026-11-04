import CallKit
import UIKit

/// Shows incoming Cipherion calls on the iPhone system call screen (CallKit):
/// lock screen, full-screen ringing, Recents, Bluetooth/CarPlay buttons.
final class CallManager: NSObject, CXProviderDelegate {
    static let shared = CallManager()

    struct Call {
        let uuid: UUID
        let id: String
        let chat: String?
        let account: String?
        var answered = false
    }

    weak var web: WebViewController?
    private let provider: CXProvider
    private let controller = CXCallController()
    private var calls: [UUID: Call] = [:]
    private static let ringTimeout: TimeInterval = 45

    private override init() {
        let config = CXProviderConfiguration()
        config.supportsVideo = true
        config.maximumCallGroups = 1
        config.maximumCallsPerCallGroup = 1
        config.supportedHandleTypes = [.generic]
        config.includesCallsInRecents = true
        if let icon = UIImage(named: "CallKitIcon") { config.iconTemplateImageData = icon.pngData() }
        provider = CXProvider(configuration: config)
        super.init()
        provider.setDelegate(self, queue: nil)
    }

    // MARK: VoIP push

    /// iOS terminates the app (and eventually stops VoIP pushes) unless every
    /// VoIP push reports a call to CallKit before `completion` runs.
    func handlePush(_ payload: [AnyHashable: Any], completion: @escaping () -> Void) {
        let type = payload["type"] as? String
        let callId = payload["call"] as? String ?? ""
        let uuid = (payload["uuid"] as? String).flatMap(UUID.init(uuidString:)) ?? UUID()

        if type == "end" {
            let reason = payload["reason"] as? String
            if let call = calls[uuid] {
                // This iPhone answered it: the "answered elsewhere" notice is about us.
                if !(call.answered && reason == "answered") {
                    calls.removeValue(forKey: uuid)
                    provider.reportCall(with: uuid, endedAt: nil, reason: endReason(reason))
                }
                completion()
            } else {
                // The ring push was never shown (app was killed in between): report and end at once.
                report(uuid: uuid, name: "Cipherion", video: false) { [weak self] _ in
                    self?.provider.reportCall(with: uuid, endedAt: nil, reason: self?.endReason(reason) ?? .remoteEnded)
                    completion()
                }
            }
            return
        }

        let name = (payload["title"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "Cipherion"
        let video = payload["video"] as? Bool ?? false
        let expiresAt = (payload["expiresAt"] as? NSNumber)?.doubleValue ?? 0
        let expired = expiresAt > 0 && Date().timeIntervalSince1970 * 1000 >= expiresAt

        if !expired {
            calls[uuid] = Call(uuid: uuid, id: callId, chat: payload["chat"] as? String, account: payload["account"] as? String)
        }
        report(uuid: uuid, name: name, video: video) { [weak self] error in
            guard let self else { completion(); return }
            if expired {
                self.provider.reportCall(with: uuid, endedAt: nil, reason: .unanswered)
            } else if error != nil {
                // Do Not Disturb, blocked caller or another call in progress.
                self.calls.removeValue(forKey: uuid)
            } else {
                self.web?.preload()
                DispatchQueue.main.asyncAfter(deadline: .now() + Self.ringTimeout) {
                    if let call = self.calls[uuid], !call.answered {
                        self.calls.removeValue(forKey: uuid)
                        self.provider.reportCall(with: uuid, endedAt: nil, reason: .unanswered)
                    }
                }
            }
            completion()
        }
    }

    private func report(uuid: UUID, name: String, video: Bool, completion: @escaping (Error?) -> Void) {
        let update = CXCallUpdate()
        update.remoteHandle = CXHandle(type: .generic, value: name)
        update.localizedCallerName = name
        update.hasVideo = video
        update.supportsHolding = false
        update.supportsGrouping = false
        update.supportsUngrouping = false
        update.supportsDTMF = false
        provider.reportNewIncomingCall(with: uuid, update: update, completion: completion)
    }

    private func endReason(_ reason: String?) -> CXCallEndedReason {
        switch reason {
        case "answered": return .answeredElsewhere
        case "declined": return .declinedElsewhere
        case "missed": return .unanswered
        default: return .remoteEnded
        }
    }

    // MARK: From the web page

    /// The call ended inside Cipherion (hang-up button, the other side left, network loss).
    func webEnded(callId: String) {
        guard let (uuid, _) = calls.first(where: { $0.value.id == callId }) else { return }
        calls.removeValue(forKey: uuid)
        controller.request(CXTransaction(action: CXEndCallAction(call: uuid))) { [weak self] error in
            if error != nil { self?.provider.reportCall(with: uuid, endedAt: nil, reason: .remoteEnded) }
        }
    }

    // MARK: CXProviderDelegate

    func providerDidReset(_ provider: CXProvider) {
        for call in calls.values { web?.hangup(callId: call.id) }
        calls.removeAll()
    }

    func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
        guard var call = calls[action.callUUID] else { action.fail(); return }
        call.answered = true
        calls[action.callUUID] = call
        web?.answer(call: call)
        action.fulfill()
    }

    func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
        // Missing means the page already ended it (see webEnded).
        if let call = calls.removeValue(forKey: action.callUUID) { web?.hangup(callId: call.id) }
        action.fulfill()
    }

    func provider(_ provider: CXProvider, perform action: CXSetMutedCallAction) {
        if let call = calls[action.callUUID] { web?.setMuted(callId: call.id, muted: action.isMuted) }
        action.fulfill()
    }
}
