import AVFoundation
import Capacitor

/// Tells the web app when the phone's audio route is CarPlay, and reads text aloud through that route.
/// Route changes only arrive while the app is running, so the app has to be open (or opened by a
/// Shortcuts "CarPlay connects" automation) for the briefing to start on its own.
@objc(CarConnectionPlugin)
public class CarConnectionPlugin: CAPPlugin, CAPBridgedPlugin, AVSpeechSynthesizerDelegate {
    public let identifier = "CarConnectionPlugin"
    public let jsName = "CarConnection"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "speak", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopSpeaking", returnType: CAPPluginReturnPromise),
    ]

    private let synthesizer = AVSpeechSynthesizer()
    private var pendingSpeech: CAPPluginCall?
    private var connected = false

    override public func load() {
        synthesizer.delegate = self
        connected = Self.isCarPlayRoute()
        NotificationCenter.default.addObserver(
            self, selector: #selector(routeChanged), name: AVAudioSession.routeChangeNotification, object: nil)
    }

    private static func isCarPlayRoute() -> Bool {
        AVAudioSession.sharedInstance().currentRoute.outputs.contains { $0.portType == .carAudio }
    }

    private func state() -> [String: Any] {
        ["connected": connected, "kind": connected ? "carplay" : NSNull()]
    }

    @objc private func routeChanged() {
        let now = Self.isCarPlayRoute()
        DispatchQueue.main.async {
            guard now != self.connected else { return }
            self.connected = now
            self.notifyListeners("carConnectionChange", data: self.state(), retainUntilConsumed: true)
        }
    }

    @objc func getState(_ call: CAPPluginCall) {
        call.resolve(state())
    }

    @objc func speak(_ call: CAPPluginCall) {
        guard let text = call.getString("text"), !text.isEmpty else {
            call.reject("text is required")
            return
        }
        DispatchQueue.main.async {
            do {
                // Spoken prompt over the car speakers; music ducks and resumes afterwards.
                let session = AVAudioSession.sharedInstance()
                try session.setCategory(.playback, mode: .voicePrompt, options: [.duckOthers, .interruptSpokenAudioAndMixWithOthers])
                try session.setActive(true)
            } catch {
                call.reject("Audio session unavailable")
                return
            }
            self.pendingSpeech?.resolve()
            self.pendingSpeech = call
            self.synthesizer.stopSpeaking(at: .immediate)
            let utterance = AVSpeechUtterance(string: text)
            utterance.voice = AVSpeechSynthesisVoice(language: call.getString("lang") ?? "en-US")
            self.synthesizer.speak(utterance)
        }
    }

    @objc func stopSpeaking(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.synthesizer.stopSpeaking(at: .immediate)
            call.resolve()
        }
    }

    private func speechEnded() {
        guard !synthesizer.isSpeaking else { return }
        pendingSpeech?.resolve()
        pendingSpeech = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        speechEnded()
    }

    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        speechEnded()
    }
}
