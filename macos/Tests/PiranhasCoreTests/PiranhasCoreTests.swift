import Foundation
import XCTest
@testable import PiranhasCore

final class SourceSettingsTests: XCTestCase {
    func testBuildsURLWithKey() throws {
        let s = SourceSettings(endpoint: " https://script.google.com/macros/s/ABC/exec ", key: " secret ")
        XCTAssertTrue(s.isComplete)
        XCTAssertEqual(try s.requestURL().absoluteString, "https://script.google.com/macros/s/ABC/exec?key=secret")
    }

    func testReplacesExistingKey() throws {
        let s = SourceSettings(endpoint: "https://script.google.com/macros/s/ABC/exec?key=old&x=1", key: "new")
        let url = try s.requestURL()
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        XCTAssertEqual(items.filter { $0.name == "key" }.map(\.value), ["new"])
        XCTAssertEqual(items.first { $0.name == "x" }?.value, "1")
    }

    func testRejectsHTTPAndGarbage() {
        XCTAssertThrowsError(try SourceSettings(endpoint: "http://script.google.com/x", key: "k").requestURL())
        XCTAssertThrowsError(try SourceSettings(endpoint: "не ссылка", key: "k").requestURL())
        XCTAssertFalse(SourceSettings(endpoint: "https://x", key: "  ").isComplete)
    }
}

final class PayloadValidatorTests: XCTestCase {
    func testAcceptsValidPayload() throws {
        let json = #"{"ok":true,"rows":[{"buyer":"BUYER1","date":"2026-11-16","geo":"AR","ftd":1,"spend":10}]}"#
        XCTAssertEqual(try PayloadValidator.validate(Data(json.utf8)), json)
    }

    func testMapsScriptErrors() {
        XCTAssertThrowsError(try PayloadValidator.validate(Data(#"{"ok":false,"error":"unauthorized"}"#.utf8))) {
            XCTAssertEqual($0 as? DataSourceError, .unauthorized)
        }
        XCTAssertThrowsError(try PayloadValidator.validate(Data(#"{"ok":false,"error":"not_configured"}"#.utf8))) {
            XCTAssertEqual($0 as? DataSourceError, .scriptNotConfigured)
        }
    }

    func testRejectsHTMLAndMissingRows() {
        XCTAssertThrowsError(try PayloadValidator.validate(Data("<html>Sign in</html>".utf8))) {
            XCTAssertEqual($0 as? DataSourceError, .notJSON)
        }
        XCTAssertThrowsError(try PayloadValidator.validate(Data(#"{"ok":true}"#.utf8))) {
            XCTAssertEqual($0 as? DataSourceError, .malformed)
        }
    }
}

final class SnapshotStoreTests: XCTestCase {
    func testRoundTrip() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = SnapshotStore(directory: dir)
        XCTAssertNil(store.load())
        let date = Date(timeIntervalSince1970: 1_800_000_000)
        try store.save(#"{"ok":true,"rows":[]}"#, at: date)
        let snap = try XCTUnwrap(store.load())
        XCTAssertEqual(snap.json, #"{"ok":true,"rows":[]}"#)
        XCTAssertEqual(snap.savedAt.timeIntervalSince1970, date.timeIntervalSince1970, accuracy: 1)
    }

    func testRefreshPolicy() {
        let now = Date()
        XCTAssertTrue(RefreshPolicy.isStale(savedAt: nil, now: now))
        XCTAssertFalse(RefreshPolicy.isStale(savedAt: now.addingTimeInterval(-59 * 60), now: now))
        XCTAssertTrue(RefreshPolicy.isStale(savedAt: now.addingTimeInterval(-60 * 60), now: now))
    }
}
