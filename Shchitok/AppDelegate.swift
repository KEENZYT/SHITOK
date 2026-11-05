import UIKit
import WebKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = GameViewController()
        window.makeKeyAndVisible()
        self.window = window
        return true
    }
}

final class GameViewController: UIViewController, WKNavigationDelegate {
    private let webView: WKWebView = {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.translatesAutoresizingMaskIntoConstraints = false
        view.isOpaque = false
        view.backgroundColor = UIColor(red: 0.043, green: 0.055, blue: 0.075, alpha: 1)
        view.scrollView.backgroundColor = view.backgroundColor
        view.scrollView.contentInsetAdjustmentBehavior = .never
        view.scrollView.bounces = false
        // The board handles its own two-finger gestures; do not zoom the whole page.
        view.scrollView.pinchGestureRecognizer?.isEnabled = false
        return view
    }()

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.043, green: 0.055, blue: 0.075, alpha: 1)
        webView.navigationDelegate = self
        view.addSubview(webView)
        let safe = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: safe.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: safe.trailingAnchor),
            webView.topAnchor.constraint(equalTo: safe.topAnchor),
            webView.bottomAnchor.constraint(equalTo: safe.bottomAnchor)
        ])
        guard let directory = Bundle.main.resourceURL?.appendingPathComponent("Web", isDirectory: true) else {
            showLoadError()
            return
        }
        let index = directory.appendingPathComponent("index.html")
        guard FileManager.default.fileExists(atPath: index.path) else {
            showLoadError()
            return
        }
        webView.loadFileURL(index, allowingReadAccessTo: directory)
    }

    private func showLoadError() {
        webView.loadHTMLString("<body style='background:#0b0e13;color:white;font:18px system-ui;padding:24px'>Не удалось загрузить файлы игры. Попробуйте переустановить приложение.</body>", baseURL: nil)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        // The bundled game is offline; do not navigate to remote websites.
        decisionHandler(url.isFileURL || url.absoluteString == "about:blank" ? .allow : .cancel)
    }
}
