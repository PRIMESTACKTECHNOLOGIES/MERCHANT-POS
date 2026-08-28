import UIKit
import Flutter
import LocalAuthentication

@UIApplicationMain
@objc class AppDelegate: FlutterAppDelegate {
    override func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        // Prevent screenshots
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(preventScreenRecording),
            name: UIScreen.capturedDidChangeNotification,
            object: nil
        )
        
        GeneratedPluginRegistrant.register(with: self)
        return super.application(application, didFinishLaunchingWithOptions: launchOptions)
    }
    
    @objc func preventScreenRecording() {
        let isCaptured = UIScreen.main.isCaptured
        if isCaptured {
            // Show alert or blur view when screen is being recorded
            if let window = UIApplication.shared.keyWindow {
                let blurView = UIVisualEffectView(effect: UIBlurEffect(style: .light))
                blurView.frame = window.bounds
                blurView.tag = 9999
                window.addSubview(blurView)
            }
        } else {
            // Remove blur view
            if let window = UIApplication.shared.keyWindow {
                window.viewWithTag(9999)?.removeFromSuperview()
            }
        }
    }
}
