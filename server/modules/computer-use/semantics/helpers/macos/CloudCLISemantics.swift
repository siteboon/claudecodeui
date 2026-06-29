import AppKit
import ApplicationServices
import Foundation

typealias JSON = [String: Any]

struct ElementRecord {
    let index: String
    let role: String
    let title: String?
    let value: String?
    let bounds: [String: Double]?
    let actions: [String]
}

var stateElements: [String: [ElementRecord]] = [:]
var stateAxElements: [String: [String: AXUIElement]] = [:]
var stateOrder: [String] = []
let maxStoredStates = 100

func jsonLine(_ object: Any) {
    guard JSONSerialization.isValidJSONObject(object),
          let data = try? JSONSerialization.data(withJSONObject: object),
          let text = String(data: data, encoding: .utf8)
    else {
        print("{\"error\":\"Failed to encode JSON\"}")
        fflush(stdout)
        return
    }
    print(text)
    fflush(stdout)
}

func respond(id: Any?, result: Any) {
    jsonLine(["id": id ?? NSNull(), "result": result])
}

func respondError(id: Any?, _ message: String) {
    jsonLine(["id": id ?? NSNull(), "error": message])
}

func stringAttr(_ element: AXUIElement, _ attr: CFString) -> String? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, attr, &value) == .success else { return nil }
    return value as? String
}

func boolAttr(_ element: AXUIElement, _ attr: CFString) -> Bool? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, attr, &value) == .success else { return nil }
    return value as? Bool
}

func arrayAttr(_ element: AXUIElement, _ attr: CFString) -> [AXUIElement] {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, attr, &value) == .success else { return [] }
    return value as? [AXUIElement] ?? []
}

func actions(_ element: AXUIElement) -> [String] {
    var names: CFArray?
    guard AXUIElementCopyActionNames(element, &names) == .success else { return [] }
    return names as? [String] ?? []
}

func bounds(_ element: AXUIElement) -> [String: Double]? {
    var positionRef: CFTypeRef?
    var sizeRef: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, kAXPositionAttribute as CFString, &positionRef) == .success,
          AXUIElementCopyAttributeValue(element, kAXSizeAttribute as CFString, &sizeRef) == .success,
          let positionValue = positionRef,
          let sizeValue = sizeRef
    else { return nil }

    var point = CGPoint.zero
    var size = CGSize.zero
    guard CFGetTypeID(positionValue) == AXValueGetTypeID(),
          CFGetTypeID(sizeValue) == AXValueGetTypeID()
    else { return nil }

    let positionAxValue = positionValue as! AXValue
    let sizeAxValue = sizeValue as! AXValue
    guard AXValueGetValue(positionAxValue, .cgPoint, &point),
          AXValueGetValue(sizeAxValue, .cgSize, &size)
    else { return nil }

    return [
        "x": Double(point.x),
        "y": Double(point.y),
        "width": Double(size.width),
        "height": Double(size.height),
    ]
}

func record(_ element: AXUIElement, index: String) -> ElementRecord {
    ElementRecord(
        index: index,
        role: stringAttr(element, kAXRoleAttribute as CFString) ?? "AXUnknown",
        title: stringAttr(element, kAXTitleAttribute as CFString) ?? stringAttr(element, kAXDescriptionAttribute as CFString),
        value: stringAttr(element, kAXValueAttribute as CFString),
        bounds: bounds(element),
        actions: actions(element)
    )
}

func cachedElement(_ params: JSON) -> AXUIElement? {
    guard let stateId = params["stateId"] as? String,
          let elementIndex = params["element_index"] as? String
    else {
        return nil
    }
    return stateAxElements[stateId]?[elementIndex]
}

func dictionary(_ record: ElementRecord) -> JSON {
    var output: JSON = [
        "index": record.index,
        "role": record.role,
        "actions": record.actions,
    ]
    if let title = record.title { output["title"] = title }
    if let value = record.value { output["value"] = value }
    if let bounds = record.bounds { output["bounds"] = bounds }
    return output
}

func pruneStoredStates() {
    while stateOrder.count > maxStoredStates {
        let evicted = stateOrder.removeFirst()
        stateElements.removeValue(forKey: evicted)
        stateAxElements.removeValue(forKey: evicted)
    }
}

