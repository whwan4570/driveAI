import Capacitor
import UIKit

/// Registers the app's own plugins, which are not npm packages.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(CarConnectionPlugin())
    }
}
