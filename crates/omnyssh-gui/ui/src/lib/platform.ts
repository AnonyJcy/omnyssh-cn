// The platform the webview runs on, from its user agent: WKWebView says Macintosh,
// WebView2 Windows NT, WebKitGTK X11; Linux. app.html makes the same macOS test for the
// title-bar inset, and the e2e suite emulates a platform by its user agent alone.
export const isMac = /Mac/.test(navigator.userAgent);
export const isWindows = /Windows/.test(navigator.userAgent);