func resolveApp(_ query: String) throws -> NSRunningApplication {
    let normalized = query.lowercased()
    let apps = NSWorkspace.shared.runningApplications.filter { app in
        app.activationPolicy == .regular
    }
    if let app = apps.first(where: { $0.bundleIdentifier?.lowercased() == normalized }) {
        return app
    }
    if let app = apps.first(where: { ($0.localizedName ?? "").lowercased() == normalized }) {
        return app
    }
    if let app = apps.first(where: { ($0.localizedName ?? "").lowercased().contains(normalized) }) {
        return app
    }
    throw NSError(domain: "CloudCLISemantics", code: 404, userInfo: [NSLocalizedDescriptionKey: "App is not running: \(query)"])
}

func listApps() -> [[String: Any]] {
    NSWorkspace.shared.runningApplications
        .filter { $0.activationPolicy == .regular }
        .map { app in
            [
                "id": app.bundleIdentifier ?? app.localizedName ?? "\(app.processIdentifier)",
                "name": app.localizedName ?? app.bundleIdentifier ?? "Unknown",
                "bundleIdentifier": app.bundleIdentifier ?? "",
                "pid": Int(app.processIdentifier),
                "running": true,
            ]
        }
}

func walk(_ element: AXUIElement, depth: Int, maxDepth: Int, records: inout [ElementRecord], axRecords: inout [String: AXUIElement], limit: Int) {
    if depth > maxDepth || records.count >= limit { return }
    let index = "\(records.count + 1)"
    records.append(record(element, index: index))
    axRecords[index] = element
    for child in arrayAttr(element, kAXChildrenAttribute as CFString) {
        walk(child, depth: depth + 1, maxDepth: maxDepth, records: &records, axRecords: &axRecords, limit: limit)
        if records.count >= limit { return }
    }
}

func pngDataUrlForMainDisplay() -> String? {
    let fileURL = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("cloudcli-semantics-\(UUID().uuidString).png")
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
    process.arguments = ["-x", "-t", "png", fileURL.path]

    do {
        try process.run()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else { return nil }
        let png = try Data(contentsOf: fileURL)
        try? FileManager.default.removeItem(at: fileURL)
        return png.isEmpty ? nil : "data:image/png;base64,\(png.base64EncodedString())"
    } catch {
        try? FileManager.default.removeItem(at: fileURL)
        return nil
    }
}

func getAppState(_ params: JSON) throws -> JSON {
    let appName = params["app"] as? String ?? ""
    let app = try resolveApp(appName)
    let axApp = AXUIElementCreateApplication(app.processIdentifier)
    let windows = arrayAttr(axApp, kAXWindowsAttribute as CFString)
    let root = windows.first ?? axApp
    var records: [ElementRecord] = []
    var axRecords: [String: AXUIElement] = [:]
    walk(root, depth: 0, maxDepth: 5, records: &records, axRecords: &axRecords, limit: 300)
    let stateId = "state_\(UUID().uuidString)"
    stateElements[stateId] = records
    stateAxElements[stateId] = axRecords
    stateOrder.append(stateId)
    pruneStoredStates()

    let elements = records.map(dictionary)
    return [
        "stateId": stateId,
        "app": app.localizedName ?? app.bundleIdentifier ?? appName,
        "platform": "darwin",
        "screenshotDataUrl": pngDataUrlForMainDisplay() ?? NSNull(),
        "displaySize": [
            "width": Int(CGDisplayPixelsWide(CGMainDisplayID())),
            "height": Int(CGDisplayPixelsHigh(CGMainDisplayID())),
        ],
        "elements": elements,
        "accessibilityTree": elements,
        "treeText": elements.map { "\($0["index"] ?? "") \($0["role"] ?? "") \($0["title"] ?? "")" }.joined(separator: "\n"),
    ]
}

func cgMouseButton(_ value: Any?) -> CGMouseButton {
    guard let button = value as? String else { return .left }
    switch button {
    case "right": return .right
    case "middle": return .center
    default: return .left
    }
}

func mouseEventTypes(_ button: CGMouseButton) -> (CGEventType, CGEventType) {
    switch button {
    case .right: return (.rightMouseDown, .rightMouseUp)
    case .center: return (.otherMouseDown, .otherMouseUp)
    default: return (.leftMouseDown, .leftMouseUp)
    }
}

func postMouseClick(point: CGPoint, button: CGMouseButton, clickCount: Int = 1) throws {
    guard let source = CGEventSource(stateID: .combinedSessionState) else {
        throw NSError(domain: "CloudCLISemantics", code: 500, userInfo: [NSLocalizedDescriptionKey: "Failed to create CGEventSource"])
    }
    let eventTypes = mouseEventTypes(button)
    for _ in 0..<max(1, clickCount) {
        let down = CGEvent(mouseEventSource: source, mouseType: eventTypes.0, mouseCursorPosition: point, mouseButton: button)
        let up = CGEvent(mouseEventSource: source, mouseType: eventTypes.1, mouseCursorPosition: point, mouseButton: button)
        down?.post(tap: .cghidEventTap)
        up?.post(tap: .cghidEventTap)
        usleep(80_000)
    }
}

