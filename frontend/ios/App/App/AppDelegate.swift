import UIKit
import Capacitor
import WebKit

#if canImport(FirebaseCore)
import FirebaseCore
#endif

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?
    private var hasLoggedScrollFix = false

    private func enforceWebViewScrolling() {
        let scenes = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }

        for scene in scenes {
            for window in scene.windows {
                if let rootView = window.rootViewController?.view {
                    enableScrollingRecursively(in: rootView)
                }
            }
        }
    }

    private func enableScrollingRecursively(in view: UIView) {
        if let webView = view as? WKWebView {
            let scrollView = webView.scrollView
            scrollView.isScrollEnabled = true
            // Disable bounce to avoid empty gap above first content row.
            scrollView.alwaysBounceVertical = false
            scrollView.bounces = false
            scrollView.panGestureRecognizer.isEnabled = true
            if !hasLoggedScrollFix {
                print("[ScrollFix] WKWebView scrolling ON, bounce OFF")
                hasLoggedScrollFix = true
            }
        }

        for child in view.subviews {
            enableScrollingRecursively(in: child)
        }
    }

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
#if canImport(FirebaseCore)
        // Configure Firebase if not already configured
        if FirebaseApp.app() == nil {
            FirebaseApp.configure()
        }
        // Assert configuration succeeded to surface issues early during development
        assert(FirebaseApp.app() != nil, "Firebase failed to configure. Check GoogleService-Info.plist presence and target membership.")
        // Optional: Log clientID to verify options loaded
        if let options = FirebaseApp.app()?.options {
            print("[Firebase] clientID:", options.clientID ?? "nil")
        }
#endif

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
            self?.enforceWebViewScrolling()
        }
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak self] in
            self?.enforceWebViewScrolling()
        }
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