func postDrag(from: CGPoint, to: CGPoint, button: CGMouseButton) throws {
    guard let source = CGEventSource(stateID: .combinedSessionState) else {
        throw NSError(domain: "CloudCLISemantics", code: 500, userInfo: [NSLocalizedDescriptionKey: "Failed to create CGEventSource"])
    }
    let eventTypes = mouseEventTypes(button)
    CGEvent(mouseEventSource: source, mouseType: eventTypes.0, mouseCursorPosition: from, mouseButton: button)?.post(tap: .cghidEventTap)
    usleep(80_000)
    CGEvent(mouseEventSource: source, mouseType: .leftMouseDragged, mouseCursorPosition: to, mouseButton: button)?.post(tap: .cghidEventTap)
    usleep(80_000)
    CGEvent(mouseEventSource: source, mouseType: eventTypes.1, mouseCursorPosition: to, mouseButton: button)?.post(tap: .cghidEventTap)
}

func runAppleScript(_ script: String) throws {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
    process.arguments = ["-e", script]
    process.standardOutput = Pipe()
    let stderr = Pipe()
    process.standardError = stderr
    try process.run()
    process.waitUntilExit()
    if process.terminationStatus != 0 {
        let data = stderr.fileHandleForReading.readDataToEndOfFile()
        let message = String(data: data, encoding: .utf8) ?? "AppleScript failed."
        throw NSError(domain: "CloudCLISemantics", code: Int(process.terminationStatus), userInfo: [NSLocalizedDescriptionKey: message])
    }
}

func escapedAppleScriptString(_ value: String) -> String {
    value.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"")
}

func pointForElement(_ params: JSON) -> CGPoint? {
    if let x = params["x"] as? Double, let y = params["y"] as? Double {
        return CGPoint(x: x, y: y)
    }
    guard let stateId = params["stateId"] as? String,
          let elementIndex = params["element_index"] as? String,
          let element = stateElements[stateId]?.first(where: { $0.index == elementIndex }),
          let b = element.bounds,
          let x = b["x"], let y = b["y"], let width = b["width"], let height = b["height"]
    else {
        return nil
    }
    return CGPoint(x: x + width / 2, y: y + height / 2)
}

func click(_ params: JSON) throws -> JSON {
    if let element = cachedElement(params),
       cgMouseButton(params["mouse_button"]) == .left,
       (params["click_count"] as? Int ?? 1) == 1,
       actions(element).contains(kAXPressAction as String),
       AXUIElementPerformAction(element, kAXPressAction as CFString) == .success {
        return try getAppState(params)
    }

    guard let point = pointForElement(params) else {
        throw NSError(domain: "CloudCLISemantics", code: 400, userInfo: [NSLocalizedDescriptionKey: "click_element requires x/y or stateId + element_index"])
    }
    let clickCount = params["click_count"] as? Int ?? 1
    try postMouseClick(point: point, button: cgMouseButton(params["mouse_button"]), clickCount: clickCount)
    return try getAppState(params)
}

func performSecondaryAction(_ params: JSON) throws -> JSON {
    if let element = cachedElement(params),
       actions(element).contains(kAXShowMenuAction as String),
       AXUIElementPerformAction(element, kAXShowMenuAction as CFString) == .success {
        return try getAppState(params)
    }
    guard let point = pointForElement(params) else {
        throw NSError(domain: "CloudCLISemantics", code: 400, userInfo: [NSLocalizedDescriptionKey: "perform_secondary_action requires x/y or stateId + element_index"])
    }
    try postMouseClick(point: point, button: .right)
    return try getAppState(params)
}

func setValue(_ params: JSON) throws -> JSON {
    guard let value = params["value"] as? String else {
        throw NSError(domain: "CloudCLISemantics", code: 400, userInfo: [NSLocalizedDescriptionKey: "set_value requires value"])
    }
    if let element = cachedElement(params),
       AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, value as CFTypeRef) == .success {
        return try getAppState(params)
    }
    guard let point = pointForElement(params) else {
        throw NSError(domain: "CloudCLISemantics", code: 400, userInfo: [NSLocalizedDescriptionKey: "set_value requires x/y or stateId + element_index"])
    }
    try postMouseClick(point: point, button: .left)
    try runAppleScript("tell application \"System Events\" to keystroke \"a\" using command down")
    try runAppleScript("tell application \"System Events\" to keystroke \"\(escapedAppleScriptString(value))\"")
    return try getAppState(params)
}

func typeText(_ params: JSON) throws -> JSON {
    let text = params["text"] as? String ?? ""
    try runAppleScript("tell application \"System Events\" to keystroke \"\(escapedAppleScriptString(text))\"")
    return try getAppState(params)
}

func appleScriptModifiers(_ parts: [String]) -> String {
    let modifiers = parts.compactMap { part -> String? in
        switch part.lowercased() {
        case "cmd", "command", "meta": return "command down"
        case "ctrl", "control": return "control down"
        case "alt", "option": return "option down"
        case "shift": return "shift down"
        default: return nil
        }
    }
    return modifiers.isEmpty ? "" : " using {\(modifiers.joined(separator: ", "))}"
}

func appleScriptKeyCode(_ key: String) -> Int? {
    switch key.lowercased() {
    case "return", "enter": return 36
    case "tab": return 48
    case "space": return 49
    case "delete", "backspace": return 51
    case "escape", "esc": return 53
    case "left": return 123
    case "right": return 124
    case "down": return 125
    case "up": return 126
    default: return nil
    }
}

func pressKey(_ params: JSON) throws -> JSON {
    let raw = params["key"] as? String ?? ""
    let parts = raw.split(separator: "+").map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
    let key = parts.last ?? raw
    let modifiers = appleScriptModifiers(Array(parts.dropLast()))
    if let keyCode = appleScriptKeyCode(key) {
        try runAppleScript("tell application \"System Events\" to key code \(keyCode)\(modifiers)")
    } else {
        try runAppleScript("tell application \"System Events\" to keystroke \"\(escapedAppleScriptString(key))\"\(modifiers)")
    }
    return try getAppState(params)
}

func scrollElement(_ params: JSON) throws -> JSON {
    guard let point = pointForElement(params) else {
        throw NSError(domain: "CloudCLISemantics", code: 400, userInfo: [NSLocalizedDescriptionKey: "scroll_element requires x/y or stateId + element_index"])
    }
    CGWarpMouseCursorPosition(point)
    let direction = params["direction"] as? String ?? "down"
    let pages = params["pages"] as? Double ?? 1.0
    let amount = Int32(max(1.0, abs(pages) * 8.0))
    let vertical = direction == "up" ? amount : direction == "down" ? -amount : 0
    let horizontal = direction == "left" ? amount : direction == "right" ? -amount : 0
    CGEvent(scrollWheelEvent2Source: nil, units: .line, wheelCount: 2, wheel1: vertical, wheel2: horizontal, wheel3: 0)?.post(tap: .cghidEventTap)
    return try getAppState(params)
}

func drag(_ params: JSON) throws -> JSON {
    guard let fromX = params["from_x"] as? Double,
          let fromY = params["from_y"] as? Double,
          let toX = params["to_x"] as? Double,
          let toY = params["to_y"] as? Double
    else {
        throw NSError(domain: "CloudCLISemantics", code: 400, userInfo: [NSLocalizedDescriptionKey: "drag requires from_x/from_y/to_x/to_y"])
    }
    try postDrag(from: CGPoint(x: fromX, y: fromY), to: CGPoint(x: toX, y: toY), button: cgMouseButton(params["mouse_button"]))
    return try getAppState(params)
}

func handle(_ request: JSON) {
    let id = request["id"]
    let method = request["method"] as? String ?? ""
    let params = request["params"] as? JSON ?? [:]

    do {
        switch method {
        case "list_apps":
            respond(id: id, result: listApps())
        case "get_app_state":
            respond(id: id, result: try getAppState(params))
        case "click_element":
            respond(id: id, result: try click(params))
        case "perform_secondary_action":
            respond(id: id, result: try performSecondaryAction(params))
        case "set_value":
            respond(id: id, result: try setValue(params))
        case "type_text":
            respond(id: id, result: try typeText(params))
        case "press_key":
            respond(id: id, result: try pressKey(params))
        case "scroll_element":
            respond(id: id, result: try scrollElement(params))
        case "drag":
            respond(id: id, result: try drag(params))
        default:
            respondError(id: id, "Method is not implemented yet: \(method)")
        }
    } catch {
        respondError(id: id, error.localizedDescription)
    }
}

while let line = readLine() {
    guard let data = line.data(using: .utf8),
          let object = try? JSONSerialization.jsonObject(with: data),
          let request = object as? JSON
    else {
        respondError(id: nil, "Invalid JSON request")
        continue
    }
    handle(request)
}
